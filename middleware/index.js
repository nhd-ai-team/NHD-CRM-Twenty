const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { Pool } = require('pg');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

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
// 邮箱（IMAP 只读收取，沉淀到对话工作台的 email 渠道；不回复、不接 AI）
const IMAP_HOST = process.env.IMAP_HOST || 'imap.qiye.163.com';
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const IMAP_TLS = String(process.env.IMAP_TLS ?? 'true').toLowerCase() !== 'false';
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASSWORD = process.env.IMAP_PASSWORD || '';
const IMAP_MAILBOX = process.env.IMAP_MAILBOX || 'INBOX';
const IMAP_POLL_SECONDS = Math.max(15, Number(process.env.IMAP_POLL_SECONDS || 60));
const IMAP_INITIAL_FETCH_LIMIT = Math.max(1, Number(process.env.IMAP_INITIAL_FETCH_LIMIT || 20));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let workspaceSchemaCache = null;

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

function getCookieFromRequest(req, name) {
  const prefix = `${name}=`;
  const cookie = String(req.headers.cookie || '');
  const part = cookie.split(';').map(item => item.trim()).find(item => item.startsWith(prefix));
  return part ? part.slice(prefix.length) : '';
}

function getTwentyTokenFromCookie(req) {
  try {
    const raw = getCookieFromRequest(req, 'tokenPair');
    if (!raw) return '';
    const tokenPair = JSON.parse(decodeURIComponent(raw));
    return tokenPair?.accessToken?.token || '';
  } catch {
    return '';
  }
}

function getTwentyTokenFromRequest(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  const forwardedToken = String(req.headers['x-twenty-access-token'] || '').trim();
  if (forwardedToken) return forwardedToken;
  const cookieToken = getTwentyTokenFromCookie(req);
  if (cookieToken) return cookieToken;
  return TWENTY_API_KEY;
}

