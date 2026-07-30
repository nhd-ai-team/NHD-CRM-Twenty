const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
// verify 回调保留原始 body，供 Instagram/Meta 的 X-Hub-Signature-256 校验使用。
app.use(express.json({ limit: '25mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

const PORT = process.env.PORT || 3002;
const TWENTY_API_URL = process.env.TWENTY_API_URL || 'http://localhost:3000';
const TWENTY_API_KEY = process.env.TWENTY_API_KEY || '';
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://localhost:3003';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || '';
const AI_SERVICE_API_KEY = process.env.AI_SERVICE_API_KEY || '';
const AI_SERVICE_TENANT_ID = process.env.AI_SERVICE_TENANT_ID || 'nhd';
// 调用 ai-service 的 /api/agent 路由（销售在 CRM 回复官网访客）需要 Basic Auth。
const AI_AGENT_USER = process.env.AI_AGENT_USER || 'admin';
const AI_AGENT_PASSWORD = process.env.AI_AGENT_PASSWORD || 'admin123';
const WEBSITE_INGEST_SECRET = process.env.WEBSITE_INGEST_SECRET || '';
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const INSTAGRAM_VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || '';
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || '';
const INSTAGRAM_PAGE_ACCESS_TOKEN = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || '';
// Instagram 与 Facebook Messenger 同属 Meta Graph API。优先使用统一配置，
// 同时保留已有 Instagram 变量，避免已部署环境在升级时中断。
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || INSTAGRAM_VERIFY_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET || INSTAGRAM_APP_SECRET;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || INSTAGRAM_PAGE_ACCESS_TOKEN;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || META_PAGE_ACCESS_TOKEN;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 浏览器写端点的同主域白名单：只放行来自 chinanhd.com（及子域）与本地开发的请求。
// 注意：Origin/Referer 可被非浏览器客户端伪造，这是纵深防御/减速带，非强鉴权。
// webhook（官网/WhatsApp/Meta）走各自的密钥/签名校验，不经此闸。
const ALLOWED_BROWSER_HOSTS = (process.env.ALLOWED_BROWSER_HOSTS || 'chinanhd.com,localhost,127.0.0.1')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function hostAllowed(host) {
  if (!host) return false;
  return ALLOWED_BROWSER_HOSTS.some(suffix => host === suffix || host.endsWith('.' + suffix));
}
function requireSameSite(req, res, next) {
  const source = req.headers.origin || req.headers.referer || '';
  // 同源浏览器 POST 有时不带 Origin/Referer；缺失则放行（避免误杀合法请求），
  // 只拦「带了但不属于同主域」的跨站来源。这是纵深防御，非强鉴权。
  if (!source) return next();
  let host = '';
  try { host = new URL(source).hostname.toLowerCase(); } catch { host = ''; }
  if (hostAllowed(host)) return next();
  console.warn('[same-site] blocked origin:', source, req.method, req.path);
  return res.status(403).json({ error: 'forbidden origin' });
}

function getTwentyTokenFromRequest(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return TWENTY_API_KEY;
}

async function twentyGraphQL(query, variables = {}, token = TWENTY_API_KEY) {
  if (!token) return null;
  const response = await fetch(`${TWENTY_API_URL}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

async function searchCompaniesByName(q, limit = 8, token = TWENTY_API_KEY) {
  const term = String(q || '').trim();
  if (!term) return [];
  const data = await twentyGraphQL(
    `query($filter: CompanyFilterInput, $first: Int) {
      companies(first: $first, filter: $filter) { edges { node { id name } } }
    }`,
    { first: limit, filter: { name: { ilike: `%${term}%` } } },
    token,
  );
  return data?.companies?.edges?.map((edge) => edge.node).filter(Boolean) || [];
}

async function findCompanyByExactName(name, token = TWENTY_API_KEY) {
  const term = String(name || '').trim();
  if (!term) return null;
  const data = await twentyGraphQL(
    `query($filter: CompanyFilterInput) {
      companies(first: 10, filter: $filter) { edges { node { id name } } }
    }`,
    { filter: { name: { ilike: term } } },
    token,
  );
  const companies = data?.companies?.edges?.map((edge) => edge.node).filter(Boolean) || [];
  return companies.find((company) => company.name?.trim().toLowerCase() === term.toLowerCase()) || companies[0] || null;
}

async function createCompanyByName(name, token = TWENTY_API_KEY) {
  const term = String(name || '').trim();
  if (!term) return null;
  const data = await twentyGraphQL(
    'mutation($data: CompanyCreateInput!){ createCompany(data: $data){ id name } }',
    { data: { name: term } },
    token,
  );
  return data?.createCompany || null;
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
      created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS twenty_opportunity_id TEXT;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS lead_draft JSONB NOT NULL DEFAULT '{}'::jsonb;`);
}

function phoneFromJid(jid = '') { return jid.replace(/@.*/, '').replace(/\D/g, ''); }

// WhatsApp 新版对未存联系人使用 @lid 匿名地址，其中的数字不是手机号。
// WAHA 的 contacts 接口可把 lid 解析回真实号码（返回 id 形如 8619057220975@c.us）。
async function resolvePhone(jid = '') {
  if (!jid.endsWith('@lid')) return phoneFromJid(jid);
  try {
    const response = await fetch(`${WAHA_API_URL}/api/contacts?contactId=${encodeURIComponent(jid)}&session=${WAHA_SESSION}`,
      { headers: { 'X-Api-Key': WAHA_API_KEY } });
    if (!response.ok) return null;
    const contact = await response.json();
    return String(contact.id || '').endsWith('@c.us') ? phoneFromJid(contact.id) : null;
  } catch (error) { console.error('[whatsapp] lid resolve failed:', error.message); return null; }
}
// WAHA `message` 事件为扁平 payload：{ from, body, hasMedia, media: { url, mimetype }, type }
function messageContent(payload = {}) {
  const media = payload.media || {};
  const mime = media.mimetype || '';
  if (payload.hasMedia && media.url) {
    if (mime.startsWith('image/')) return { content: payload.body || '[图片]', type: 'image', mediaUrl: media.url };
    if (mime.startsWith('video/')) return { content: payload.body || '[视频]', type: 'video', mediaUrl: media.url };
    if (mime.startsWith('audio/')) return { content: '[语音]', type: 'audio', mediaUrl: media.url };
    return { content: media.filename || payload.body || '[文件]', type: 'file', mediaUrl: media.url };
  }
  if (payload.body) return { content: payload.body, type: 'text' };
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

// 调用 AI 客服服务生成回复草稿，以 sender_type=ai / content_type=ai_suggestion 存入会话。
// WhatsApp / Instagram 个人号或企业号默认「建议模式」：只落草稿供销售确认，不自动发送（避免封号/误发）。
async function requestAiSuggestion(conversation, customerMessageId, message) {
  if (!AI_SERVICE_URL || !AI_SERVICE_API_KEY || !message?.trim()) return;
  const suggestionExternalId = `ai:${customerMessageId}`;
  // 幂等：webhook 可能重复投递，已生成过草稿则跳过
  const exists = await pool.query('SELECT 1 FROM conv.messages WHERE external_msg_id = $1', [suggestionExternalId]);
  if (exists.rowCount) return;
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/v1/ai/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_SERVICE_API_KEY}` },
      body: JSON.stringify({
        tenantId: AI_SERVICE_TENANT_ID,
        channel: conversation.channel,
        conversationId: conversation.id,
        messageId: customerMessageId,
        message,
        requestId: `crm_${customerMessageId}`,
      }),
    });
    if (!response.ok) { console.error('[ai] reply failed:', response.status); return; }
    const ai = await response.json();
    if (!['reply', 'fallback', 'handoff'].includes(ai.status) || !ai.reply?.trim()) return;
    await pool.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at)
      VALUES ($1, $2, 'ai', $3, 'ai_suggestion', now()) ON CONFLICT(external_msg_id) DO NOTHING`,
      [suggestionExternalId, conversation.id, ai.reply]);
  } catch (error) { console.error('[ai] suggestion error:', error.message); }
}

async function persistWhatsAppMessage(payload) {
  const data = payload.payload || payload;
  const fromMe = Boolean(data.fromMe);
  // `_data.id.remote` 始终是对方（客户），与收发方向无关；据此把双向消息归入同一会话。
  const counterpartyJid = data._data?.id?.remote || (fromMe ? data.to : data.from);
  if (!counterpartyJid || counterpartyJid.endsWith('@g.us') || counterpartyJid === 'status@broadcast') return;
  const externalMessageId = data.id;
  const parsed = messageContent(data);
  const phone = await resolvePhone(counterpartyJid);
  // 归一化会话键：同一客户的 @lid 与 @c.us 统一为真实号 <phone>@c.us，避免拆成多个会话。
  const chatKey = phone ? `${phone}@c.us` : counterpartyJid;
  const displayName = (!fromMe && (data.notifyName || data._data?.notifyName)) || phone || counterpartyJid;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name, phone)
      VALUES ('whatsapp', $1, $2, $3) ON CONFLICT(channel, external_id)
      DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, conv.contacts.display_name),
        phone = COALESCE(EXCLUDED.phone, conv.contacts.phone), updated_at = now() RETURNING *`,
      [chatKey, displayName, phone ? `+${phone}` : null]);
    const contact = contactResult.rows[0];
    const conversationResult = await client.query(`INSERT INTO conv.conversations(channel, external_chat_id, contact_id)
      VALUES ('whatsapp', $1, $2) ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET updated_at = now() RETURNING *`, [chatKey, contact.id]);
    const conversation = conversationResult.rows[0];
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [externalMessageId || null, conversation.id, fromMe ? 'agent' : 'customer', parsed.content, parsed.type, parsed.mediaUrl || null, data.timestamp ? Number(data.timestamp) * 1000 : Date.now()]);
    if (inserted.rowCount) await client.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversation.id, parsed.content]);
    await client.query('COMMIT');
    // 规则（2026-07-24）：消息只落对话工作台，不自动同步 People/Companies。
    // 客户信息由销售在工作台右侧表单确认后一键写入 Opportunity（另行实现）。
    // 新的客户入站消息（非人工接管、文本类）触发 AI 生成回复草稿（建议模式，不自动发送）。
    if (inserted.rowCount && !fromMe && conversation.status !== 'takeover' && parsed.type === 'text') {
      requestAiSuggestion(conversation, externalMessageId, parsed.content)
        .catch(error => console.error('[ai] suggestion failed:', error.message));
    }
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function receiveWhatsAppWebhook(req, res) {
  res.status(200).json({ received: true });
  // WAHA 投递 `message`（入站+出站）/ `message.any`；只处理文本类消息事件。
  const event = req.body.event || req.params.event?.replace(/-/g, '.');
  if (event !== 'message' && event !== 'message.any') return;
  persistWhatsAppMessage(req.body).catch(error => console.error('[whatsapp] webhook failed:', error.message));
}
app.post('/api/whatsapp/webhook', receiveWhatsAppWebhook);
app.post('/api/whatsapp/webhook/:event', receiveWhatsAppWebhook);

// 官网客服（AI 客服服务的 website 渠道）访客消息 → CRM 会话工作台。
// AI 服务在存下访客消息后转发到此端点；middleware 按 channel='website' 落入同一 conv 库。
// 官网消息发送方映射：ai-service 的 visitor/ai/agent → conv 库 sender_type。
// agent 是销售在 CRM 回复后由 ai-service 广播回来的回声，CRM 已自行落库，避免重复入库。
const WEBSITE_SENDER_MAP = { visitor: 'customer', customer: 'customer', ai: 'ai', agent: 'agent' };

async function persistWebsiteMessage(body) {
  const visitorId = String(body.visitorId || body.sessionId || '').trim();
  // external_chat_id 优先用 ai-service 的 conversationId，供 CRM 出站回推到同一会话。
  const sessionId = String(body.conversationId || body.sessionId || visitorId).trim();
  const content = String(body.content || body.message || '').trim();
  const externalMessageId = String(body.externalMessageId || body.clientMessageId || '').trim();
  const rawSender = String(body.senderType || 'customer').trim().toLowerCase();
  const senderType = WEBSITE_SENDER_MAP[rawSender] || 'customer';
  if (!sessionId || !content) return;
  // 销售回复的回声不重复入库（CRM 出站时已 recordAgentMessage）。
  if (senderType === 'agent') return;
  const displayName = String(body.displayName || '').trim() || `网站访客 ${visitorId.slice(-6) || sessionId.slice(-6)}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name)
      VALUES ('website', $1, $2) ON CONFLICT(channel, external_id)
      DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, conv.contacts.display_name), updated_at = now() RETURNING *`,
      [visitorId || sessionId, displayName]);
    const contact = contactResult.rows[0];
    const conversationResult = await client.query(`INSERT INTO conv.conversations(channel, external_chat_id, contact_id)
      VALUES ('website', $1, $2) ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET updated_at = now() RETURNING *`, [sessionId, contact.id]);
    const conversation = conversationResult.rows[0];
    // 按发送方给 external_msg_id 加前缀，避免访客/AI 消息 id 撞车导致漏存。
    const dedupeId = externalMessageId ? `web:${senderType}:${externalMessageId}` : null;
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at)
      VALUES ($1, $2, $3, $4, 'text', now()) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [dedupeId, conversation.id, senderType, content]);
    if (inserted.rowCount) await client.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversation.id, content]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

app.post('/api/website/webhook', async (req, res) => {
  if (WEBSITE_INGEST_SECRET && req.headers['x-webhook-secret'] !== WEBSITE_INGEST_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.status(200).json({ received: true });
  persistWebsiteMessage(req.body).catch(error => console.error('[website] ingest failed:', error.message));
});

// ── Instagram（Meta Graph API，企业官方账号）──────────────────────────────
// Meta 一次性 webhook 校验：Meta 后台配置回调地址时会发 GET 请求核对 verify_token。
app.get('/api/instagram/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === INSTAGRAM_VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// 校验 Meta 的 X-Hub-Signature-256（HMAC-SHA256(app secret, rawBody)），防止伪造请求。
function verifyMetaSignature(req) {
  if (!META_APP_SECRET) return true; // 未配置密钥时不做强校验，仅用于本地联调
  const signature = req.headers['x-hub-signature-256'] || '';
  if (!signature.startsWith('sha256=') || !req.rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(req.rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

// IG 消息事件 payload：{ message: { mid, text, attachments, is_echo } }；无 text 时取附件类型。
function instagramMessageContent(message = {}) {
  const attachment = message.attachments?.[0];
  if (attachment) {
    const url = attachment.payload?.url;
    if (attachment.type === 'image') return { content: message.text || '[图片]', type: 'image', mediaUrl: url };
    if (attachment.type === 'video') return { content: message.text || '[视频]', type: 'video', mediaUrl: url };
    if (attachment.type === 'audio') return { content: '[语音]', type: 'audio', mediaUrl: url };
    return { content: message.text || '[文件]', type: 'file', mediaUrl: url };
  }
  if (message.text) return { content: message.text, type: 'text' };
  return { content: '[暂不支持的消息]', type: 'unknown' };
}

async function persistInstagramMessage(senderId, messageEvent) {
  const message = messageEvent.message;
  if (!senderId || !message || message.is_deleted) return;
  const externalMessageId = message.mid ? `ig:${message.mid}` : null;
  const fromMe = Boolean(message.is_echo);
  const parsed = instagramMessageContent(message);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name)
      VALUES ('instagram', $1, $2) ON CONFLICT(channel, external_id)
      DO UPDATE SET updated_at = now() RETURNING *`, [senderId, `Instagram ${senderId.slice(-6)}`]);
    const contact = contactResult.rows[0];
    const conversationResult = await client.query(`INSERT INTO conv.conversations(channel, external_chat_id, contact_id)
      VALUES ('instagram', $1, $2) ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET updated_at = now() RETURNING *`, [senderId, contact.id]);
    const conversation = conversationResult.rows[0];
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [externalMessageId, conversation.id, fromMe ? 'agent' : 'customer', parsed.content, parsed.type, parsed.mediaUrl || null, messageEvent.timestamp || Date.now()]);
    if (inserted.rowCount) await client.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversation.id, parsed.content]);
    await client.query('COMMIT');
    // 与 WhatsApp 一致：仅落草稿，接管中的会话不触发 AI。
    if (inserted.rowCount && !fromMe && conversation.status !== 'takeover' && parsed.type === 'text') {
      requestAiSuggestion(conversation, message.mid, parsed.content)
        .catch(error => console.error('[ai] suggestion failed:', error.message));
    }
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

