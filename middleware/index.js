const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
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
const WAHA_WEBHOOK_URL = process.env.WAHA_WEBHOOK_URL || 'http://host.docker.internal:3002/api/whatsapp/webhook';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || '';
const AI_SERVICE_API_KEY = process.env.AI_SERVICE_API_KEY || '';
const AI_SERVICE_TENANT_ID = process.env.AI_SERVICE_TENANT_ID || 'nhd';
const AI_AUTO_REPLY_CHANNELS = new Set((process.env.AI_AUTO_REPLY_CHANNELS || 'website')
  .split(',')
  .map(channel => channel.trim().toLowerCase())
  .filter(Boolean));
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
const UPLOAD_DIR = process.env.CONVERSATION_UPLOAD_DIR || '/app/uploads/conversation-files';
const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.CONVERSATION_MAX_UPLOAD_MB || 25)) * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf',
  '.doc', '.docx',
  '.ppt', '.pptx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif',
]);
const ALLOWED_UPLOAD_MIME_PREFIXES = ['image/'];
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let workspaceSchemaCache = null;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      file.displayName = normalizeUploadFilename(file.originalname || '附件');
      const ext = path.extname(file.displayName).slice(0, 24);
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});
app.use('/api/uploads/conversation-files', express.static(UPLOAD_DIR, {
  fallthrough: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'),
}));

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

function publicFileUrl(req, storedName) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const isLocalDirect = host.startsWith('localhost:3002') || host.startsWith('127.0.0.1:3002');
  const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  const prefix = isLocalDirect ? '/api' : '/conv-api';
  const relative = `${prefix}/uploads/conversation-files/${encodeURIComponent(storedName)}`;
  return host ? `${proto}://${host}${relative}` : relative;
}

function fileMessageType(file = {}) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function extensionFromName(name = '') {
  return path.extname(String(name || '').trim()).toLowerCase();
}

function fileTypeFromName(name = '', fallback = 'file') {
  const ext = extensionFromName(name).replace('.', '');
  return ext || fallback;
}

function uploadFileAllowed(file = {}) {
  const title = fileTitle(file);
  const ext = extensionFromName(title);
  const mime = String(file.mimetype || '').toLowerCase();
  if (ALLOWED_UPLOAD_EXTENSIONS.has(ext)) return true;
  if (ALLOWED_UPLOAD_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) return true;
  return ALLOWED_UPLOAD_MIME_TYPES.has(mime);
}

function deleteUploadedFileBestEffort(file = {}) {
  if (!file.path) return;
  fs.unlink(file.path, () => {});
}

function attachmentFromUploadedFile(req, file, content = '') {
  const title = fileTitle(file);
  const messageType = fileMessageType(file);
  return {
    title,
    fileType: fileTypeFromName(title, messageType),
    contentType: file.mimetype || 'application/octet-stream',
    sizeBytes: file.size || 0,
    url: publicFileUrl(req, file.filename),
    caption: content || '',
  };
}

function normalizeOutboundAttachment(attachment = {}) {
  if (!attachment || typeof attachment !== 'object') return null;
  const url = String(attachment.url || attachment.href || '').trim();
  if (!url) return null;
  const title = normalizeUploadFilename(attachment.title || attachment.fileName || attachment.filename || '附件');
  const fileType = String(attachment.fileType || fileTypeFromName(title, 'file')).replace(/^\./, '').toLowerCase() || 'file';
  return {
    attachmentId: attachment.attachmentId || attachment.id || undefined,
    title,
    fileType,
    contentType: attachment.contentType || attachment.mimeType || attachment.mimetype || undefined,
    sizeBytes: Number(attachment.sizeBytes || attachment.size || 0) || undefined,
    url,
  };
}

function normalizeOutboundAttachments(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeOutboundAttachment)
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeUploadFilename(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return '附件';
  const mojibakePattern = /[ÃÂâäåæçèéðÐÑ¤¥¦§¨©ª«¬®¯°±²³µ¶·¸¹º¼½¾¿]/;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  const candidate = mojibakePattern.test(raw) && decoded && !decoded.includes('�') ? decoded : raw;
  return candidate
    .normalize('NFC')
    .replace(/[\\/:\0-\x1F\x7F]/g, '_')
    .trim()
    .slice(0, 180) || '附件';
}

function fileTitle(file = {}) {
  return file.displayName || normalizeUploadFilename(file.originalname || '附件');
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

function getExplicitTwentyTokenFromRequest(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  const forwardedToken = String(req.headers['x-twenty-access-token'] || '').trim();
  if (forwardedToken) return forwardedToken;
  return getTwentyTokenFromCookie(req);
}

async function requireAuthenticatedTwentyUser(req, res) {
  const token = getExplicitTwentyTokenFromRequest(req);
  const tokenPayload = decodeJwtPayload(token);
  const userId = tokenPayload?.sub || '';
  if (!token || !userId || !tokenPayload?.workspaceId) {
    res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
    return null;
  }
  const forwardedUserId = String(req.headers['x-twenty-user-id'] || '').trim();
  if (forwardedUserId && forwardedUserId !== userId) {
    res.status(401).json({ error: '用户身份信息不一致，请刷新 CRM 后重试' });
    return null;
  }
  try {
    await twentyGraphQL('query { opportunities(first: 1) { edges { node { id } } } }', {}, token);
  } catch {
    res.status(401).json({ error: '无法验证当前 CRM 用户，请重新登录后重试' });
    return null;
  }
  const actor = await resolveAuditActor(req);
  if (!actor) {
    res.status(403).json({ error: '当前账号没有工作区成员权限' });
    return null;
  }
  return { token, userId, actor };
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
    CREATE TABLE IF NOT EXISTS conv.outbound_requests (
      idempotency_key UUID PRIMARY KEY,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    UPDATE conv.conversations SET ai_enabled = (channel = 'website') WHERE ai_enabled IS NULL;
    -- 渠道级 AI 自动回复开关（工作台齿轮）：作为「生效范围」基线，
    -- 会话级 ai_enabled 保留为单会话覆盖位（默认 NULL 时继承此表）。
    CREATE TABLE IF NOT EXISTS conv.channel_settings (
      channel TEXT PRIMARY KEY,
      ai_enabled BOOLEAN NOT NULL DEFAULT false,
      ai_schedule_enabled BOOLEAN NOT NULL DEFAULT false,
      ai_schedule_start TIME,
      ai_schedule_end TIME,
      ai_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    ALTER TABLE conv.channel_settings ADD COLUMN IF NOT EXISTS ai_schedule_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE conv.channel_settings ADD COLUMN IF NOT EXISTS ai_schedule_start TIME;
    ALTER TABLE conv.channel_settings ADD COLUMN IF NOT EXISTS ai_schedule_end TIME;
    ALTER TABLE conv.channel_settings ADD COLUMN IF NOT EXISTS ai_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS conv.channel_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      workspace_member_id TEXT,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_session TEXT NOT NULL,
      external_account_id TEXT,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, channel, provider_session));`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS channel_accounts_active_external_account_unique
    ON conv.channel_accounts(channel, provider, external_account_id)
    WHERE external_account_id IS NOT NULL AND status <> 'unbound';
  `);
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

function composeAiReplyContent(ai) {
  const text = String(ai.replyText || ai.reply || '').trim();
  return text;
}

const AI_SETTING_CHANNELS = ['website', 'whatsapp', 'instagram', 'facebook'];
const TIME_VALUE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_AI_TIMEZONE = 'Asia/Shanghai';

function aiScheduleActiveExpression(alias = 'cs') {
  const prefix = alias ? `${alias}.` : '';
  const localTime = `(now() AT TIME ZONE COALESCE(${prefix}ai_timezone, '${DEFAULT_AI_TIMEZONE}'))::time`;
  return `(
    NOT COALESCE(${prefix}ai_schedule_enabled, false)
    OR (
      ${prefix}ai_schedule_start IS NOT NULL
      AND ${prefix}ai_schedule_end IS NOT NULL
      AND CASE
        WHEN ${prefix}ai_schedule_start <= ${prefix}ai_schedule_end
          THEN (${localTime} >= ${prefix}ai_schedule_start AND ${localTime} < ${prefix}ai_schedule_end)
        ELSE (${localTime} >= ${prefix}ai_schedule_start OR ${localTime} < ${prefix}ai_schedule_end)
      END
    )
  )`;
}

function normalizeTimeValue(value) {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 5);
  if (!TIME_VALUE_RE.test(text)) return null;
  return text;
}

