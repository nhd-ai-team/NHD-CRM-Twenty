const express = require('express');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '25mb' }));

const PORT = process.env.PORT || 3002;
const TWENTY_API_URL = process.env.TWENTY_API_URL || 'http://localhost:3000';
const TWENTY_API_KEY = process.env.TWENTY_API_KEY || '';
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function twentyGraphQL(query, variables = {}) {
  if (!TWENTY_API_KEY) return null;
  const response = await fetch(`${TWENTY_API_URL}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TWENTY_API_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

async function ensureSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS conv;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS conv.contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), channel TEXT NOT NULL, external_id TEXT,
      display_name TEXT, phone TEXT, email TEXT, twenty_person_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(channel, external_id));
    CREATE TABLE IF NOT EXISTS conv.conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), channel TEXT NOT NULL, external_chat_id TEXT,
      contact_id UUID REFERENCES conv.contacts(id), status TEXT DEFAULT 'open', agent_id TEXT,
      last_message_at TIMESTAMPTZ, last_message_preview TEXT, created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(channel, external_chat_id));
    CREATE TABLE IF NOT EXISTS conv.messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), external_msg_id TEXT UNIQUE,
      conversation_id UUID REFERENCES conv.conversations(id), sender_type TEXT NOT NULL,
      content TEXT, content_type TEXT DEFAULT 'text', media_url TEXT, sent_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now());`);
}

function phoneFromJid(jid = '') { return jid.replace(/@.*/, '').replace(/\D/g, ''); }
function messageContent(message = {}) {
  const body = message.message || message;
  if (body.conversation) return { content: body.conversation, type: 'text' };
  if (body.extendedTextMessage?.text) return { content: body.extendedTextMessage.text, type: 'text' };
  if (body.imageMessage) return { content: body.imageMessage.caption || '[图片]', type: 'image', mediaUrl: body.imageMessage.url };
  if (body.videoMessage) return { content: body.videoMessage.caption || '[视频]', type: 'video', mediaUrl: body.videoMessage.url };
  if (body.documentMessage) return { content: body.documentMessage.fileName || '[文件]', type: 'file', mediaUrl: body.documentMessage.url };
  if (body.audioMessage) return { content: '[语音]', type: 'audio', mediaUrl: body.audioMessage.url };
  return { content: '[暂不支持的消息]', type: 'unknown' };
}

async function syncPerson(phone, displayName) {
  if (!TWENTY_API_KEY || !phone) return null;
  try {
    const found = await twentyGraphQL(`query($filter: PersonFilterInput) { people(filter: $filter) { edges { node { id } } } }`, { filter: { phones: { primaryPhoneNumber: { eq: `+${phone}` } } } });
    if (found?.people?.edges?.[0]) return found.people.edges[0].node.id;
    const person = await twentyGraphQL(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: displayName || phone, lastName: '' }, phones: { primaryPhoneNumber: `+${phone}` } } });
    return person?.createPerson?.id || null;
  } catch (error) { console.error('[twenty] person sync failed:', error.message); return null; }
}

async function persistWhatsAppMessage(payload) {
  const data = payload.data || payload;
  const key = data.key || data.message?.key || {};
  const remoteJid = key.remoteJid || data.remoteJid;
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;
  const externalMessageId = key.id || data.id;
  const fromMe = Boolean(key.fromMe ?? data.fromMe);
  const parsed = messageContent(data);
  const phone = phoneFromJid(remoteJid);
  const displayName = data.pushName || data.senderName || phone;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name, phone)
      VALUES ('whatsapp', $1, $2, $3) ON CONFLICT(channel, external_id)
      DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, conv.contacts.display_name), updated_at = now() RETURNING *`, [remoteJid, displayName, `+${phone}`]);
    const contact = contactResult.rows[0];
    const conversationResult = await client.query(`INSERT INTO conv.conversations(channel, external_chat_id, contact_id)
      VALUES ('whatsapp', $1, $2) ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET updated_at = now() RETURNING *`, [remoteJid, contact.id]);
    const conversation = conversationResult.rows[0];
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [externalMessageId || null, conversation.id, fromMe ? 'agent' : 'customer', parsed.content, parsed.type, parsed.mediaUrl || null, data.messageTimestamp ? Number(data.messageTimestamp) * (Number(data.messageTimestamp) < 100000000000 ? 1000 : 1) : Date.now()]);
    if (inserted.rowCount) await client.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversation.id, parsed.content]);
    await client.query('COMMIT');
    if (!contact.twenty_person_id && !fromMe) {
      const twentyId = await syncPerson(phone, displayName);
      if (twentyId) await pool.query('UPDATE conv.contacts SET twenty_person_id = $2, updated_at = now() WHERE id = $1', [contact.id, twentyId]);
    }
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function receiveWhatsAppWebhook(req, res) {
  res.status(200).json({ received: true });
  // Evolution API may deliver either to the base URL or append /messages-upsert.
  const event = req.body.event || req.params.event?.replace(/-/g, '.');
  if (event !== 'messages.upsert') return;
  persistWhatsAppMessage(req.body).catch(error => console.error('[whatsapp] webhook failed:', error.message));
}
app.post('/api/whatsapp/webhook', receiveWhatsAppWebhook);
app.post('/api/whatsapp/webhook/:event', receiveWhatsAppWebhook);

app.get('/api/conversations', async (_req, res) => {
  const result = await pool.query(`SELECT c.id, c.channel, c.status, c.last_message_preview AS "lastMessage", c.last_message_at AS "lastMessageAt",
    json_build_object('id', ct.id, 'name', ct.display_name, 'phone', ct.phone, 'twentyPersonId', ct.twenty_person_id, 'filedStatus', CASE WHEN ct.twenty_person_id IS NULL THEN 'unfiled' ELSE 'lead' END) AS contact
    FROM conv.conversations c JOIN conv.contacts ct ON ct.id = c.contact_id ORDER BY c.last_message_at DESC NULLS LAST`);
  res.json(result.rows);
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  const result = await pool.query(`SELECT id, sender_type AS "senderType", content, content_type AS "contentType", media_url AS "mediaUrl", sent_at AS "sentAt" FROM conv.messages WHERE conversation_id = $1 ORDER BY sent_at`, [req.params.id]);
  res.json(result.rows);
});

app.post('/api/conversations/:id/messages', async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  const result = await pool.query(`SELECT c.external_chat_id, c.channel FROM conv.conversations c WHERE c.id = $1`, [req.params.id]);
  const conversation = result.rows[0];
  if (!conversation) return res.status(404).json({ error: 'conversation not found' });
  if (conversation.channel !== 'whatsapp') return res.status(400).json({ error: 'channel is not supported yet' });
  const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/nhd-whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY }, body: JSON.stringify({ number: phoneFromJid(conversation.external_chat_id), text: content }) });
  if (!response.ok) return res.status(502).json({ error: 'WhatsApp send failed', detail: await response.text() });
  res.status(202).json(await response.json());
});

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', twenty_api_configured: !!TWENTY_API_KEY, evolution_api_configured: !!EVOLUTION_API_KEY }); }
  catch (error) { res.status(503).json({ status: 'error', error: error.message }); }
});

ensureSchema().then(() => app.listen(PORT, () => console.log(`[middleware] listening on ${PORT}`))).catch(error => { console.error(error); process.exit(1); });