function receiveInstagramWebhook(req, res) {
  if (!verifyMetaSignature(req)) return res.sendStatus(401);
  res.status(200).json({ received: true });
  const entries = req.body.entry || [];
  for (const entry of entries) {
    for (const messagingEvent of entry.messaging || []) {
      const senderId = messagingEvent.sender?.id;
      if (messagingEvent.message) {
        persistInstagramMessage(senderId, messagingEvent).catch(error => console.error('[instagram] webhook failed:', error.message));
      }
    }
  }
}

app.post('/api/instagram/webhook', receiveInstagramWebhook);

// ── Facebook Messenger（Meta Graph API）──────────────────────────────────────
// 与 Instagram 共用同一个 Meta App 时，可以把回调统一配置为 /api/meta/webhook；
// /api/facebook/webhook 保留为独立回调地址，方便已有账号单独配置。
function verifyMetaWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return true;
  }
  res.sendStatus(403);
  return false;
}

function facebookMessageContent(message = {}) {
  const attachment = message.attachments?.[0];
  if (attachment) {
    const url = attachment.payload?.url;
    if (attachment.type === 'image') return { content: message.text || '[图片]', type: 'image', mediaUrl: url };
    if (attachment.type === 'video') return { content: message.text || '[视频]', type: 'video', mediaUrl: url };
    if (attachment.type === 'audio') return { content: '[语音]', type: 'audio', mediaUrl: url };
    return { content: message.text || '[文件]', type: 'file', mediaUrl: url };
  }
  if (message.text) return { content: message.text, type: 'text' };
  return { content: '[暂不支持的消息]', type: 'unknown' };
}