function formatTimeValue(value) {
  if (value == null) return null;
  return String(value).slice(0, 5);
}

async function loadAiPolicy(conversationId) {
  const scheduleActive = aiScheduleActiveExpression('cs');
  const result = await pool.query(
    `SELECT c.id, c.external_chat_id, c.channel, c.status,
            COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AS "aiEnabled",
            ((c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND ${scheduleActive}) AS "inAiWindow"
       FROM conv.conversations c
       LEFT JOIN conv.channel_settings cs ON cs.channel = c.channel
      WHERE c.id = $1`,
    [conversationId],
  );
  return result.rows[0] || null;
}

async function recordAiMessage(conversationId, content, externalId, options = {}) {
  await pool.query(
    `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, attachments, sent_at)
     VALUES ($1, $2, 'ai', $3, $4, $5, $6, now())
     ON CONFLICT(external_msg_id) DO NOTHING`,
    [
      externalId || null,
      conversationId,
      content,
      options.contentType || 'text',
      options.mediaUrl || null,
      options.attachments ? JSON.stringify(options.attachments) : null,
    ],
  );
  await pool.query(
    `UPDATE conv.conversations
        SET last_message_at = now(), last_message_preview = $2, updated_at = now()
      WHERE id = $1`,
    [conversationId, content],
  );
}