function decodeJwtPayload(token) {
  try {
    const payload = String(token || '').split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function getTwentyUserIdFromRequest(req) {
  const userId = String(req.headers['x-twenty-user-id'] || '').trim();
  if (userId) return userId;
  const token = getTwentyTokenFromRequest(req);
  return decodeJwtPayload(token)?.sub || '';
}

async function getWorkspaceSchema() {
  if (workspaceSchemaCache) return workspaceSchemaCache;
  const result = await pool.query(`
    SELECT table_schema
    FROM information_schema.tables
    WHERE table_name = 'workspaceMember' AND table_schema LIKE 'workspace_%'
    ORDER BY table_schema
    LIMIT 1`);
  const schema = result.rows[0]?.table_schema || '';
  if (!/^workspace_[a-z0-9]+$/.test(schema)) throw new Error('workspace schema not found');
  workspaceSchemaCache = schema;
  return schema;
}

async function resolveAuditActor(req) {
  const userId = getTwentyUserIdFromRequest(req);
  if (!userId) return null;
  const schema = await getWorkspaceSchema();
  const result = await pool.query(
    `SELECT id, "nameFirstName", "nameLastName" FROM ${schema}."workspaceMember" WHERE "userId" = $1 LIMIT 1`,
    [userId],
  );
  const member = result.rows[0];
  if (!member?.id) return null;
  const name = [member.nameFirstName, member.nameLastName].filter(Boolean).join(' ').trim() || 'CRM 用户';
  return { id: member.id, name };
}

function auditRequestSummary(req) {
  const authorization = String(req.headers.authorization || '');
  const forwardedToken = String(req.headers['x-twenty-access-token'] || '');
  const forwardedUserId = String(req.headers['x-twenty-user-id'] || '');
  const cookieToken = getTwentyTokenFromCookie(req);
  const token = getTwentyTokenFromRequest(req);
  const decoded = decodeJwtPayload(token);
  return {
    hasAuthorization: authorization.toLowerCase().startsWith('bearer '),
    hasForwardedToken: !!forwardedToken,
    hasForwardedUserId: !!forwardedUserId,
    hasCookieHeader: !!req.headers.cookie,
    hasTokenPairCookie: !!getCookieFromRequest(req, 'tokenPair'),
    hasCookieToken: !!cookieToken,
    decodedUserId: decoded?.sub ? `${String(decoded.sub).slice(0, 8)}...` : '',
    tokenLooksLikeApiKey: !!decoded?.jti && decoded?.sub && !decoded?.workspaceId,
    chatUiVersion: String(req.headers['x-chat-ui-version'] || ''),
    cookieNames: String(req.headers.cookie || '')
      .split(';')
      .map(item => item.trim().split('=')[0])
      .filter(Boolean),
  };
}

async function applyRecordAudit(tableName, recordId, actor, mode = 'update') {
  if (!actor?.id || !recordId || !['opportunity', 'person', 'company'].includes(tableName)) return;
  const schema = await getWorkspaceSchema();
  const setCreated = mode === 'create';
  const assignments = [
    '"updatedBySource" = \'MANUAL\'',
    '"updatedByWorkspaceMemberId" = $2',
    '"updatedByName" = $3',
    '"updatedByContext" = COALESCE("updatedByContext", \'{}\'::jsonb)',
  ];
  if (setCreated) {
    assignments.push(
      '"createdBySource" = \'MANUAL\'',
      '"createdByWorkspaceMemberId" = $2',
      '"createdByName" = $3',
      '"createdByContext" = COALESCE("createdByContext", \'{}\'::jsonb)',
    );
  }
  await pool.query(
    `UPDATE ${schema}."${tableName}" SET ${assignments.join(', ')} WHERE id = $1`,
    [recordId, actor.id, actor.name],
  );
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

async function createCompanyByName(name, token = TWENTY_API_KEY, auditActor = null) {
  const term = String(name || '').trim();
  if (!term) return null;
  const data = await twentyGraphQL(
    'mutation($data: CompanyCreateInput!){ createCompany(data: $data){ id name } }',
    { data: { name: term } },
    token,
  );
  const company = data?.createCompany || null;
  if (company?.id) await applyRecordAudit('company', company.id, auditActor, 'create');
  return company;
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
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS lead_draft JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS ai_takeover_until TIMESTAMPTZ;
    UPDATE conv.conversations SET ai_enabled = (channel = 'website') WHERE ai_enabled IS NULL;
    -- 渠道级 AI 自动回复开关（工作台齿轮）：作为「生效范围」基线，
    -- 会话级 ai_enabled 保留为单会话覆盖位（默认 NULL 时继承此表）。
    CREATE TABLE IF NOT EXISTS conv.channel_settings (
      channel TEXT PRIMARY KEY,
      ai_enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    INSERT INTO conv.channel_settings(channel, ai_enabled) VALUES
      ('website', true), ('whatsapp', false), ('instagram', false), ('facebook', false)
      ON CONFLICT (channel) DO NOTHING;
    -- 邮件专用字段（仅 channel='email' 使用）：主题与附件清单
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS subject TEXT;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS attachments JSONB;
    -- IMAP 增量同步游标
    CREATE TABLE IF NOT EXISTS conv.email_sync (
      mailbox TEXT PRIMARY KEY,
      uid_validity BIGINT,
      last_uid BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
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
  // 生效范围解析：会话级覆盖(c.ai_enabled) → 渠道设置(cs.ai_enabled) → 官网默认开
  const result = await pool.query(`SELECT c.id, c.channel, c.status, c.last_message_preview AS "lastMessage", c.last_message_at AS "lastMessageAt", c.lead_draft AS "leadDraft",
    json_build_object(
      'enabled', COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website'),
      'inTakeoverWindow', (COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AND (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now())),
      'canTakeover', (COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AND (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND c.status NOT IN ('takeover', 'closed'))
    ) AS "aiControl",
    json_build_object('id', ct.id, 'name', ct.display_name, 'phone', ct.phone, 'email', ct.email, 'twentyPersonId', ct.twenty_person_id, 'twentyOpportunityId', ct.twenty_opportunity_id,
      'filedStatus', CASE WHEN ct.twenty_opportunity_id IS NOT NULL OR ct.twenty_person_id IS NOT NULL THEN 'lead' ELSE 'unfiled' END) AS contact
    FROM conv.conversations c JOIN conv.contacts ct ON ct.id = c.contact_id
    LEFT JOIN conv.channel_settings cs ON cs.channel = c.channel
    ORDER BY c.last_message_at DESC NULLS LAST`);
  res.json(result.rows);
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  const result = await pool.query(`SELECT id, sender_type AS "senderType", content, content_type AS "contentType", media_url AS "mediaUrl", subject, attachments, sent_at AS "sentAt" FROM conv.messages WHERE conversation_id = $1 ORDER BY sent_at`, [req.params.id]);
  res.json(result.rows);
});

app.get('/api/email/status', async (_req, res) => {
  try {
    const syncKey = getEmailSyncKey();
    const sync = await getEmailSync(syncKey);
    const counts = await pool.query(
      `SELECT count(DISTINCT c.id)::int AS conversations, count(m.id)::int AS messages
       FROM conv.conversations c
       LEFT JOIN conv.messages m ON m.conversation_id = c.id
       WHERE c.channel = 'email'`,
    );
    res.json({
      configured: !!(IMAP_USER && IMAP_PASSWORD),
      host: IMAP_HOST,
      port: IMAP_PORT,
      tls: IMAP_TLS,
      user: IMAP_USER ? IMAP_USER.replace(/^(.{2}).*(@.*)?$/, (_m, head, domain) => `${head}***${domain || ''}`) : '',
      mailbox: IMAP_MAILBOX,
      pollSeconds: IMAP_POLL_SECONDS,
      initialFetchLimit: IMAP_INITIAL_FETCH_LIMIT,
      sync,
      counts: counts.rows[0],
    });
  } catch (error) {
    console.error('[email] status failed:', error.message);
    res.status(502).json({ error: 'email status failed', detail: error.message });
  }
});

app.post('/api/email/sync-now', requireSameSite, async (_req, res) => {
  if (!IMAP_USER || !IMAP_PASSWORD) {
    return res.status(409).json({ error: 'IMAP not configured' });
  }
  try {
    const result = await pollEmailsOnce();
    res.json(result);
  } catch (error) {
    console.error('[email] manual sync failed:', error.message);
    res.status(502).json({ error: 'email sync failed', detail: error.message });
  }
});

app.patch('/api/conversations/:id/status', requireSameSite, async (req, res) => {
  const action = String(req.body?.action || '').trim();
  if (!['takeover', 'release'].includes(action)) return res.status(400).json({ error: 'unsupported status action' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT c.id, c.status, COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AS "aiEnabled",
        (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AS "inTakeoverWindow"
       FROM conv.conversations c
       LEFT JOIN conv.channel_settings cs ON cs.channel = c.channel
       WHERE c.id = $1 FOR UPDATE OF c`,
      [req.params.id],
    );
    const conversation = currentResult.rows[0];
    if (!conversation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'conversation not found' });
    }
    if (!conversation.aiEnabled || !conversation.inTakeoverWindow) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'AI客服未激活或不在托管时间内' });
    }

    const nextStatus = action === 'takeover' ? 'takeover' : 'open';
    const systemText = action === 'takeover' ? '销售已人工接管此会话' : '已切换为 AI 托管';
    await client.query(
      `UPDATE conv.conversations SET status = $2, updated_at = now() WHERE id = $1`,
      [req.params.id, nextStatus],
    );
    await client.query(
      `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at)
       VALUES ($1, $2, 'system', $3, 'system', now())`,
      [`system:${req.params.id}:${Date.now()}:${action}`, req.params.id, systemText],
    );
    await client.query('COMMIT');
    res.json({ id: req.params.id, status: nextStatus });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[conversation-status] failed:', error.message);
    res.status(502).json({ error: 'status switch failed', detail: error.message });
  } finally {
    client.release();
  }
});

const AI_SETTING_CHANNELS = ['website', 'whatsapp', 'instagram', 'facebook'];

// 渠道级 AI 自动回复开关（工作台齿轮的「生效范围」）
app.get('/api/ai-settings', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT channel, ai_enabled AS "enabled" FROM conv.channel_settings ORDER BY channel`,
    );
    const map = new Map(result.rows.map(r => [r.channel, r.enabled]));
    // 保证四个渠道恒定返回，缺失的按官网默认开、其余关兜底
    res.json(AI_SETTING_CHANNELS.map(channel => ({
      channel,
      enabled: map.has(channel) ? map.get(channel) : channel === 'website',
    })));
  } catch (error) {
    console.error('[ai-settings] load failed:', error.message);
    res.status(502).json({ error: 'ai settings load failed', detail: error.message });
  }
});

app.patch('/api/ai-settings', requireSameSite, async (req, res) => {
  const channel = String(req.body?.channel || '').trim();
  const enabled = req.body?.enabled;
  if (!AI_SETTING_CHANNELS.includes(channel)) return res.status(400).json({ error: 'unsupported channel' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO conv.channel_settings(channel, ai_enabled, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (channel) DO UPDATE SET ai_enabled = EXCLUDED.ai_enabled, updated_at = now()`,
      [channel, enabled],
    );
    // 清掉该渠道的会话级覆盖，令现有会话立即继承渠道设置
    await client.query(`UPDATE conv.conversations SET ai_enabled = NULL WHERE channel = $1`, [channel]);
    await client.query('COMMIT');
    res.json({ channel, enabled });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ai-settings] update failed:', error.message);
    res.status(502).json({ error: 'ai settings update failed', detail: error.message });
  } finally {
    client.release();
  }
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
const SHARED_CUSTOMER_TYPES = new Set(['ZHONG_JIAN_SHANG', 'YE_ZHU', 'EPC', 'JI_SHU_ZI_XUN']);
const normalizeEmailList = (value) => String(value || '')
  .split(EMAIL_SEPARATOR_RE)
  .map((item) => item.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''))
  .filter(Boolean);
const nonBlankOrNull = (value) => {
  const text = String(value || '').trim();
  return text ? text : null;
};
const firstValidEmail = (...values) => {
  for (const value of values) {
    const found = normalizeEmailList(value).find((item) => EMAIL_RE.test(item));
    if (found) return found;
  }
  return null;
};
const phoneDigits = (value) => String(value || '').replace(/\D/g, '');
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
  const auditActor = await resolveAuditActor(req).catch((error) => {
    console.error('[audit] resolve actor failed:', error.message);
    return null;
  });
  if (!auditActor) console.warn('[audit] current user not resolved; record audit will keep API identity');
  if (!auditActor) console.warn('[audit] request summary:', auditRequestSummary(req));
  const name = String(b.name || '').trim();
  const company = String(b.company || '').trim();

  const cr = await pool.query(
    `SELECT c.id, c.channel, c.contact_id, ct.display_name AS contact_name, ct.phone AS contact_phone, ct.twenty_opportunity_id
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
        await applyRecordAudit('person', personId, auditActor, 'update');
      } else {
        const pr = await twentyGraphQL('mutation($d: PersonCreateInput!){ createPerson(data: $d){ id } }',
          { d: { name: { firstName: name, lastName: '' } } }, twentyToken);
        personId = pr?.createPerson?.id || null;
        createdPersonId = personId;
        await applyRecordAudit('person', personId, auditActor, 'create');
      }
    } catch (error) { console.error('[convert-to-lead] person write failed:', error.message); }
  }

  // 线索名用公司/姓名；都为空时用会话联系人或 WhatsApp 号兜底，允许销售后续补填。
  const fallbackLeadName = row.contact_phone || row.contact_name || `${row.channel || '渠道'}线索`;
  const data = { name: company || name || fallbackLeadName };
  let companyId = String(b.companyId || '').trim();
  if (!companyId && company) {
    try {
      const existingCompany = await findCompanyByExactName(company, twentyToken);
      const resolvedCompany = existingCompany || await createCompanyByName(company, twentyToken, auditActor);
      companyId = resolvedCompany?.id || '';
    } catch (error) { console.error('[convert-to-lead] company write failed:', error.message); }
  }
  if (companyId) data.companyId = companyId;
  if (personId) data.pointOfContactId = personId;
  if (b.stage) data.stage = String(b.stage);
  const source = b.source || SOURCE_BY_CHANNEL[row.channel];
  if (source) data.keHuLaiYuan = source;
  if (b.companyType) data.keHuLeiXing = String(b.companyType);
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
  if ((rawPhone || email) && (!data.stage || data.stage === 'XIANSUO')) data.stage = 'YOUXIAO_XIANSUO';
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
    await applyRecordAudit('opportunity', opp.id, auditActor, isUpdate ? 'update' : 'create');
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

async function findExistingPersonForOpportunity(client, schema, opportunity) {
  const emails = [
    firstValidEmail(opportunity.youXiang),
    firstValidEmail(opportunity.emailPrimaryEmail),
  ].filter(Boolean).map((item) => item.toLowerCase());
  const phone = phoneDigits(opportunity.phonePrimaryPhoneNumber);

  const result = await client.query(
    `SELECT id, "syncGroupCode"
     FROM ${schema}.person
     WHERE "deletedAt" IS NULL
       AND (
         id = $1
         OR id = $2
         OR ($3::text IS NOT NULL AND "syncGroupCode" = $3)
         OR (cardinality($4::text[]) > 0 AND lower(COALESCE("emailsPrimaryEmail", '')) = ANY($4::text[]))
         OR ($5::text <> '' AND regexp_replace(COALESCE("phonesPrimaryPhoneNumber", ''), '\\D', '', 'g') = $5)
       )
     ORDER BY
       CASE
         WHEN id = $1 THEN 0
         WHEN id = $2 THEN 1
         WHEN "syncGroupCode" = $3 THEN 2
         WHEN cardinality($4::text[]) > 0 AND lower(COALESCE("emailsPrimaryEmail", '')) = ANY($4::text[]) THEN 3
         ELSE 4
       END
     LIMIT 1`,
    [
      opportunity.linkedPersonId || null,
      opportunity.pointOfContactId || null,
      opportunity.syncGroupCode || null,
      emails,
      phone,
    ],
  );
  return result.rows[0] || null;
}

async function upsertPersonFromOpportunity(client, schema, opportunity) {
  const existing = await findExistingPersonForOpportunity(client, schema, opportunity);
  const name = nonBlankOrNull(opportunity.name);
  const email = firstValidEmail(opportunity.youXiang, opportunity.emailPrimaryEmail);
  const customerType = SHARED_CUSTOMER_TYPES.has(String(opportunity.keHuLeiXing || ''))
    ? String(opportunity.keHuLeiXing)
    : null;

  if (existing?.id) {
    const result = await client.query(
      `UPDATE ${schema}.person AS target
       SET
         "syncGroupCode" = COALESCE("syncGroupCode", $2),
         "sourceOpportunityId" = COALESCE("sourceOpportunityId", $1),
         "linkedProjectId" = COALESCE("linkedProjectId", $3),
         "nameFirstName" = COALESCE($4, "nameFirstName"),
         "companyId" = COALESCE($5, "companyId"),
         "phonesPrimaryPhoneNumber" = COALESCE($6, "phonesPrimaryPhoneNumber"),
         "phonesPrimaryPhoneCountryCode" = COALESCE($7, "phonesPrimaryPhoneCountryCode"),
         "phonesPrimaryPhoneCallingCode" = COALESCE($8, "phonesPrimaryPhoneCallingCode"),
         "emailsPrimaryEmail" = CASE
           WHEN $9::text IS NULL THEN target."emailsPrimaryEmail"
           WHEN NOT EXISTS (
             SELECT 1 FROM ${schema}.person AS other
             WHERE other."deletedAt" IS NULL
               AND lower(other."emailsPrimaryEmail") = lower($9::text)
               AND other.id <> target.id
           ) THEN $9::text
           ELSE target."emailsPrimaryEmail"
         END,
         "guoJiaAddressCountry" = COALESCE($10, "guoJiaAddressCountry"),
         "keHuXuQiuChanPin" = COALESCE($11, "keHuXuQiuChanPin"),
         "keHuLaiYuan" = CASE WHEN $12::text IS NULL THEN "keHuLaiYuan" ELSE $12::text::${schema}."person_keHuLaiYuan_enum" END,
         "keHuLeiXing" = CASE WHEN $13::text IS NULL THEN "keHuLeiXing" ELSE $13::text::${schema}."person_keHuLeiXing_enum" END,
         "jobTitle" = COALESCE($14, "jobTitle"),
         "updatedAt" = now()
       WHERE target.id = $15
       RETURNING id`,
      [
        opportunity.id,
        opportunity.syncGroupCode,
        opportunity.linkedProjectId || null,
        name,
        opportunity.companyId || null,
        nonBlankOrNull(opportunity.phonePrimaryPhoneNumber),
        nonBlankOrNull(opportunity.phonePrimaryPhoneCountryCode),
        nonBlankOrNull(opportunity.phonePrimaryPhoneCallingCode),
        email,
        nonBlankOrNull(opportunity.countryAddressCountry),
        nonBlankOrNull(opportunity.keHuXuQiuChanPin),
        opportunity.keHuLaiYuan || null,
        customerType,
        nonBlankOrNull(opportunity.zhiWei),
        existing.id,
      ],
    );
    return { id: result.rows[0]?.id || existing.id, created: false };
  }

  const fallbackName = name || email || nonBlankOrNull(opportunity.phonePrimaryPhoneNumber) || nonBlankOrNull(opportunity.syncGroupCode) || '未命名客户';
  const result = await client.query(
    `INSERT INTO ${schema}.person (
       "nameFirstName",
       "nameLastName",
       "companyId",
       "phonesPrimaryPhoneNumber",
       "phonesPrimaryPhoneCountryCode",
       "phonesPrimaryPhoneCallingCode",
       "emailsPrimaryEmail",
       "guoJiaAddressCountry",
       "keHuXuQiuChanPin",
       "keHuLaiYuan",
       "keHuLeiXing",
       "jobTitle",
       "syncGroupCode",
       "sourceOpportunityId",
       "linkedProjectId"
     ) VALUES (
       $1,
       '',
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       CASE WHEN $9::text IS NULL THEN NULL ELSE $9::text::${schema}."person_keHuLaiYuan_enum" END,
       CASE WHEN $10::text IS NULL THEN NULL ELSE $10::text::${schema}."person_keHuLeiXing_enum" END,
       $11,
       $12,
       $13,
       $14
     )
     RETURNING id`,
    [
      fallbackName,
      opportunity.companyId || null,
      nonBlankOrNull(opportunity.phonePrimaryPhoneNumber),
      nonBlankOrNull(opportunity.phonePrimaryPhoneCountryCode),
      nonBlankOrNull(opportunity.phonePrimaryPhoneCallingCode),
      email,
      nonBlankOrNull(opportunity.countryAddressCountry),
      nonBlankOrNull(opportunity.keHuXuQiuChanPin),
      opportunity.keHuLaiYuan || null,
      customerType,
      nonBlankOrNull(opportunity.zhiWei),
      opportunity.syncGroupCode,
      opportunity.id,
      opportunity.linkedProjectId || null,
    ],
  );
  return { id: result.rows[0]?.id, created: true };
}

// 线索表行按钮：把当前线索同步/关联到客户(People)。要求客户需求产品已填写。
app.post('/api/opportunities/:id/convert-to-person', requireSameSite, async (req, res) => {
  const auditActor = await resolveAuditActor(req).catch((error) => {
    console.error('[audit] resolve actor failed:', error.message);
    return null;
  });
  if (!auditActor) console.warn('[audit] current user not resolved; record audit will keep API identity');
  if (!auditActor) console.warn('[audit] request summary:', auditRequestSummary(req));

  const client = await pool.connect();
  try {
    const schema = await getWorkspaceSchema();
    await client.query('BEGIN');

    const opportunityResult = await client.query(
      `SELECT
         id,
         name,
         "companyId",
         "pointOfContactId",
         "syncGroupCode",
         "linkedPersonId",
         "linkedProjectId",
         "phonePrimaryPhoneNumber",
         "phonePrimaryPhoneCountryCode",
         "phonePrimaryPhoneCallingCode",
         "emailPrimaryEmail",
         "youXiang",
         "countryAddressCountry",
         "keHuXuQiuChanPin",
         "keHuLaiYuan",
         "keHuLeiXing",
         "zhiWei"
       FROM ${schema}.opportunity
       WHERE id = $1 AND "deletedAt" IS NULL
       FOR UPDATE`,
      [req.params.id],
    );
    const opportunity = opportunityResult.rows[0];
    if (!opportunity) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'opportunity not found' });
    }
    if (!nonBlankOrNull(opportunity.keHuXuQiuChanPin)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '客户需求产品未填写', code: 'PRODUCT_REQUIRED' });
    }

    if (!nonBlankOrNull(opportunity.syncGroupCode)) {
      const codeResult = await client.query(
        `UPDATE ${schema}.opportunity
         SET "syncGroupCode" = conv.next_sync_group_code("createdAt"), "updatedAt" = now()
         WHERE id = $1
         RETURNING "syncGroupCode"`,
        [opportunity.id],
      );
      opportunity.syncGroupCode = codeResult.rows[0]?.syncGroupCode;
    }

    const person = await upsertPersonFromOpportunity(client, schema, opportunity);
    if (!person?.id) throw new Error('person upsert failed');

    await client.query(
      `UPDATE ${schema}.opportunity
       SET
         "pointOfContactId" = $2,
         "linkedPersonId" = $2,
         "updatedAt" = now()
       WHERE id = $1`,
      [opportunity.id, person.id],
    );

    await client.query('COMMIT');
    await applyRecordAudit('person', person.id, auditActor, person.created ? 'create' : 'update');
    await applyRecordAudit('opportunity', opportunity.id, auditActor, 'update');
    res.status(person.created ? 201 : 200).json({
      opportunityId: opportunity.id,
      personId: person.id,
      syncGroupCode: opportunity.syncGroupCode,
      created: person.created,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[convert-to-person] failed:', error.message);
    res.status(502).json({ error: 'convert to person failed', detail: error.message });
  } finally {
    client.release();
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
  const result = await pool.query(`SELECT c.external_chat_id, c.channel, c.status FROM conv.conversations c WHERE c.id = $1`, [req.params.id]);
  const conversation = result.rows[0];
  if (!conversation) return res.status(404).json({ error: 'conversation not found' });
  if (conversation.status !== 'takeover') return res.status(409).json({ error: '请先人工接管会话后再发送消息' });

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

// ── 邮箱：IMAP 只读收取 → conv 库 email 渠道（沉淀查看，不回复/不接 AI）────────────

// HTML-only 邮件的兜底纯文本提取（富文本/内联图片本期不还原）
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function persistEmailMessage({ fromAddress, fromName, subject, body, attachments, messageId, sentAt }) {
  const addr = String(fromAddress || '').trim().toLowerCase();
  if (!addr) return false;
  const displayName = (fromName && fromName.trim()) || addr;
  const preview = (subject && subject.trim()) || String(body || '').slice(0, 80);
  const when = sentAt || new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name, email)
      VALUES ('email', $1, $2, $1) ON CONFLICT(channel, external_id)
      DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, conv.contacts.display_name),
        email = COALESCE(EXCLUDED.email, conv.contacts.email), updated_at = now() RETURNING *`,
      [addr, displayName]);
    const contact = contactResult.rows[0];
    const conversationResult = await client.query(`INSERT INTO conv.conversations(channel, external_chat_id, contact_id)
      VALUES ('email', $1, $2) ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET updated_at = now() RETURNING *`, [addr, contact.id]);
    const conversation = conversationResult.rows[0];
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, subject, attachments, sent_at)
      VALUES ($1, $2, 'customer', $3, 'email', $4, $5, $6) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [messageId, conversation.id, body || '', subject || null,
        attachments && attachments.length ? JSON.stringify(attachments) : null, when]);
    // 邮件按时间沉淀，last_message_at 取邮件发送时间（可能早于/晚于现有值）
    if (inserted.rowCount) await client.query(
      `UPDATE conv.conversations SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2), last_message_preview = $3, updated_at = now() WHERE id = $1`,
      [conversation.id, when, preview]);
    await client.query('COMMIT');
    return inserted.rowCount > 0;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function getEmailSync(mailbox) {
  const r = await pool.query(`SELECT uid_validity AS "uidValidity", last_uid AS "lastUid" FROM conv.email_sync WHERE mailbox = $1`, [mailbox]);
  return r.rows[0] || { uidValidity: null, lastUid: 0 };
}
async function setEmailSync(mailbox, uidValidity, lastUid) {
  await pool.query(`INSERT INTO conv.email_sync(mailbox, uid_validity, last_uid, updated_at) VALUES ($1, $2, $3, now())
    ON CONFLICT(mailbox) DO UPDATE SET uid_validity = EXCLUDED.uid_validity,
      last_uid = GREATEST(conv.email_sync.last_uid, EXCLUDED.last_uid), updated_at = now()`,
    [mailbox, uidValidity, lastUid]);
}

function getEmailSyncKey() {
  return `${IMAP_USER || 'default'}:${IMAP_MAILBOX}`;
}

function getInitialStartUid(uidNext) {
  const next = Number(uidNext || 1);
  return Math.max(0, next - 1 - IMAP_INITIAL_FETCH_LIMIT);
}

let emailPolling = false;
async function pollEmailsOnce() {
  if (emailPolling) return { skipped: true, reason: 'poll already running' };
  emailPolling = true;
  const client = new ImapFlow({
    host: IMAP_HOST, port: IMAP_PORT, secure: IMAP_TLS,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD }, logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(IMAP_MAILBOX);
    try {
      const uidValidity = client.mailbox.uidValidity ? Number(client.mailbox.uidValidity) : null;
      const uidNext = client.mailbox.uidNext ? Number(client.mailbox.uidNext) : null;
      const syncKey = getEmailSyncKey();
      const sync = await getEmailSync(syncKey);
      const firstRun = sync.uidValidity == null && Number(sync.lastUid) === 0;
      let startUid = Number(sync.lastUid) || 0;
      // uidValidity 变化：旧 UID 失效，从头（去重仍靠 Message-ID）
      if (sync.uidValidity != null && uidValidity != null && Number(sync.uidValidity) !== uidValidity) {
        startUid = getInitialStartUid(uidNext);
        console.log(`[email] uidValidity changed, backfilling recent uid>${startUid}`);
      }
      // 首次接入回拉最近一小批邮件，便于验证链路；之后只增量同步新邮件
      if (firstRun && uidNext) {
        startUid = getInitialStartUid(uidNext);
        console.log(`[email] first run: backfilling up to ${IMAP_INITIAL_FETCH_LIMIT} recent mail(s), uid>${startUid}`);
      }
      let maxUid = startUid, fetchedCount = 0, insertedCount = 0;
      for await (const msg of client.fetch(`${startUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= startUid) continue; // 'N:*' 在无新邮件时会回最后一封，需过滤
        maxUid = Math.max(maxUid, msg.uid);
        fetchedCount++;
        try {
          const parsed = await simpleParser(msg.source);
          const from = (parsed.from && parsed.from.value && parsed.from.value[0]) || {};
          const attachments = (parsed.attachments || []).map(a => ({
            filename: a.filename || '(未命名)', size: a.size || 0, contentType: a.contentType || '',
          }));
          const body = (parsed.text || '').trim() || htmlToText(parsed.html || '');
          const inserted = await persistEmailMessage({
            fromAddress: from.address, fromName: from.name,
            subject: parsed.subject || '(无主题)', body, attachments,
            messageId: parsed.messageId || `email:${uidValidity}:${msg.uid}`,
            sentAt: parsed.date || new Date(),
          });
          if (inserted) insertedCount++;
        } catch (e) { console.error('[email] parse/persist failed uid', msg.uid, e.message); }
      }
      if (maxUid > startUid) await setEmailSync(syncKey, uidValidity, maxUid);
      if (fetchedCount || insertedCount) console.log(`[email] fetched ${fetchedCount}, inserted ${insertedCount}, lastUid=${maxUid}`);
      return { skipped: false, fetched: fetchedCount, inserted: insertedCount, lastUid: maxUid };
    } finally { lock.release(); }
  } finally {
    try { await client.logout(); } catch (e) {}
    emailPolling = false;
  }
}

function startEmailPoller() {
  if (!IMAP_USER || !IMAP_PASSWORD) {
    console.log('[email] IMAP not configured (IMAP_USER/IMAP_PASSWORD missing); poller disabled');
    return;
  }
  console.log(`[email] poller enabled: ${IMAP_USER}@${IMAP_HOST}:${IMAP_PORT} mailbox=${IMAP_MAILBOX} every ${IMAP_POLL_SECONDS}s`);
  const run = () => pollEmailsOnce().catch(e => console.error('[email] poll cycle failed:', e.message));
  run();
  setInterval(run, IMAP_POLL_SECONDS * 1000);
}

ensureSchema().then(() => {
  app.listen(PORT, () => console.log(`[middleware] listening on ${PORT}`));
  startEmailPoller();
}).catch(error => { console.error(error); process.exit(1); });