async function persistFacebookMessage(messagingEvent) {
  const message = messagingEvent.message;
  if (!message || message.is_deleted) return;
  const fromMe = Boolean(message.is_echo);
  // Facebook 的 echo 事件 sender 是主页自身，客户 id 在 recipient；入站则相反。
  const counterpartyId = fromMe ? messagingEvent.recipient?.id : messagingEvent.sender?.id;
  if (!counterpartyId) return;
  const externalMessageId = message.mid ? `fb:${message.mid}` : null;
  const parsed = facebookMessageContent(message);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name)
      VALUES ('facebook', $1, $2) ON CONFLICT(channel, external_id)
      DO UPDATE SET updated_at = now() RETURNING *`, [counterpartyId, `Facebook ${counterpartyId.slice(-6)}`]);
    const contact = contactResult.rows[0];
    const conversationResult = await client.query(`INSERT INTO conv.conversations(channel, external_chat_id, contact_id)
      VALUES ('facebook', $1, $2) ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET updated_at = now() RETURNING *`, [counterpartyId, contact.id]);
    const conversation = conversationResult.rows[0];
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0)) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [externalMessageId, conversation.id, fromMe ? 'agent' : 'customer', parsed.content, parsed.type, parsed.mediaUrl || null, messagingEvent.timestamp || Date.now()]);
    if (inserted.rowCount) await client.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversation.id, parsed.content]);
    await client.query('COMMIT');
    if (inserted.rowCount && !fromMe && conversation.status !== 'takeover' && parsed.type === 'text') {
      requestAiSuggestion(conversation, message.mid, parsed.content)
        .catch(error => console.error('[ai] suggestion failed:', error.message));
    }
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

function receiveFacebookWebhook(req, res) {
  if (!verifyMetaSignature(req)) return res.sendStatus(401);
  res.status(200).json({ received: true });
  for (const entry of req.body.entry || []) {
    for (const messagingEvent of entry.messaging || []) {
      if (messagingEvent.message) {
        persistFacebookMessage(messagingEvent).catch(error => console.error('[facebook] webhook failed:', error.message));
      }
    }
  }
}

app.get('/api/facebook/webhook', verifyMetaWebhook);
app.post('/api/facebook/webhook', receiveFacebookWebhook);
app.get('/api/meta/webhook', verifyMetaWebhook);
app.post('/api/meta/webhook', (req, res) => {
  if (req.body.object === 'page') return receiveFacebookWebhook(req, res);
  if (req.body.object === 'instagram') return receiveInstagramWebhook(req, res);
  return res.status(400).json({ error: 'unsupported Meta webhook object' });
});

app.get('/api/conversations', async (_req, res) => {
  const result = await pool.query(`SELECT c.id, c.channel, c.status, c.last_message_preview AS "lastMessage", c.last_message_at AS "lastMessageAt", c.lead_draft AS "leadDraft",
    json_build_object('id', ct.id, 'name', ct.display_name, 'phone', ct.phone, 'twentyPersonId', ct.twenty_person_id, 'twentyOpportunityId', ct.twenty_opportunity_id,
      'filedStatus', CASE WHEN ct.twenty_opportunity_id IS NOT NULL OR ct.twenty_person_id IS NOT NULL THEN 'lead' ELSE 'unfiled' END) AS contact
    FROM conv.conversations c JOIN conv.contacts ct ON ct.id = c.contact_id ORDER BY c.last_message_at DESC NULLS LAST`);
  res.json(result.rows);
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  const result = await pool.query(`SELECT id, sender_type AS "senderType", content, content_type AS "contentType", media_url AS "mediaUrl", sent_at AS "sentAt" FROM conv.messages WHERE conversation_id = $1 ORDER BY sent_at`, [req.params.id]);
  res.json(result.rows);
});

app.get('/api/companies/search', requireSameSite, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const companies = await searchCompaniesByName(q, 8, getTwentyTokenFromRequest(req));
    res.json(companies);
  } catch (error) {
    console.error('[companies/search] failed:', error.message);
    res.status(502).json({ error: 'company search failed' });
  }
});

// 渠道 → 客户来源(keHuLaiYuan)默认值，销售可在表单里改。
const SOURCE_BY_CHANNEL = { whatsapp: 'WHATSAPP', website: 'GUAN_WANG_KE_FU', instagram: 'INS', facebook: 'FACEBOOK' };

// 右侧「资料」面板草稿自动暂存（失焦即存）。草稿存会话的 lead_draft(jsonb)。
const DRAFT_FIELDS = ['name', 'company', 'companyId', 'phone', 'email', 'country', 'source', 'companyType', 'stage', 'product', 'note'];
const OPPORTUNITY_EMAIL_FIELD = 'youXiang';
const EMAIL_SEPARATOR_RE = /[\s,;，；]+/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const normalizeEmailList = (value) => String(value || '')
  .split(EMAIL_SEPARATOR_RE)
  .map((item) => item.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''))
  .filter(Boolean);
app.put('/api/conversations/:id/draft', requireSameSite, async (req, res) => {
  const b = req.body || {};
  const draft = {};
  for (const k of DRAFT_FIELDS) if (b[k] !== undefined) draft[k] = typeof b[k] === 'string' ? b[k] : String(b[k] ?? '');
  const r = await pool.query('UPDATE conv.conversations SET lead_draft = $2, updated_at = now() WHERE id = $1 RETURNING id', [req.params.id, draft]);
  if (!r.rowCount) return res.status(404).json({ error: 'conversation not found' });
  res.json({ saved: true });
});

// 「转为线索」：把右侧表单字段映射到 Opportunity 并创建；成功后在联系人上记 opportunity id。
app.post('/api/conversations/:id/convert-to-lead', requireSameSite, async (req, res) => {
  const b = req.body || {};
  const twentyToken = getTwentyTokenFromRequest(req);
  const name = String(b.name || '').trim();
  const company = String(b.company || '').trim();
  if (!name && !company) return res.status(400).json({ error: '姓名或公司至少填写一个' });

  const cr = await pool.query(
    `SELECT c.id, c.channel, c.contact_id, ct.twenty_opportunity_id
     FROM conv.conversations c JOIN conv.contacts ct ON ct.id = c.contact_id WHERE c.id = $1`, [req.params.id]);
  const row = cr.rows[0];
  if (!row) return res.status(404).json({ error: 'conversation not found' });
  // 已转过 → 更新既有商机；未转 → 新建。支持二次/三次补填后再次推送。
  const isUpdate = !!row.twenty_opportunity_id;
  const oppId = row.twenty_opportunity_id;

  // 关键联系人(Person)：已有则更新姓名，没有且填了姓名则新建；姓名为空则不动。
  let personId = null;
  let createdPersonId = null; // 仅本次新建的，失败时回滚
  if (isUpdate) {
    try {
      const ex = await twentyGraphQL('query($id: UUID!){ opportunity(filter: { id: { eq: $id } }){ pointOfContact{ id } } }', { id: oppId }, twentyToken);
      personId = ex?.opportunity?.pointOfContact?.id || null;
    } catch (error) { console.error('[convert-to-lead] load pointOfContact failed:', error.message); }
  }
  if (name) {
    try {
      if (personId) {
        await twentyGraphQL('mutation($id: UUID!, $d: PersonUpdateInput!){ updatePerson(id: $id, data: $d){ id } }',
          { id: personId, d: { name: { firstName: name, lastName: '' } } }, twentyToken);
      } else {
        const pr = await twentyGraphQL('mutation($d: PersonCreateInput!){ createPerson(data: $d){ id } }',
          { d: { name: { firstName: name, lastName: '' } } }, twentyToken);
        personId = pr?.createPerson?.id || null;
        createdPersonId = personId;
      }
    } catch (error) { console.error('[convert-to-lead] person write failed:', error.message); }
  }

  // 商机名用公司（缺则用姓名兜底）；公司字段优先关联库内 Company，找不到才新建。
  const data = { name: company || name };
  let companyId = String(b.companyId || '').trim();
  if (!companyId && company) {
    try {
      const existingCompany = await findCompanyByExactName(company, twentyToken);
      const resolvedCompany = existingCompany || await createCompanyByName(company, twentyToken);
      companyId = resolvedCompany?.id || '';
    } catch (error) { console.error('[convert-to-lead] company write failed:', error.message); }
  }
  if (companyId) data.companyId = companyId;
  if (personId) data.pointOfContactId = personId;
  if (b.stage) data.stage = String(b.stage);
  const source = b.source || SOURCE_BY_CHANNEL[row.channel];
  if (source) data.keHuLaiYuan = source;
  if (b.companyType) data.gongSiLeiXing = String(b.companyType);
  if (b.product) data.keHuXuQiuChanPin = String(b.product);
  if (b.note) data.message = String(b.note);

  // 电话/邮箱 best-effort：明显无效直接跳过，避免一个脏字段阻断整单推送。
  const skipped = [];
  const rawPhone = String(b.phone || '').replace(/[\s()-]+/g, '');
  if (rawPhone) {
    if (/^\+?\d{5,15}$/.test(rawPhone)) {
      data.phone = rawPhone.startsWith('+')
        ? { primaryPhoneNumber: rawPhone }
        : { primaryPhoneNumber: rawPhone, primaryPhoneCallingCode: '+86', primaryPhoneCountryCode: 'CN' };
    } else skipped.push('phone');
  }
  const email = String(b.email || '').trim();
  if (email) {
    const emails = normalizeEmailList(email);
    if (emails.length > 0 && emails.every((item) => EMAIL_RE.test(item))) data[OPPORTUNITY_EMAIL_FIELD] = emails.join(', ');
    else skipped.push('email');
  }
  const country = String(b.country || '').trim();
  if (country) data.country = { addressCountry: country };

  const writeOpp = (d) => (isUpdate
    ? twentyGraphQL('mutation($id: UUID!, $data: OpportunityUpdateInput!){ updateOpportunity(id: $id, data: $data){ id name } }', { id: oppId, data: d }, twentyToken).then((r) => r?.updateOpportunity)
    : twentyGraphQL('mutation($data: OpportunityCreateInput!){ createOpportunity(data: $data){ id name } }', { data: d }, twentyToken).then((r) => r?.createOpportunity));

  try {
    let opp;
    try {
      opp = await writeOpp(data);
    } catch (e) {
      // 兜底：若 Twenty 仍因电话/邮箱格式拒绝，剥离该字段重试一次。
      const msg = (e.message || '').toLowerCase();
      if (msg.includes('phone') || msg.includes('email')) {
        if (msg.includes('phone')) { delete data.phone; skipped.push('phone'); }
        if (msg.includes('email')) { delete data[OPPORTUNITY_EMAIL_FIELD]; skipped.push('email'); }
        opp = await writeOpp(data);
      } else throw e;
    }
    if (!opp?.id) return res.status(502).json({ error: isUpdate ? 'updateOpportunity failed' : 'createOpportunity failed' });
    if (!isUpdate && row.contact_id) {
      await pool.query('UPDATE conv.contacts SET twenty_opportunity_id = $2, updated_at = now() WHERE id = $1', [row.contact_id, opp.id]);
    }
    res.status(isUpdate ? 200 : 201).json({ opportunityId: opp.id, name: opp.name, skipped: [...new Set(skipped)], updated: isUpdate });
  } catch (error) {
    // 写商机失败：仅回滚本次「新建」的孤儿 Person（更新既有 Person 不回滚）。
    if (createdPersonId) twentyGraphQL('mutation($id: UUID!){ deletePerson(id: $id){ id } }', { id: createdPersonId }, twentyToken).catch(() => {});
    console.error('[convert-to-lead] failed:', error.message);
    res.status(502).json({ error: 'convert failed', detail: error.message });
  }
});

// 记录销售在 CRM 内发出的消息。用渠道返回的消息 id 落库，与 message.any webhook 回传的
// 同一条出站消息（fromMe=true，external_msg_id 同为该 id）去重，避免重复。
async function recordAgentMessage(conversationId, content, externalId) {
  await pool.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at)
    VALUES ($1, $2, 'agent', $3, 'text', now()) ON CONFLICT(external_msg_id) DO NOTHING`,
    [externalId || null, conversationId, content]);
  await pool.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversationId, content]);
}