async function sendAiReplyToChannel(policy, content, idempotencyKey, ai) {
  const attachments = normalizeOutboundAttachments(ai.attachments);
  const outboundContent = content || attachments[0]?.title || '附件';
  if (policy.channel === 'website') {
    const response = await fetch(
      `${AI_SERVICE_URL}/api/v1/conversations/${encodeURIComponent(policy.external_chat_id)}/ai-messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_SERVICE_API_KEY}` },
        body: JSON.stringify({
          content: outboundContent,
          idempotencyKey,
          metadata: {
            requestId: ai.requestId,
            status: ai.status,
            reasonCode: ai.reasonCode,
            citations: ai.citations || [],
            attachments,
          },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Website AI send failed: ${response.status} ${await response.text()}`);
    }
    const sent = await response.json();
    await recordAiMessage(policy.id, outboundContent, idempotencyKey, {
      contentType: attachments[0] ? (String(attachments[0].contentType || '').startsWith('image/') ? 'image' : 'file') : 'text',
      mediaUrl: attachments[0]?.url || null,
      attachments,
    });
    return sent;
  }

  if (policy.channel === 'whatsapp') {
    if (!WAHA_API_KEY) throw new Error('WAHA api key not configured');
    let textExternalId = null;
    if (content) {
      const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
        body: JSON.stringify({ session: WAHA_SESSION, chatId: policy.external_chat_id, text: content }),
      });
      if (!response.ok) throw new Error(`WhatsApp AI text send failed: ${response.status} ${await response.text()}`);
      const sent = await response.json();
      textExternalId = sent?.id?._serialized || sent?._data?.id?._serialized || idempotencyKey;
    }
    for (const attachment of attachments) {
      await sendWhatsAppAttachmentFromUrl(policy.external_chat_id, attachment);
    }
    await recordAiMessage(policy.id, outboundContent, textExternalId || idempotencyKey, {
      contentType: attachments[0] ? (String(attachments[0].contentType || '').startsWith('image/') ? 'image' : 'file') : 'text',
      mediaUrl: attachments[0]?.url || null,
      attachments,
    });
    return { status: 'sent', channel: 'whatsapp' };
  }

  throw new Error(`AI auto reply is not implemented for channel ${policy.channel}`);
}

// AI 客服只保留「回复 / 不回复」两种实际动作：允许时直接回复客户并落库，不再生成 ai_suggestion 草稿。
async function requestAiReplyIfAllowed(conversation, customerMessageId, message) {
  if (!AI_SERVICE_URL || !AI_SERVICE_API_KEY || !message?.trim()) return;
  const policy = await loadAiPolicy(conversation.id);
  if (!policy || !AI_AUTO_REPLY_CHANNELS.has(policy.channel)) return;
  if (!policy.aiEnabled || !policy.inAiWindow || policy.status === 'takeover' || policy.status === 'closed') return;

  const aiExternalId = `ai:auto:${customerMessageId}`;
  // 幂等：webhook 可能重复投递，已自动回复过则跳过。
  const exists = await pool.query('SELECT 1 FROM conv.messages WHERE external_msg_id = $1', [aiExternalId]);
  if (exists.rowCount) return;

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/v1/ai/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_SERVICE_API_KEY}` },
      body: JSON.stringify({
        tenantId: AI_SERVICE_TENANT_ID,
        channel: policy.channel,
        conversationId: policy.id,
        messageId: customerMessageId,
        message,
        requestId: `crm_${customerMessageId}`,
        replyPolicy: {
          humanTakeover: false,
          replyMode: 'aiReplying',
          channelActivationDecision: true,
          activationScheduleDecision: true,
          serviceAvailable: true,
        },
      }),
    });
    if (!response.ok) { console.error('[ai] reply failed:', response.status); return; }
    const ai = await response.json();
    const replyContent = composeAiReplyContent(ai);
    if (!['reply', 'fallback'].includes(ai.status) || !replyContent) {
      console.log('[ai] no auto reply:', ai.status, ai.reasonCode || '');
      return;
    }
    await sendAiReplyToChannel(policy, replyContent, aiExternalId, ai);
  } catch (error) { console.error('[ai] auto reply error:', error.message); }
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
    // 新的客户入站消息（非人工接管、文本类）按渠道 AI 策略决定是否自动回复。
    if (inserted.rowCount && !fromMe && conversation.status !== 'takeover' && parsed.type === 'text') {
      requestAiReplyIfAllowed(conversation, externalMessageId, parsed.content)
        .catch(error => console.error('[ai] auto reply failed:', error.message));
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
    if (inserted.rowCount && senderType === 'customer') {
      const aiMessageId = dedupeId || `web:${conversation.id}:${inserted.rows[0].id}`;
      requestAiReplyIfAllowed(conversation, aiMessageId, content)
        .catch(error => console.error('[ai] website auto reply failed:', error.message));
    }
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
    // 入站文本消息按渠道 AI 策略决定是否自动回复；未开启自动回复的渠道直接跳过。
    if (inserted.rowCount && !fromMe && conversation.status !== 'takeover' && parsed.type === 'text') {
      requestAiReplyIfAllowed(conversation, message.mid, parsed.content)
        .catch(error => console.error('[ai] auto reply failed:', error.message));
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
      requestAiReplyIfAllowed(conversation, message.mid, parsed.content)
        .catch(error => console.error('[ai] auto reply failed:', error.message));
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
  const scheduleActive = aiScheduleActiveExpression('cs');
  const result = await pool.query(`SELECT c.id, c.channel, c.status, c.last_message_preview AS "lastMessage", c.last_message_at AS "lastMessageAt", c.lead_draft AS "leadDraft",
    json_build_object(
      'enabled', COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website'),
      'scheduleActive', ${scheduleActive},
      'inTakeoverWindow', (COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AND (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND ${scheduleActive}),
      'canTakeover', (COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AND (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND ${scheduleActive} AND c.status NOT IN ('takeover', 'closed'))
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

function normalizeOutboundWhatsAppPhone(input) {
  let digits = String(input || '').trim().replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

app.post('/api/conversations/whatsapp', requireSameSite, async (req, res) => {
  const phone = normalizeOutboundWhatsAppPhone(req.body?.phone);
  const content = String(req.body?.content || '').trim();
  const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;

  if (!/^\d{7,15}$/.test(phone)) {
    return res.status(400).json({ error: '请输入包含国家区号的有效 WhatsApp 号码，例如 +1 202 555 0147' });
  }
  if (!content) return res.status(400).json({ error: '请输入首条消息' });
  if (content.length > 4096) return res.status(400).json({ error: '首条消息不能超过 4096 个字符' });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return res.status(400).json({ error: '请求标识无效，请关闭弹窗后重试' });
  }
  const claimed = await pool.query(
    `INSERT INTO conv.outbound_requests(idempotency_key, channel)
     VALUES ($1, 'whatsapp') ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [idempotencyKey],
  );
  if (!claimed.rowCount) {
    const previous = await pool.query(
      `SELECT status, result FROM conv.outbound_requests WHERE idempotency_key = $1 AND channel = 'whatsapp'`,
      [idempotencyKey],
    );
    if (previous.rows[0]?.status === 'completed') return res.json(previous.rows[0].result);
    if (previous.rows[0]?.status === 'sent') {
      return res.status(409).json({ error: '消息已经发出，CRM 正在归档，请刷新会话列表，勿重复发送' });
    }
    return res.status(409).json({ error: '消息正在发送，请勿重复提交' });
  }

  try {
    const session = normalizeWahaSession(await getWahaSession());
    if (!session.connected) return res.status(409).json({ error: 'WhatsApp 当前未连接，请先在设置中完成绑定' });
    const ownership = await requireCurrentUserWhatsAppBinding(req, res, session);
    if (!ownership) return;
    if (phoneFromJid(session.accountId) === phone) return res.status(400).json({ error: '不能向当前绑定的 WhatsApp 号码发起会话' });

    const checkResponse = await fetchWaha(
      `/api/contacts/check-exists?session=${encodeURIComponent(WAHA_SESSION)}&phone=${encodeURIComponent(phone)}`,
    );
    const checked = await checkResponse.json().catch(() => ({}));
    if (!checkResponse.ok) throw new Error(checked.message || 'WhatsApp 号码校验失败');
    if (!checked.numberExists || !checked.chatId) {
      return res.status(404).json({ error: '该号码未注册 WhatsApp，请检查国家区号和号码是否正确' });
    }

    const chatId = checked.chatId;
    const sentResponse = await fetchWaha('/api/sendText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: WAHA_SESSION, chatId, text: content }),
    });
    const sent = await sentResponse.json().catch(() => ({}));
    if (!sentResponse.ok) throw new Error(sent.message || 'WhatsApp 消息发送失败');

    const externalMessageId = sent?.id?._serialized || sent?._data?.id?._serialized || null;
    await pool.query(
      `UPDATE conv.outbound_requests SET status = 'sent', result = $2, updated_at = now() WHERE idempotency_key = $1`,
      [idempotencyKey, JSON.stringify({ phone: `+${phone}`, chatId, externalMessageId })],
    );
    const actorId = authenticated.userId;
    const client = await pool.connect();
    let conversation;
    let reused = false;
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id FROM conv.conversations WHERE channel = 'whatsapp' AND external_chat_id = $1`,
        [chatId],
      );
      reused = existing.rowCount > 0;
      const contactResult = await client.query(
        `INSERT INTO conv.contacts(channel, external_id, display_name, phone)
         VALUES ('whatsapp', $1, $2, $3)
         ON CONFLICT(channel, external_id) DO UPDATE SET
           phone = COALESCE(conv.contacts.phone, EXCLUDED.phone), updated_at = now()
         RETURNING id, display_name, phone`,
        [chatId, `+${phone}`, `+${phone}`],
      );
      const conversationResult = await client.query(
        `INSERT INTO conv.conversations(channel, external_chat_id, contact_id, status, agent_id)
         VALUES ('whatsapp', $1, $2, 'takeover', $3)
         ON CONFLICT(channel, external_chat_id) DO UPDATE SET
           status = 'takeover', agent_id = COALESCE(EXCLUDED.agent_id, conv.conversations.agent_id), updated_at = now()
         RETURNING id, channel, status, external_chat_id AS "externalChatId"`,
        [chatId, contactResult.rows[0].id, actorId],
      );
      conversation = conversationResult.rows[0];
      await client.query(
        `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, sent_at)
         VALUES ($1, $2, 'agent', $3, now()) ON CONFLICT(external_msg_id) DO NOTHING`,
        [externalMessageId, conversation.id, content],
      );
      await client.query(
        `UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`,
        [conversation.id, content],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const result = { conversationId: conversation.id, reused, phone: `+${phone}`, status: conversation.status };
    await pool.query(
      `UPDATE conv.outbound_requests SET status = 'completed', result = $2, updated_at = now() WHERE idempotency_key = $1`,
      [idempotencyKey, JSON.stringify(result)],
    );
    return res.status(reused ? 200 : 201).json(result);
  } catch (error) {
    console.error('[whatsapp] start conversation failed:', error.message);
    return res.status(502).json({ error: '无法发起 WhatsApp 会话', detail: error.message });
  } finally {
    await pool.query(
      `DELETE FROM conv.outbound_requests WHERE idempotency_key = $1 AND status = 'processing'`,
      [idempotencyKey],
    ).catch(() => {});
  }
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
    const scheduleActive = aiScheduleActiveExpression('cs');
    const currentResult = await client.query(
      `SELECT c.id, c.status, c.channel, c.external_chat_id, COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AS "aiEnabled",
        ((c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND ${scheduleActive}) AS "inTakeoverWindow"
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
    if (action === 'release' && conversation.channel === 'website') {
      await releaseWebsiteAiTakeover(conversation.external_chat_id);
    }
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

// 渠道级 AI 自动回复开关（工作台齿轮的「生效范围」）
app.get('/api/ai-settings', async (_req, res) => {
  try {
    const scheduleActive = aiScheduleActiveExpression('cs');
    const result = await pool.query(
      `SELECT channel,
              ai_enabled AS "enabled",
              ai_schedule_enabled AS "scheduleEnabled",
              ai_schedule_start AS "scheduleStart",
              ai_schedule_end AS "scheduleEnd",
              ai_timezone AS "timezone",
              ${scheduleActive} AS "activeNow"
         FROM conv.channel_settings cs
        ORDER BY channel`,
    );
    const map = new Map(result.rows.map(r => [r.channel, r]));
    // 保证四个渠道恒定返回，缺失的按官网默认开、其余关兜底
    res.json(AI_SETTING_CHANNELS.map(channel => {
      const row = map.get(channel);
      return {
        channel,
        enabled: row ? row.enabled : channel === 'website',
        scheduleEnabled: row ? row.scheduleEnabled : false,
        scheduleStart: row ? formatTimeValue(row.scheduleStart) : null,
        scheduleEnd: row ? formatTimeValue(row.scheduleEnd) : null,
        timezone: row?.timezone || DEFAULT_AI_TIMEZONE,
        activeNow: row ? row.activeNow : true,
      };
    }));
  } catch (error) {
    console.error('[ai-settings] load failed:', error.message);
    res.status(502).json({ error: 'ai settings load failed', detail: error.message });
  }
});

app.patch('/api/ai-settings', requireSameSite, async (req, res) => {
  const channel = String(req.body?.channel || '').trim();
  const enabled = req.body?.enabled;
  const scheduleEnabled = req.body?.scheduleEnabled === undefined ? false : req.body.scheduleEnabled;
  const scheduleStart = normalizeTimeValue(req.body?.scheduleStart);
  const scheduleEnd = normalizeTimeValue(req.body?.scheduleEnd);
  const timezone = String(req.body?.timezone || DEFAULT_AI_TIMEZONE).trim() || DEFAULT_AI_TIMEZONE;
  if (!AI_SETTING_CHANNELS.includes(channel)) return res.status(400).json({ error: 'unsupported channel' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
  if (typeof scheduleEnabled !== 'boolean') return res.status(400).json({ error: 'scheduleEnabled must be boolean' });
  if (req.body?.scheduleStart && !scheduleStart) return res.status(400).json({ error: 'scheduleStart must be HH:mm' });
  if (req.body?.scheduleEnd && !scheduleEnd) return res.status(400).json({ error: 'scheduleEnd must be HH:mm' });
  if (scheduleEnabled && (!scheduleStart || !scheduleEnd)) {
    return res.status(400).json({ error: 'scheduleStart and scheduleEnd are required when schedule is enabled' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await client.query(
      `INSERT INTO conv.channel_settings(
         channel, ai_enabled, ai_schedule_enabled, ai_schedule_start, ai_schedule_end, ai_timezone, updated_at
       ) VALUES ($1, $2, $3, $4::time, $5::time, $6, now())
       ON CONFLICT (channel) DO UPDATE SET
         ai_enabled = EXCLUDED.ai_enabled,
         ai_schedule_enabled = EXCLUDED.ai_schedule_enabled,
         ai_schedule_start = EXCLUDED.ai_schedule_start,
         ai_schedule_end = EXCLUDED.ai_schedule_end,
         ai_timezone = EXCLUDED.ai_timezone,
         updated_at = now()
       RETURNING channel, ai_enabled AS "enabled", ai_schedule_enabled AS "scheduleEnabled",
                 ai_schedule_start AS "scheduleStart", ai_schedule_end AS "scheduleEnd",
                 ai_timezone AS "timezone", ${aiScheduleActiveExpression('')} AS "activeNow"`,
      [channel, enabled, scheduleEnabled, scheduleStart, scheduleEnd, timezone],
    );
    // 清掉该渠道的会话级覆盖，令现有会话立即继承渠道设置
    await client.query(`UPDATE conv.conversations SET ai_enabled = NULL WHERE channel = $1`, [channel]);
    await client.query('COMMIT');
    const row = saved.rows[0];
    res.json({
      channel: row.channel,
      enabled: row.enabled,
      scheduleEnabled: row.scheduleEnabled,
      scheduleStart: formatTimeValue(row.scheduleStart),
      scheduleEnd: formatTimeValue(row.scheduleEnd),
      timezone: row.timezone || DEFAULT_AI_TIMEZONE,
      activeNow: row.activeNow,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ai-settings] update failed:', error.message);
    res.status(502).json({ error: 'ai settings update failed', detail: error.message });
  } finally {
    client.release();
  }
});

async function fetchWaha(pathname, options = {}) {
  return fetch(`${WAHA_API_URL}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Api-Key': WAHA_API_KEY,
    },
  });
}

function normalizeWahaSession(session = {}) {
  const me = session.me || {};
  const accountId = me.id || '';
  const phone = accountId ? `+${phoneFromJid(accountId)}` : '';
  return {
    session: session.name || WAHA_SESSION,
    status: session.status || 'UNKNOWN',
    connected: session.status === 'WORKING',
    accountId,
    phone,
    displayName: me.pushName || me.name || '',
    engine: session.engine?.engine || '',
  };
}

function normalizeWhatsAppPairingPhone(input) {
  return String(input || '').replace(/[^\d]/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isWahaSessionNotFound(error) {
  return error?.status === 404 || String(error?.detail?.message || error?.message || '').toLowerCase().includes('session not found');
}

async function createWahaSession() {
  const response = await fetchWaha('/api/sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: WAHA_SESSION,
      config: {
        webhooks: [
          {
            url: WAHA_WEBHOOK_URL,
            events: ['message', 'session.status'],
          },
        ],
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 409 && response.status !== 422) {
    const error = new Error(data.message || data.error || 'WAHA session create failed');
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  return data;
}

async function ensureWahaSession() {
  try {
    return await getWahaSession();
  } catch (error) {
    if (!isWahaSessionNotFound(error)) throw error;
    await createWahaSession();
    return waitForWahaStatus(['STARTING', 'SCAN_QR_CODE', 'WORKING', 'FAILED', 'STOPPED'], 10, 1000);
  }
}

async function getWahaSession() {
  const response = await fetchWaha(`/api/sessions/${encodeURIComponent(WAHA_SESSION)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'WAHA status failed');
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  return data;
}

async function waitForWahaStatus(expectedStatuses, attempts = 8, delayMs = 1200) {
  for (let i = 0; i < attempts; i++) {
    const session = await getWahaSession();
    if (expectedStatuses.includes(session.status)) return session;
    await sleep(delayMs);
  }
  return getWahaSession();
}

async function getActiveWhatsAppBindingByAccount(accountId) {
  if (!accountId) return null;
  const result = await pool.query(
    `SELECT ca.*, wm."nameFirstName", wm."nameLastName"
     FROM conv.channel_accounts ca
     LEFT JOIN ${await getWorkspaceSchema()}."workspaceMember" wm ON wm.id::text = ca.workspace_member_id
     WHERE ca.channel = 'whatsapp'
       AND ca.provider = 'waha'
       AND ca.external_account_id = $1
       AND ca.status <> 'unbound'
     ORDER BY ca.updated_at DESC
     LIMIT 1`,
    [accountId],
  );
  return result.rows[0] || null;
}

async function getCurrentUserWhatsAppBinding(userId) {
  if (!userId) return null;
  const result = await pool.query(
    `SELECT *
     FROM conv.channel_accounts
     WHERE user_id = $1
       AND channel = 'whatsapp'
       AND provider = 'waha'
       AND provider_session = $2
       AND status <> 'unbound'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, WAHA_SESSION],
  );
  return result.rows[0] || null;
}

function formatBindingOwner(binding) {
  if (!binding) return '';
  return [binding.nameFirstName, binding.nameLastName].filter(Boolean).join(' ').trim() || '其他 CRM 用户';
}

async function bindWhatsAppChannelAccount(authenticated, normalized) {
  if (!authenticated?.userId || !normalized.connected || !normalized.accountId) {
    throw new Error('WhatsApp 尚未连接，无法绑定');
  }
  const existing = await getActiveWhatsAppBindingByAccount(normalized.accountId);
  if (existing && existing.user_id !== authenticated.userId) {
    const error = new Error(`该 WhatsApp 已绑定到 ${formatBindingOwner(existing)}，请先由原账号解绑`);
    error.status = 409;
    throw error;
  }
  const current = await getCurrentUserWhatsAppBinding(authenticated.userId);
  if (current && current.external_account_id && current.external_account_id !== normalized.accountId) {
    const error = new Error('当前 CRM 账号已绑定其他 WhatsApp，请先解绑后再绑定新号码');
    error.status = 409;
    throw error;
  }
  const actor = authenticated.actor || null;
  await pool.query(
    `INSERT INTO conv.channel_accounts(
       user_id, workspace_member_id, channel, provider, provider_session,
       external_account_id, display_name, status, metadata, updated_at
     ) VALUES ($1, $2, 'whatsapp', 'waha', $3, $4, $5, $6, $7, now())
     ON CONFLICT(user_id, channel, provider_session)
     DO UPDATE SET
       workspace_member_id = EXCLUDED.workspace_member_id,
       external_account_id = EXCLUDED.external_account_id,
       display_name = EXCLUDED.display_name,
       status = EXCLUDED.status,
       metadata = EXCLUDED.metadata,
       updated_at = now()`,
    [
      authenticated.userId,
      actor?.id || null,
      normalized.session,
      normalized.accountId || null,
      normalized.displayName || normalized.phone || null,
      normalized.status,
      JSON.stringify({ phone: normalized.phone, engine: normalized.engine }),
    ],
  );
}

async function requireCurrentUserWhatsAppBinding(req, res, normalizedSession = null) {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return null;
  const normalized = normalizedSession || normalizeWahaSession(await getWahaSession());
  if (!normalized.connected) {
    res.status(409).json({ error: 'WhatsApp 当前未连接，请先在设置中完成绑定' });
    return null;
  }
  const binding = await getActiveWhatsAppBindingByAccount(normalized.accountId);
  if (!binding) {
    res.status(403).json({ error: '当前 WhatsApp 已连接但尚未绑定到 CRM 账号，请先在设置中点击“绑定到我的账号”' });
    return null;
  }
  if (binding.user_id !== authenticated.userId) {
    res.status(403).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，当前账号不能使用该号码发送消息` });
    return null;
  }
  return { authenticated, binding, session: normalized };
}

app.get('/api/channel-accounts/whatsapp/status', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    const data = await ensureWahaSession();
    const normalized = normalizeWahaSession(data);
    const binding = normalized.accountId
      ? await getActiveWhatsAppBindingByAccount(normalized.accountId)
      : await getCurrentUserWhatsAppBinding(authenticated.userId);
    res.json({
      channel: 'whatsapp',
      provider: 'waha',
      ...normalized,
      phone: normalized.phone || binding?.metadata?.phone || '',
      accountId: normalized.accountId || binding?.external_account_id || '',
      displayName: normalized.displayName || binding?.display_name || '',
      binding: {
        bound: !!binding,
        boundToCurrentUser: !!binding && binding.user_id === authenticated.userId,
        boundByOther: !!binding && binding.user_id !== authenticated.userId,
        ownerName: binding && binding.user_id !== authenticated.userId ? formatBindingOwner(binding) : '',
      },
      qrAvailable: ['SCAN_QR_CODE', 'FAILED', 'STOPPED', 'STARTING'].includes(normalized.status),
    });
  } catch (error) {
    res.status(error.status || 502).json({ error: 'WhatsApp status failed', detail: error.detail || error.message });
  }
});

app.get('/api/channel-accounts/whatsapp/qr', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    const current = normalizeWahaSession(await ensureWahaSession().catch(() => ({})));
    if (current.connected) {
      const binding = await getActiveWhatsAppBindingByAccount(current.accountId);
      if (binding && binding.user_id !== authenticated.userId) {
        return res.status(409).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，不能获取二维码` });
      }
    }
    let response = await fetchWaha(`/api/${encodeURIComponent(WAHA_SESSION)}/auth/qr`);
    if (response.status === 422) {
      const detail = await response.json().catch(() => ({}));
      if (['FAILED', 'STOPPED'].includes(detail.status)) {
        await fetchWaha(`/api/sessions/${encodeURIComponent(WAHA_SESSION)}/restart`, { method: 'POST' });
        await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING']);
        response = await fetchWaha(`/api/${encodeURIComponent(WAHA_SESSION)}/auth/qr`);
      } else if (detail.status === 'STARTING') {
        await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING']);
        response = await fetchWaha(`/api/${encodeURIComponent(WAHA_SESSION)}/auth/qr`);
      } else {
        return res.status(422).json(detail);
      }
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      return res.status(response.status).type('application/json').send(buffer.toString('utf8'));
    }
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(buffer);
  } catch (error) {
    res.status(502).json({ error: 'WhatsApp QR failed', detail: error.message });
  }
});

app.post('/api/channel-accounts/whatsapp/start', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    let current = await ensureWahaSession().catch(() => null);
    if (!current || ['FAILED', 'STOPPED'].includes(current.status)) {
      await fetchWaha(`/api/sessions/${encodeURIComponent(WAHA_SESSION)}/restart`, { method: 'POST' });
      current = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING']);
    } else if (current.status === 'STARTING') {
      current = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING']);
    } else if (current.status !== 'SCAN_QR_CODE' && current.status !== 'WORKING') {
      const response = await fetchWaha(`/api/sessions/${encodeURIComponent(WAHA_SESSION)}/start`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 422) {
        return res.status(response.status).json({ error: data.message || 'WAHA start failed', detail: data });
      }
      current = response.ok ? data : await getWahaSession();
    }
    const normalized = normalizeWahaSession(current);
    res.status(202).json({
      channel: 'whatsapp',
      provider: 'waha',
      ...normalized,
      qrAvailable: ['SCAN_QR_CODE', 'FAILED', 'STOPPED', 'STARTING'].includes(normalized.status),
    });
  } catch (error) {
    res.status(502).json({ error: 'WhatsApp start failed', detail: error.message });
  }
});

app.post('/api/channel-accounts/whatsapp/restart', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    const current = await ensureWahaSession().catch(() => null);
    if (current?.status === 'WORKING') {
      const normalized = normalizeWahaSession(current);
      const binding = await getActiveWhatsAppBindingByAccount(normalized.accountId);
      if (binding && binding.user_id !== authenticated.userId) {
        return res.status(409).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，不能刷新二维码` });
      }
      return res.status(202).json({
        channel: 'whatsapp',
        provider: 'waha',
        ...normalized,
        qrAvailable: false,
        skipped: 'already_connected',
      });
    }

    await fetchWaha(`/api/sessions/${encodeURIComponent(WAHA_SESSION)}/restart`, { method: 'POST' });
    const session = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 12, 1200);
    const normalized = normalizeWahaSession(session);
    res.status(202).json({
      channel: 'whatsapp',
      provider: 'waha',
      ...normalized,
      qrAvailable: ['SCAN_QR_CODE', 'FAILED', 'STOPPED', 'STARTING'].includes(normalized.status),
    });
  } catch (error) {
    res.status(502).json({ error: 'WhatsApp restart failed', detail: error.message });
  }
});

app.post('/api/channel-accounts/whatsapp/request-code', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    const phoneNumber = normalizeWhatsAppPairingPhone(req.body?.phoneNumber);
    if (phoneNumber.length < 8 || phoneNumber.length > 15) {
      return res.status(400).json({ error: '请输入带国家区号的 WhatsApp 号码，例如 8613800000000（仅示例）' });
    }

    let current = await ensureWahaSession().catch(() => null);
    if (current?.status === 'WORKING') {
      const normalized = normalizeWahaSession(current);
      const binding = await getActiveWhatsAppBindingByAccount(normalized.accountId);
      if (binding && binding.user_id !== authenticated.userId) {
        return res.status(409).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，不能生成配对码` });
      }
      return res.status(409).json({ error: '当前 WhatsApp 已连接，不需要生成配对码', status: normalized.status });
    }
    if (!current || ['FAILED', 'STOPPED'].includes(current.status)) {
      await fetchWaha(`/api/sessions/${encodeURIComponent(WAHA_SESSION)}/restart`, { method: 'POST' });
      current = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 12, 1200);
    } else if (current.status === 'STARTING') {
      current = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 12, 1200);
    }
    if (current?.status === 'WORKING') {
      const normalized = normalizeWahaSession(current);
      const binding = await getActiveWhatsAppBindingByAccount(normalized.accountId);
      if (binding && binding.user_id !== authenticated.userId) {
        return res.status(409).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，不能生成配对码` });
      }
      return res.status(409).json({ error: '当前 WhatsApp 已连接，不需要生成配对码', status: normalized.status });
    }

    const response = await fetchWaha(`/api/${encodeURIComponent(WAHA_SESSION)}/auth/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || data.error || 'WhatsApp 配对码生成失败', detail: data });
    }
    res.status(201).json({
      channel: 'whatsapp',
      provider: 'waha',
      session: WAHA_SESSION,
      phoneNumber,
      code: data.code,
      expiresHint: '请在生成后 60 秒内在 WhatsApp 手机端输入配对码，超时需重新生成。',
    });
  } catch (error) {
    res.status(502).json({ error: 'WhatsApp 配对码生成失败', detail: error.message });
  }
});

app.post('/api/channel-accounts/whatsapp/bind', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    const normalized = normalizeWahaSession(await ensureWahaSession());
    await bindWhatsAppChannelAccount(authenticated, normalized);
    res.status(200).json({
      channel: 'whatsapp',
      provider: 'waha',
      ...normalized,
      binding: { bound: true, boundToCurrentUser: true, boundByOther: false, ownerName: authenticated.actor?.name || '' },
      qrAvailable: false,
    });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || 'WhatsApp 绑定失败' });
  }
});

async function logoutWahaSession() {
  const candidates = [
    { pathname: `/api/sessions/${encodeURIComponent(WAHA_SESSION)}/logout`, method: 'POST' },
    { pathname: `/api/${encodeURIComponent(WAHA_SESSION)}/auth/logout`, method: 'POST' },
  ];
  let lastText = '';
  for (const candidate of candidates) {
    const response = await fetchWaha(candidate.pathname, { method: candidate.method });
    const text = await response.text().catch(() => '');
    if (response.ok || response.status === 422) return true;
    lastText = text || `${response.status}`;
    if (![404, 405].includes(response.status)) throw new Error(lastText);
  }
  throw new Error(lastText || 'WAHA logout endpoint not available');
}

app.delete('/api/channel-accounts/whatsapp', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    const binding = await getCurrentUserWhatsAppBinding(authenticated.userId);
    if (!binding) return res.status(404).json({ error: '当前 CRM 账号未绑定 WhatsApp' });
    const normalized = normalizeWahaSession(await getWahaSession().catch(() => ({})));
    if (normalized.connected && normalized.accountId && normalized.accountId !== binding.external_account_id) {
      return res.status(409).json({ error: '当前在线 WhatsApp 与该绑定记录不一致，请刷新状态后重试' });
    }
    if (normalized.connected) await logoutWahaSession();
    await pool.query(
      `UPDATE conv.channel_accounts
       SET status = 'unbound',
           metadata = metadata || jsonb_build_object('unboundAt', now(), 'unboundBy', $2),
           updated_at = now()
       WHERE id = $1`,
      [binding.id, authenticated.userId],
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: 'WhatsApp 解绑失败', detail: error.message });
  }
});

const CUSTOMER_WEBSITE_OBJECTS = {
  opportunity: { label: '线索' },
  person: { label: '客户' },
  xiangMu: { label: '项目' },
};

async function normalizedWebsiteDomain(client, websiteUrl) {
  const result = await client.query(
    'SELECT conv.normalized_website_domain($1) AS domain',
    [String(websiteUrl || '').trim()],
  );
  return result.rows[0]?.domain || null;
}

async function findWebsiteRelatedRecords(client, schema, domain) {
  const result = await client.query(
    `SELECT * FROM (
       SELECT 'opportunity'::text AS "objectName", '线索'::text AS "objectLabel",
              id, COALESCE(NULLIF(name, ''), '未命名线索') AS name,
              "syncGroupCode", "customerIdentityKey", "createdAt"
       FROM ${schema}.opportunity
       WHERE "deletedAt" IS NULL
         AND conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl") = $1
       UNION ALL
       SELECT 'person', '客户', id,
              COALESCE(NULLIF(concat_ws(' ', "nameFirstName", "nameLastName"), ''), '未命名客户'),
              "syncGroupCode", "customerIdentityKey", "createdAt"
       FROM ${schema}.person
       WHERE "deletedAt" IS NULL
         AND conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl") = $1
       UNION ALL
       SELECT 'xiangMu', '项目', id, COALESCE(NULLIF(name, ''), '未命名项目'),
              "syncGroupCode", "customerIdentityKey", "createdAt"
       FROM ${schema}."_xiangMu"
       WHERE "deletedAt" IS NULL
         AND conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl") = $1
     ) records
     ORDER BY "createdAt", id`,
    [domain],
  );
  return result.rows;
}

app.post('/api/customer-websites/check', requireSameSite, async (req, res) => {
  const objectName = String(req.body?.objectName || '');
  const recordId = String(req.body?.recordId || '');
  const websiteUrl = String(req.body?.websiteUrl || '');
  if (!CUSTOMER_WEBSITE_OBJECTS[objectName] || !/^[0-9a-f-]{36}$/i.test(recordId)) {
    return res.status(400).json({ error: '重复检查参数无效' });
  }

  const client = await pool.connect();
  try {
    const schema = await getWorkspaceSchema();
    const domain = await normalizedWebsiteDomain(client, websiteUrl);
    if (!domain) return res.json({ domain: null, related: [], requiresConfirmation: false });
    const records = await findWebsiteRelatedRecords(client, schema, domain);
    const current = records.find((item) => item.objectName === objectName && item.id === recordId);
    const related = records.filter((item) => {
      if (item.objectName === objectName && item.id === recordId) return false;
      // 相同业务链已由 syncGroupCode 明确关联，不需要再次弹出客户归类确认。
      if (current?.syncGroupCode && item.syncGroupCode === current.syncGroupCode) return false;
      return true;
    });
    const alreadyGrouped = !!current?.customerIdentityKey
      && related.length > 0
      && related.every((item) => item.customerIdentityKey === current.customerIdentityKey);
    res.json({ domain, related, requiresConfirmation: related.length > 0 && !alreadyGrouped, alreadyGrouped });
  } catch (error) {
    console.error('[customer-websites/check] failed:', error.message);
    res.status(502).json({ error: '官网重复检查失败', detail: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/customer-websites/group', requireSameSite, async (req, res) => {
  const objectName = String(req.body?.objectName || '');
  const recordId = String(req.body?.recordId || '');
  const websiteUrl = String(req.body?.websiteUrl || '');
  if (!CUSTOMER_WEBSITE_OBJECTS[objectName] || !/^[0-9a-f-]{36}$/i.test(recordId)) {
    return res.status(400).json({ error: '归类参数无效' });
  }

  const client = await pool.connect();
  try {
    const schema = await getWorkspaceSchema();
    await client.query('BEGIN');
    const domain = await normalizedWebsiteDomain(client, websiteUrl);
    if (!domain) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: '官网链接无效，无法归类' });
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext('customer-website:' || $1))", [domain]);
    const records = await findWebsiteRelatedRecords(client, schema, domain);
    if (!records.some((item) => item.objectName === objectName && item.id === recordId)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '当前记录不存在或官网链接已变更' });
    }
    if (records.length < 2) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '当前没有可归类的相关记录' });
    }

    let customerIdentityKey = records.find((item) => item.customerIdentityKey)?.customerIdentityKey;
    if (!customerIdentityKey) {
      const keyResult = await client.query(
        "SELECT 'NHDWEB-' || upper(substr(encode(digest($1, 'sha256'), 'hex'), 1, 20)) AS key",
        [domain],
      );
      customerIdentityKey = keyResult.rows[0].key;
    }

    for (const tableName of ['opportunity', 'person', '_xiangMu']) {
      await client.query(
        `UPDATE ${schema}."${tableName}"
         SET "customerIdentityKey" = $2
         WHERE "deletedAt" IS NULL
           AND conv.normalized_website_domain("guanWangLianJiePrimaryLinkUrl") = $1`,
        [domain, customerIdentityKey],
      );
    }
    await client.query('COMMIT');
    res.json({ grouped: true, domain, customerIdentityKey, count: records.length, records });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[customer-websites/group] failed:', error.message);
    res.status(502).json({ error: '相关记录归类失败', detail: error.message });
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
const workspaceColumnExistsCache = new Map();
const normalizeEmailList = (value) => String(value || '')
  .split(EMAIL_SEPARATOR_RE)
  .map((item) => item.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''))
  .filter(Boolean);
// 线索转客户：可双向同步的客户类型枚举 + 字段清洗工具
const SHARED_CUSTOMER_TYPES = new Set(['ZHONG_JIAN_SHANG', 'YE_ZHU', 'EPC', 'JI_SHU_ZI_XUN']);
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

async function workspaceColumnExists(tableName, columnName) {
  const schema = await getWorkspaceSchema();
  const cacheKey = `${schema}.${tableName}.${columnName}`;
  if (workspaceColumnExistsCache.has(cacheKey)) return workspaceColumnExistsCache.get(cacheKey);
  const result = await pool.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
      LIMIT 1`,
    [schema, tableName, columnName],
  );
  const exists = result.rowCount > 0;
  workspaceColumnExistsCache.set(cacheKey, exists);
  return exists;
}