app.post('/api/conversations/:id/messages', requireSameSite, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  const result = await pool.query(`SELECT c.external_chat_id, c.channel FROM conv.conversations c WHERE c.id = $1`, [req.params.id]);
  const conversation = result.rows[0];
  if (!conversation) return res.status(404).json({ error: 'conversation not found' });

  if (conversation.channel === 'whatsapp') {
    const response = await fetch(`${WAHA_API_URL}/api/sendText`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY }, body: JSON.stringify({ session: WAHA_SESSION, chatId: conversation.external_chat_id, text: content }) });
    if (!response.ok) return res.status(502).json({ error: 'WhatsApp send failed', detail: await response.text() });
    const sent = await response.json();
    await recordAgentMessage(req.params.id, content, sent?.id?._serialized || sent?._data?.id?._serialized);
    return res.status(202).json(sent);
  }

  if (conversation.channel === 'instagram') {
    if (!META_PAGE_ACCESS_TOKEN) return res.status(500).json({ error: 'Instagram page access token not configured' });
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${META_PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: conversation.external_chat_id }, message: { text: content } }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Instagram send failed', detail: await response.text() });
    const sent = await response.json();
    await recordAgentMessage(req.params.id, content, sent?.message_id);
    return res.status(202).json(sent);
  }

  if (conversation.channel === 'facebook') {
    if (!FACEBOOK_PAGE_ACCESS_TOKEN) return res.status(500).json({ error: 'Facebook page access token not configured' });
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: conversation.external_chat_id }, message: { text: content } }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Facebook send failed', detail: await response.text() });
    const sent = await response.json();
    await recordAgentMessage(req.params.id, content, sent?.message_id);
    return res.status(202).json(sent);
  }

  if (conversation.channel === 'website') {
    if (!AI_SERVICE_URL) return res.status(500).json({ error: 'AI service url not configured' });
    // external_chat_id 即 ai-service 的 conversationId；注入一条 agent 消息，widget 轮询即可看到。
    const auth = Buffer.from(`${AI_AGENT_USER}:${AI_AGENT_PASSWORD}`).toString('base64');
    const idempotencyKey = `crm:${req.params.id}:${Date.now()}`;
    const response = await fetch(`${AI_SERVICE_URL}/api/agent/conversations/${encodeURIComponent(conversation.external_chat_id)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ content, idempotencyKey, agentId: 'crm' }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Website send failed', detail: await response.text() });
    const sent = await response.json();
    await recordAgentMessage(req.params.id, content, `web:agent:${sent?.messageId || idempotencyKey}`);
    return res.status(202).json(sent);
  }

  res.status(400).json({ error: 'channel is not supported yet' });
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      twenty_api_configured: !!TWENTY_API_KEY,
      waha_api_configured: !!WAHA_API_KEY,
      instagram_configured: !!(META_VERIFY_TOKEN && META_PAGE_ACCESS_TOKEN),
      facebook_configured: !!(META_VERIFY_TOKEN && FACEBOOK_PAGE_ACCESS_TOKEN),
    });
  } catch (error) { res.status(503).json({ status: 'error', error: error.message }); }
});

ensureSchema().then(() => app.listen(PORT, () => console.log(`[middleware] listening on ${PORT}`))).catch(error => { console.error(error); process.exit(1); });