async function stripUnavailableOpportunityFields(data, skipped = []) {
  const optionalCustomFields = ['keHuLeiXing', OPPORTUNITY_EMAIL_FIELD];
  for (const field of optionalCustomFields) {
    if (data[field] !== undefined && !(await workspaceColumnExists('opportunity', field))) {
      delete data[field];
      skipped.push(field === 'keHuLeiXing' ? 'companyType' : 'email');
    }
  }
}

async function opportunitySelectExpression(fieldName, fallbackExpression = 'NULL') {
  return (await workspaceColumnExists('opportunity', fieldName))
    ? `"${fieldName}"`
    : `${fallbackExpression} AS "${fieldName}"`;
}

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
  const source = b.source || SOURCE_BY_CHANNEL[row.channel];
  const isWebsiteFormSource = source === 'GUAN_WANG_BIAO_DAN';
  if (personId) data.pointOfContactId = personId;
  if (b.stage && !isWebsiteFormSource) data.stage = String(b.stage);
  if (source) data.keHuLaiYuan = source;
  if (isWebsiteFormSource) data.stage = 'XIANSUO';
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
  if (!isWebsiteFormSource && (rawPhone || email) && (!data.stage || data.stage === 'XIANSUO')) data.stage = 'YOUXIAO_XIANSUO';
  const country = String(b.country || '').trim();
  if (country) data.country = { addressCountry: country };
  await stripUnavailableOpportunityFields(data, skipped);

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
         "country" = COALESCE($10, "country"),
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
       "country",
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

function convertToPersonFailure(error) {
  const message = String(error?.message || '').trim();
  const detail = String(error?.detail || '').trim();
  const code = error?.code || '';
  if (code === '23505') {
    return {
      code: 'DUPLICATE_VALUE',
      error: '客户表存在唯一字段冲突',
      detail: detail || message || '可能是邮箱、电话或关联编码已存在。',
    };
  }
  if (code === '22P02') {
    return {
      code: 'INVALID_SELECT_OPTION',
      error: '下拉选项值不匹配',
      detail: detail || message || '线索表中的选项值无法写入客户表，请检查客户来源、客户类型等选项是否已补齐。',
    };
  }
  if (code === '23503') {
    return {
      code: 'RELATION_NOT_FOUND',
      error: '关联记录不存在',
      detail: detail || message || '线索关联的公司、联系人或项目已不存在，无法建立客户关联。',
    };
  }
  if (code === '42703') {
    return {
      code: 'FIELD_NOT_FOUND',
      error: '客户表或线索表字段不存在',
      detail: detail || message || '可能有字段被停用、重命名或尚未创建。',
    };
  }
  if (code === '42P01') {
    return {
      code: 'TABLE_NOT_FOUND',
      error: 'CRM 数据表不存在',
      detail: detail || message || '当前工作区数据表结构异常。',
    };
  }
  if (code === '42804') {
    return {
      code: 'FIELD_TYPE_MISMATCH',
      error: '字段类型不匹配',
      detail: detail || message || '线索字段和客户字段类型不一致，无法同步写入。',
    };
  }
  return {
    code: code || 'CONVERT_FAILED',
    error: '转客户失败',
    detail: detail || message || '未知错误，请联系管理员查看服务日志。',
  };
}

async function applyRecordAuditBestEffort(tableName, recordId, actor, operation) {
  try {
    await applyRecordAudit(tableName, recordId, actor, operation);
  } catch (error) {
    console.warn(`[audit] ${tableName} ${recordId} ${operation} audit failed:`, error.message);
  }
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
    const opportunityKeHuLeiXingSelect = await opportunitySelectExpression('keHuLeiXing');
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
         ${opportunityKeHuLeiXingSelect},
         "zhiWei"
       FROM ${schema}.opportunity
       WHERE id = $1 AND "deletedAt" IS NULL
       FOR UPDATE`,
      [req.params.id],
    );
    const opportunity = opportunityResult.rows[0];
    if (!opportunity) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        code: 'OPPORTUNITY_NOT_FOUND',
        error: '线索不存在或已删除',
        detail: '未找到该线索记录，可能已被删除或当前工作区不可见。',
      });
    }
    if (!nonBlankOrNull(opportunity.keHuXuQiuChanPin)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'PRODUCT_REQUIRED',
        error: '客户需求产品未填写',
        detail: '请先在线索表填写「客户需求产品」，再执行转客户。',
      });
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
    await applyRecordAuditBestEffort('person', person.id, auditActor, person.created ? 'create' : 'update');
    await applyRecordAuditBestEffort('opportunity', opportunity.id, auditActor, 'update');
    res.status(person.created ? 201 : 200).json({
      opportunityId: opportunity.id,
      personId: person.id,
      syncGroupCode: opportunity.syncGroupCode,
      created: person.created,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const failure = convertToPersonFailure(error);
    console.error('[convert-to-person] failed:', failure.code, failure.error, failure.detail);
    res.status(502).json(failure);
  } finally {
    client.release();
  }
});

// 记录销售在 CRM 内发出的消息。用渠道返回的消息 id 落库，与 message.any webhook 回传的
// 同一条出站消息（fromMe=true，external_msg_id 同为该 id）去重，避免重复。
async function recordAgentMessage(conversationId, content, externalId, options = {}) {
  await pool.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, attachments, sent_at)
    VALUES ($1, $2, 'agent', $3, $4, $5, $6, now()) ON CONFLICT(external_msg_id) DO NOTHING`,
    [
      externalId || null,
      conversationId,
      content,
      options.contentType || 'text',
      options.mediaUrl || null,
      options.attachments ? JSON.stringify(options.attachments) : null,
    ]);
  await pool.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversationId, content]);
}

async function sendWebsiteAgentMessage(conversation, content, idempotencyKey, attachment) {
  if (!AI_SERVICE_URL) throw new Error('AI service url not configured');
  const auth = Buffer.from(`${AI_AGENT_USER}:${AI_AGENT_PASSWORD}`).toString('base64');
  const attachments = normalizeOutboundAttachments(attachment ? [attachment] : []);
  const response = await fetch(`${AI_SERVICE_URL}/api/agent/conversations/${encodeURIComponent(conversation.external_chat_id)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      content,
      idempotencyKey,
      agentId: 'crm',
      metadata: attachments.length ? { attachments } : {},
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function releaseWebsiteAiTakeover(externalChatId) {
  if (!AI_SERVICE_URL || !AI_SERVICE_API_KEY || !externalChatId) return;
  const response = await fetch(`${AI_SERVICE_URL}/api/v1/conversations/${encodeURIComponent(externalChatId)}/release-takeover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_SERVICE_API_KEY}` },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error(await response.text());
}

async function sendWhatsAppAttachmentFromUrl(chatId, attachment) {
  const contentType = String(attachment.contentType || '').toLowerCase();
  const fileType = String(attachment.fileType || '').toLowerCase();
  const endpoint = contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fileType)
    ? '/api/sendImage'
    : contentType.startsWith('video/')
      ? '/api/sendVideo'
      : '/api/sendFile';
  const response = await fetch(`${WAHA_API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
    body: JSON.stringify({
      session: WAHA_SESSION,
      chatId,
      file: {
        mimetype: attachment.contentType || 'application/octet-stream',
        filename: attachment.title || '附件',
        url: attachment.url,
      },
    }),
  });
  if (!response.ok) throw new Error(`WhatsApp attachment send failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function sendWhatsAppFile(conversation, file, content) {
  const endpoint = file.mimetype?.startsWith('image/')
    ? '/api/sendImage'
    : file.mimetype?.startsWith('video/')
      ? '/api/sendVideo'
      : '/api/sendFile';
  const filename = fileTitle(file);
  const response = await fetch(`${WAHA_API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
    body: JSON.stringify({
      session: WAHA_SESSION,
      chatId: conversation.external_chat_id,
      caption: content || undefined,
      file: {
        mimetype: file.mimetype,
        filename,
        data: fs.readFileSync(file.path).toString('base64'),
      },
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

app.post('/api/conversations/:id/messages', requireSameSite, upload.single('file'), async (req, res) => {
  const content = String(req.body?.content || '').trim();
  const uploadedFile = req.file || null;
  if (!content && !uploadedFile) return res.status(400).json({ error: 'content or file is required' });
  const result = await pool.query(`SELECT c.external_chat_id, c.channel, c.status FROM conv.conversations c WHERE c.id = $1`, [req.params.id]);
  const conversation = result.rows[0];
  if (!conversation) return res.status(404).json({ error: 'conversation not found' });
  if (conversation.status !== 'takeover') return res.status(409).json({ error: '请先人工接管会话后再发送消息' });
  if (conversation.channel === 'whatsapp') {
    const ownership = await requireCurrentUserWhatsAppBinding(req, res);
    if (!ownership) {
      if (uploadedFile) deleteUploadedFileBestEffort(uploadedFile);
      return;
    }
  }

  if (uploadedFile) {
    if (!uploadFileAllowed(uploadedFile)) {
      deleteUploadedFileBestEffort(uploadedFile);
      return res.status(400).json({
        error: '当前仅支持上传 PDF、PPT、Word 和图片附件',
        detail: '支持格式：pdf、ppt、pptx、doc、docx、png、jpg、jpeg、gif、webp、bmp、tif、tiff、heic、heif',
      });
    }
    const mediaUrl = publicFileUrl(req, uploadedFile.filename);
    const title = fileTitle(uploadedFile);
    const messageType = fileMessageType(uploadedFile);
    const displayContent = content || title;
    const attachment = attachmentFromUploadedFile(req, uploadedFile, content);

    if (conversation.channel === 'whatsapp') {
      try {
        const sent = await sendWhatsAppFile(conversation, uploadedFile, content);
        await recordAgentMessage(req.params.id, displayContent, sent?.id?._serialized || sent?._data?.id?._serialized, {
          contentType: messageType,
          mediaUrl,
          attachments: [attachment],
        });
        return res.status(202).json(sent);
      } catch (error) {
        return res.status(502).json({ error: 'WhatsApp file send failed', detail: error.message });
      }
    }

    if (conversation.channel === 'website') {
      try {
        const idempotencyKey = `crm-file:${req.params.id}:${Date.now()}`;
        const sent = await sendWebsiteAgentMessage(conversation, displayContent, idempotencyKey, attachment);
        await recordAgentMessage(req.params.id, displayContent, `web:agent:${sent?.messageId || idempotencyKey}`, {
          contentType: messageType,
          mediaUrl,
          attachments: [attachment],
        });
        return res.status(202).json(sent);
      } catch (error) {
        return res.status(502).json({ error: 'Website file send failed', detail: error.message });
      }
    }

    return res.status(400).json({ error: '当前渠道暂不支持发送附件' });
  }

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
    // external_chat_id 即 ai-service 的 conversationId；注入一条 agent 消息，widget 轮询即可看到。
    const idempotencyKey = `crm:${req.params.id}:${Date.now()}`;
    let sent;
    try {
      sent = await sendWebsiteAgentMessage(conversation, content, idempotencyKey);
    } catch (error) {
      return res.status(502).json({ error: 'Website send failed', detail: error.message });
    }
    await recordAgentMessage(req.params.id, content, `web:agent:${sent?.messageId || idempotencyKey}`);
    return res.status(202).json(sent);
  }

  res.status(400).json({ error: 'channel is not supported yet' });
});

app.use((error, _req, res, next) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `附件不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` });
    }
    return res.status(400).json({ error: '附件上传失败', detail: error.message });
  }
  return next(error);
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
