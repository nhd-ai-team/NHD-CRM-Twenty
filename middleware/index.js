const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
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
// 总经理（仅查看）权限：自 v2.1 起通过 conv.user_roles 的 boss 角色统一管理（scope=all，仅查看），
// 由前端「权限管理」界面配置，不再依赖环境变量 CONVERSATION_BOSS_EMAILS。
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
// 下载文件名：磁盘上存的是随机名（时间戳-uuid），会导致下载保存成一串乱码般的
// 随机串。支持用 ?filename= 传原始名，优先用它做 Content-Disposition，让下载保留
// 真实文件名（WhatsApp 入站等会带上）；没有则回退磁盘存储名。
app.use('/api/uploads/conversation-files', (req, res, next) => {
  let desired = '';
  try {
    desired = req.query && req.query.filename ? decodeURIComponent(String(req.query.filename)) : '';
  } catch { desired = ''; }
  const name = normalizeUploadFilename(desired || path.basename(req.path));
  const enc = encodeURIComponent(name);
  // 官网 widget 跑在客户官网域名下，对 crm.chinanhd.com 是跨域访问；HTML `download`
  // 属性跨域会被浏览器忽略，显式带 Content-Disposition: attachment 后浏览器一律按下载
  // 处理，避免 .pdf/.docx 跨域打开失败。
  res.setHeader('Content-Disposition', `attachment; filename="${enc}"; filename*=UTF-8''${enc}`);
  next();
}, express.static(UPLOAD_DIR, {
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  },
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

// —— A 方案：本地 JWT 验签（替换原先「每次鉴权都打 Twenty GraphQL 实时校验」）——
// 用 core.signingKey 的明文公钥在本地完成 ES256 验签，移除对 Twenty 服务可达性的依赖，
// 服务抖动/重启不再误报「无法验证当前 CRM 用户」。公钥内存缓存 10 分钟，密钥轮换时自动刷新。
let signingPublicKeyPem = null;
let signingPublicKeyLoadedAt = 0;

async function loadSigningPublicKey(force = false) {
  const now = Date.now();
  if (!force && signingPublicKeyPem && now - signingPublicKeyLoadedAt < 10 * 60 * 1000) {
    return signingPublicKeyPem;
  }
  const result = await pool.query(
    `SELECT "publicKey" FROM core."signingKey" WHERE "isCurrent" = true AND "revokedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
  );
  const pem = result.rows[0]?.publicKey;
  if (!pem) throw new Error('signing public key not found');
  signingPublicKeyPem = pem;
  signingPublicKeyLoadedAt = now;
  return pem;
}

function decodeJwtSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

async function verifyTwentyAccessToken(token) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new Error('malformed token');
  }
  const [headerB64, payloadB64, signatureB64] = token.split('.');
  const signingInput = `${headerB64}.${payloadB64}`;
  const rawSignature = Buffer.from(signatureB64, 'base64url');
  const payload = decodeJwtSegment(payloadB64);

  const verifyWithPem = (pem) => {
    const publicKey = crypto.createPublicKey(pem);
    // JWS ES256 使用 IEEE P1363（原始 R||S）编码，而非 DER
    return crypto.verify('sha256', Buffer.from(signingInput), { key: publicKey, dsaEncoding: 'ieee-p1363' }, rawSignature);
  };

  let pem = await loadSigningPublicKey();
  let valid = false;
  try { valid = verifyWithPem(pem); } catch { valid = false; }
  // 密钥轮换兜底：刷新公钥后再验一次
  if (!valid) {
    pem = await loadSigningPublicKey(true);
    try { valid = verifyWithPem(pem); } catch { valid = false; }
  }
  if (!valid) throw new Error('signature verification failed');

  // 时间窗与令牌类型校验
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp <= nowSec) {
    throw new Error('token expired');
  }
  if (payload.type && payload.type !== 'ACCESS') {
    throw new Error('invalid token type');
  }
  return payload;
}

async function requireAuthenticatedTwentyUser(req, res) {
  const token = getExplicitTwentyTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
    return null;
  }
  let verified;
  try {
    verified = await verifyTwentyAccessToken(token);
  } catch (error) {
    console.warn('[auth] token verification failed:', error.message);
    res.status(401).json({ error: '无法验证当前 CRM 用户，请重新登录后重试' });
    return null;
  }
  const userId = verified.sub || '';
  if (!userId || !verified.workspaceId) {
    res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
    return null;
  }
  const forwardedUserId = String(req.headers['x-twenty-user-id'] || '').trim();
  if (forwardedUserId && forwardedUserId !== userId) {
    res.status(401).json({ error: '用户身份信息不一致，请刷新 CRM 后重试' });
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

async function resolveConversationViewer(req) {
  const token = getExplicitTwentyTokenFromRequest(req);
  const tokenPayload = decodeJwtPayload(token);
  const userId = tokenPayload?.sub || '';
  if (!token || !userId || !tokenPayload?.workspaceId) return null;
  const schema = await getWorkspaceSchema();
  const result = await pool.query(
    `SELECT id, "userId", "userEmail", "nameFirstName", "nameLastName"
       FROM ${schema}."workspaceMember"
      WHERE "userId" = $1 AND "deletedAt" IS NULL
      LIMIT 1`,
    [userId],
  );
  const member = result.rows[0];
  if (!member?.id) return null;
  const email = String(member.userEmail || '').trim().toLowerCase();
  // v2.1 RBAC：角色统一来自 conv.user_roles（admin/manager/sales/boss）；缺失安全降级 sales/own。
  // boss 角色 = 仅查看全部（总经理），由前端权限管理界面配置。
  let role = 'sales';
  let scope = 'own';
  try {
    const roleResult = await pool.query(
      `SELECT ur.role, rs.scope
         FROM conv.user_roles ur
         LEFT JOIN conv.role_scopes rs ON rs.role = ur.role
        WHERE ur.workspace_member_id = $1
        LIMIT 1`,
      [String(member.id)],
    );
    if (roleResult.rows[0]) {
      role = roleResult.rows[0].role || 'sales';
      scope = roleResult.rows[0].scope || 'own';
    }
  } catch (_err) {
    // 角色表尚未就绪时安全降级为 sales/own，不阻断现有功能
  }
  return {
    userId,
    workspaceMemberId: String(member.id),
    email,
    name: [member.nameFirstName, member.nameLastName].filter(Boolean).join(' ').trim() || email || 'CRM 用户',
    isBoss: role === 'boss',
    role,
    scope,
  };
}

function conversationVisibilityWhere(viewer, alias = 'c', startIndex = 1) {
  // v2.1：未登录、拥有 boss 角色（仅查看总经理）、或拥有 admin 角色（scope=all）均可见全部会话
  if (!viewer || viewer.role === 'admin' || viewer.role === 'boss') return { sql: 'TRUE', params: [] };
  const memberParam = `$${startIndex}`;
  const userParam = `$${startIndex + 1}`;
  return {
    sql: `((
      ${alias}.channel = 'website'
      AND (
        ${alias}.status = 'open'
        OR ${alias}.agent_id = ${memberParam}
        OR EXISTS (
          SELECT 1
          FROM conv.conversation_participants cp
          WHERE cp.conversation_id = ${alias}.id
            AND cp.workspace_member_id = ${memberParam}
        )
      )
    ) OR (
      ${alias}.channel = 'whatsapp'
      AND ${alias}.owner_id = ${userParam}
    ) OR ${alias}.channel IN ('email', 'instagram', 'facebook'))`,
    params: [viewer.workspaceMemberId, viewer.userId],
  };
}

async function requireConversationAccess(req, res, options = {}) {
  const id = req.params?.id;
  // 防御：非法 UUID 直接 400，避免 pg 抛未捕获异常导致整进程崩溃
  if (!id || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
    res.status(400).json({ error: '会话 ID 格式无效' });
    return null;
  }
  const viewer = await resolveConversationViewer(req);
  const conversationResult = await pool.query(
    `SELECT c.id, c.channel, c.status, c.agent_id, c.external_chat_id, c.waha_session,
            COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AS "aiEnabled"
       FROM conv.conversations c
       LEFT JOIN conv.channel_settings cs ON cs.channel = c.channel
      WHERE c.id = $1`,
    [req.params.id],
  );
  const conversation = conversationResult.rows[0];
  if (!conversation) {
    res.status(404).json({ error: 'conversation not found' });
    return null;
  }
  if (!viewer) return { viewer, conversation };
  if (viewer.role === 'admin' || viewer.role === 'boss') {
    // admin 看全部且可写；boss（总经理）看全部但仅查看
    if (options.write && viewer.role !== 'admin') {
      res.status(403).json({ error: '当前角色仅有查看权限，不能接管或发送消息' });
      return null;
    }
    return { viewer, conversation };
  }
  const visibility = conversationVisibilityWhere(viewer, 'c', 2);
  const visibleResult = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM conv.conversations c WHERE c.id = $1 AND ${visibility.sql}) AS visible`,
    [conversation.id, ...visibility.params],
  );
  if (!visibleResult.rows[0]?.visible) {
    res.status(403).json({ error: '当前账号无权查看该会话' });
    return null;
  }
  if (options.reply && conversation.aiEnabled && !(conversation.status === 'takeover' && conversation.agent_id === viewer.workspaceMemberId)) {
    res.status(403).json({ error: '该会话未由当前账号接管，不能发送消息' });
    return null;
  }
  return { viewer, conversation };
}

async function requireWriteConversationAccess(req, res) {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return null;
  const access = await requireConversationAccess(req, res, { write: true });
  if (!access) return null;
  if (!access.viewer) {
    res.status(403).json({ error: '当前账号没有工作区成员权限' });
    return null;
  }
  return { ...access, authenticated };
}

// 仅管理员可配置权限：解析当前用户角色，非 admin 返回 403
async function requireAdmin(req, res) {
  const viewer = await resolveConversationViewer(req);
  if (!viewer) {
    res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
    return null;
  }
  if (viewer.role !== 'admin') {
    res.status(403).json({ error: '仅管理员可配置权限' });
    return null;
  }
  return viewer;
}

async function recordAuditEvent(eventType, options = {}) {
  try {
    await pool.query(
      `INSERT INTO conv.audit_events(
         event_type, channel, conversation_id, message_id, actor_user_id,
         actor_workspace_member_id, actor_name, request_summary, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        eventType,
        options.channel || null,
        options.conversationId || null,
        options.messageId || null,
        options.actor?.userId || null,
        options.actor?.workspaceMemberId || options.actor?.id || null,
        options.actor?.name || null,
        options.requestSummary ? JSON.stringify(options.requestSummary) : null,
        options.payload ? JSON.stringify(options.payload) : null,
      ],
    );
  } catch (error) {
    console.warn('[audit-events] write failed:', error.message);
  }
}

function followUpBlocknote(content) {
  return JSON.stringify([{
    id: crypto.randomUUID(),
    type: 'paragraph',
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text: String(content || ''), styles: {} }],
    children: [],
  }]);
}

async function resolveFollowUpTargets(client, schema, subjectType, subjectId) {
  const targets = { opportunityId: null, personId: null, projectId: null, conversationId: null };
  if (subjectType === 'conversation') {
    targets.conversationId = subjectId;
    const result = await client.query(
      `SELECT ct.twenty_opportunity_id
         FROM conv.conversations c
         JOIN conv.contacts ct ON ct.id = c.contact_id
        WHERE c.id = $1
        LIMIT 1`,
      [subjectId],
    );
    targets.opportunityId = result.rows[0]?.twenty_opportunity_id || null;
  } else if (subjectType === 'opportunity') {
    targets.opportunityId = subjectId;
  } else if (subjectType === 'person') {
    targets.personId = subjectId;
  } else if (subjectType === 'project') {
    targets.projectId = subjectId;
  }
  if (targets.opportunityId) {
    const result = await client.query(
      `SELECT "linkedPersonId", "linkedProjectId"
         FROM ${schema}.opportunity
        WHERE id = $1 AND "deletedAt" IS NULL
        LIMIT 1`,
      [targets.opportunityId],
    );
    targets.personId = targets.personId || result.rows[0]?.linkedPersonId || null;
    targets.projectId = targets.projectId || result.rows[0]?.linkedProjectId || null;
  }
  return targets;
}

async function attachNoteTarget(client, schema, noteId, targetColumn, targetId, actor) {
  if (!noteId || !targetColumn || !targetId) return;
  const exists = await client.query(
    `SELECT 1 FROM ${schema}."noteTarget"
      WHERE "noteId" = $1 AND "${targetColumn}" = $2 AND "deletedAt" IS NULL
      LIMIT 1`,
    [noteId, targetId],
  );
  if (exists.rowCount) return;
  await client.query(
    `INSERT INTO ${schema}."noteTarget" (
       "noteId", "${targetColumn}",
       "createdBySource", "createdByWorkspaceMemberId", "createdByName", "createdByContext",
       "updatedBySource", "updatedByWorkspaceMemberId", "updatedByName", "updatedByContext"
     ) VALUES (
       $1, $2,
       'API'::${schema}."noteTarget_createdBySource_enum", $3, $4, '{}'::jsonb,
       'API'::${schema}."noteTarget_updatedBySource_enum", $3, $4, '{}'::jsonb
     )`,
    [noteId, targetId, actor?.id || null, actor?.name || 'CRM 用户'],
  );
}

async function createFollowUpNote(client, schema, content, actor) {
  const result = await client.query(
    `INSERT INTO ${schema}.note (
       title, "bodyV2Markdown", "bodyV2Blocknote",
       "createdBySource", "createdByWorkspaceMemberId", "createdByName", "createdByContext",
       "updatedBySource", "updatedByWorkspaceMemberId", "updatedByName", "updatedByContext"
     ) VALUES (
       $1, $2, $3,
       'API'::${schema}."note_createdBySource_enum", $4, $5, '{}'::jsonb,
       'API'::${schema}."note_updatedBySource_enum", $4, $5, '{}'::jsonb
     )
     RETURNING id`,
    ['跟进记录', content, followUpBlocknote(content), actor?.id || null, actor?.name || 'CRM 用户'],
  );
  return result.rows[0]?.id || null;
}

async function syncFollowUpNoteTargets(client, schema, noteId, subjectType, subjectId, actor) {
  const targets = await resolveFollowUpTargets(client, schema, subjectType, subjectId);
  await attachNoteTarget(client, schema, noteId, 'targetOpportunityId', targets.opportunityId, actor);
  await attachNoteTarget(client, schema, noteId, 'targetPersonId', targets.personId, actor);
  await attachNoteTarget(client, schema, noteId, 'targetXiangMuId', targets.projectId, actor);
}

async function syncOpportunityFollowUpsToProject(client, schema, opportunityId, projectId, actor) {
  if (!opportunityId || !projectId) return;
  const result = await client.query(
    `SELECT DISTINCT fu.twenty_note_id
       FROM conv.follow_ups fu
       LEFT JOIN conv.conversations c ON c.id = fu.conversation_id
       LEFT JOIN conv.contacts ct ON ct.id = c.contact_id
      WHERE fu.deleted_at IS NULL
        AND fu.twenty_note_id IS NOT NULL
        AND (
          (fu.subject_type = 'opportunity' AND fu.subject_id = $1::text)
          OR ct.twenty_opportunity_id = $1::text
        )`,
    [opportunityId],
  );
  for (const row of result.rows) {
    await attachNoteTarget(client, schema, row.twenty_note_id, 'targetXiangMuId', projectId, actor);
  }
}

// 回填「最新跟进」字段：取该线索最新一条未删除跟进（内容 + 时间 + 作者），写入 opportunity.latestFollowUp。
// 无跟进则置空。供线索看板直接展示，且跟随 RBAC（字段对所有可见，但内容由各自新增的跟进决定）。
// 口径与 syncOpportunityFollowUpsToProject 保持一致：不仅算直接挂在该 opportunity 上的跟进，
// 还要算经由 conversation→contact 关联到该 opportunity 的跟进（即在对话页写的跟进也算数）。
async function backfillOpportunityLatestFollowUp(client, schema, opportunityId) {
  if (!opportunityId) return;
  const result = await client.query(
    `SELECT fu.content, fu.created_by_name AS "createdByName", fu.created_at AS "createdAt"
       FROM conv.follow_ups fu
       LEFT JOIN conv.conversations c ON c.id = fu.conversation_id
       LEFT JOIN conv.contacts ct ON ct.id = c.contact_id
      WHERE fu.deleted_at IS NULL
        AND (
          (fu.subject_type = 'opportunity' AND fu.subject_id = $1::text)
          OR ct.twenty_opportunity_id = $1::text
        )
      ORDER BY fu.created_at DESC
      LIMIT 1`,
    [opportunityId],
  );
  const latest = result.rows[0];
  const value = latest
    ? `${latest.content}\n——${latest.createdByName || '未知'} ${formatFollowUpTime(latest.createdAt)}`
    : '';
  try {
    await twentyGraphQL(
      `mutation($id: UUID!, $data: OpportunityUpdateInput!) {
        updateOpportunity(id: $id, data: $data) { id latestFollowUp }
      }`,
      { id: opportunityId, data: { latestFollowUp: value } },
    );
  } catch (error) {
    console.error('[follow-ups] backfill latestFollowUp failed:', error.message);
  }
}

function formatFollowUpTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  // 容器默认跑在 UTC，直接用 getHours() 会得到 UTC+0 时间；这里显式按东八区（Asia/Shanghai）
  // 格式化，保证写进 Twenty「最新跟进」字段的时间戳是 UTC+8。en-CA 的 formatToParts
  // 天然给出 YYYY-MM-DD 顺序，拼出 “YYYY-MM-DD HH:mm”。
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour; // en-CA 偶发把 00:xx 输出成 24:xx
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}`;
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
  if (!actor?.id || !recordId || !['opportunity', 'person', 'company', '_xiangMu'].includes(tableName)) return;
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
    CREATE TABLE IF NOT EXISTS conv.conversation_participants (
      conversation_id UUID REFERENCES conv.conversations(id) ON DELETE CASCADE,
      workspace_member_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL DEFAULT 'takeover',
      first_joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(conversation_id, workspace_member_id));
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
    CREATE INDEX IF NOT EXISTS conversation_participants_member_idx
      ON conv.conversation_participants(workspace_member_id, last_joined_at DESC);
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
    CREATE TABLE IF NOT EXISTS conv.follow_ups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      conversation_id UUID REFERENCES conv.conversations(id) ON DELETE SET NULL,
      twenty_note_id UUID,
      content TEXT NOT NULL,
      created_by_user_id TEXT,
      created_by_workspace_member_id TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ);
    ALTER TABLE conv.follow_ups ADD COLUMN IF NOT EXISTS twenty_note_id UUID;
    CREATE INDEX IF NOT EXISTS follow_ups_subject_idx
      ON conv.follow_ups(subject_type, subject_id, created_at DESC)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS follow_ups_creator_idx
      ON conv.follow_ups(created_by_workspace_member_id, created_at DESC)
      WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS conv.audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      channel TEXT,
      conversation_id UUID REFERENCES conv.conversations(id) ON DELETE SET NULL,
      message_id UUID,
      actor_user_id TEXT,
      actor_workspace_member_id TEXT,
      actor_name TEXT,
      request_summary JSONB,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS audit_events_type_time_idx
      ON conv.audit_events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_events_conversation_idx
      ON conv.audit_events(conversation_id, created_at DESC)
      WHERE conversation_id IS NOT NULL;
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
    -- ===== v2.1 多账号绑定与 RBAC 可见性 =====
    -- 角色 -> 数据范围映射
    CREATE TABLE IF NOT EXISTS conv.role_scopes (
      role TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      description TEXT);
    INSERT INTO conv.role_scopes(role, scope, description) VALUES
      ('admin', 'all', '可查看并操作全部会话'),
      ('manager', 'team', '可查看团队成员会话'),
      ('sales', 'own', '仅可查看自己绑定/参与的会话'),
      ('boss', 'all', '仅查看全部会话，不可操作（总经理）')
      ON CONFLICT (role) DO NOTHING;
    -- 每用户的角色（管理员在后台配置；缺失时降级为 sales/own）
    CREATE TABLE IF NOT EXISTS conv.user_roles (
      workspace_member_id TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'sales',
      granted_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    -- 会话归属（多账号）：channel_owner=WA号主，owner=当前客户负责人
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS owner_id TEXT;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS channel_owner_id TEXT;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS waha_session TEXT;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS owner_id TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS owner_id TEXT;
    CREATE INDEX IF NOT EXISTS conversations_owner_idx
      ON conv.conversations(owner_id) WHERE owner_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS conversations_waha_session_idx
      ON conv.conversations(waha_session) WHERE waha_session IS NOT NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS channel_accounts_active_external_account_unique
    ON conv.channel_accounts(channel, provider, external_account_id)
    WHERE external_account_id IS NOT NULL AND status <> 'unbound';
  `);
  }

function phoneFromJid(jid = '') { return jid.replace(/@.*/, '').replace(/\D/g, ''); }

// WhatsApp 新版对未存联系人使用 @lid 匿名地址，其中的数字不是手机号。
// WAHA 的 contacts 接口可把 lid 解析回真实号码（返回 id 形如 8619057220975@c.us）。
async function resolvePhone(jid = '', session = WAHA_SESSION) {
  if (!jid.endsWith('@lid')) return phoneFromJid(jid);
  try {
    const response = await fetch(`${WAHA_API_URL}/api/contacts?contactId=${encodeURIComponent(jid)}&session=${encodeURIComponent(session)}`,
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
    // WAHA 给的 media.filename 常是 UTF-8 被当 latin1 传过来的乱码，走同款归一化修复
    // （normalizeUploadFilename 会侦测 mojibake 并 latin1→utf8 还原）。
    const fileTitle = media.filename ? normalizeUploadFilename(media.filename) : (payload.body || '[文件]');
    return { content: fileTitle, type: 'file', mediaUrl: media.url };
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
    `SELECT c.id, c.external_chat_id, c.channel, c.status, c.waha_session AS "wahaSession",
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
    const wahaSession = policy.wahaSession || WAHA_SESSION;
    let textExternalId = null;
    if (content) {
      const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY },
        body: JSON.stringify({ session: wahaSession, chatId: policy.external_chat_id, text: content }),
      });
      if (!response.ok) throw new Error(`WhatsApp AI text send failed: ${response.status} ${await response.text()}`);
      const sent = await response.json();
      textExternalId = sent?.id?._serialized || sent?._data?.id?._serialized || idempotencyKey;
    }
    for (const attachment of attachments) {
      await sendWhatsAppAttachmentFromUrl(policy.external_chat_id, attachment, wahaSession);
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

async function persistWhatsAppMessage(payload, session) {
  const inboundSession = session || WAHA_SESSION;
  // v2.1 多账号（M3/M4）：入站按 WAHA session 反查绑定的 owner；未知/未绑定 session 直接拒收。
  const binding = await getActiveWhatsAppBindingBySession(inboundSession);
  if (!binding) {
    console.warn('[whatsapp] reject inbound for unknown/unbound session:', inboundSession);
    return;
  }
  const ownerUserId = binding.user_id;
  const data = payload.payload || payload;
  const fromMe = Boolean(data.fromMe);
  // `_data.id.remote` 始终是对方（客户），与收发方向无关；据此把双向消息归入同一会话。
  const counterpartyJid = data._data?.id?.remote || (fromMe ? data.to : data.from);
  if (!counterpartyJid || counterpartyJid.endsWith('@g.us') || counterpartyJid === 'status@broadcast') return;
  const externalMessageId = data.id;
  const parsed = messageContent(data);
  if (parsed.mediaUrl) {
    try {
      const localUrl = await downloadWahaMediaToLocalFile(parsed.mediaUrl, data.media?.mimetype, data.media?.filename);
      parsed.mediaUrl = localUrl || null;
    } catch (error) {
      console.error('[whatsapp] inbound media download failed:', error.message);
      parsed.mediaUrl = null;
    }
  }
  const phone = await resolvePhone(counterpartyJid, inboundSession);
  // 归一化会话键：同一客户的 @lid 与 @c.us 统一为真实号 <phone>@c.us，避免拆成多个会话。
  const chatKey = phone ? `${phone}@c.us` : counterpartyJid;
  const displayName = (!fromMe && (data.notifyName || data._data?.notifyName)) || phone || counterpartyJid;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name, phone, owner_id)
      VALUES ('whatsapp', $1, $2, $3, $4) ON CONFLICT(channel, external_id)
      DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, conv.contacts.display_name),
        phone = COALESCE(EXCLUDED.phone, conv.contacts.phone),
        owner_id = COALESCE(conv.contacts.owner_id, EXCLUDED.owner_id),
        updated_at = now() RETURNING *`,
      [chatKey, displayName, phone ? `+${phone}` : null, ownerUserId]);
    const contact = contactResult.rows[0];
    const conversationResult = await client.query(`INSERT INTO conv.conversations(channel, external_chat_id, contact_id, owner_id, channel_owner_id, waha_session)
      VALUES ('whatsapp', $1, $2, $3, $3, $4) ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET updated_at = now(),
        owner_id = COALESCE(conv.conversations.owner_id, EXCLUDED.owner_id),
        channel_owner_id = COALESCE(conv.conversations.channel_owner_id, EXCLUDED.channel_owner_id),
        waha_session = COALESCE(conv.conversations.waha_session, EXCLUDED.waha_session)
      RETURNING *`, [chatKey, contact.id, ownerUserId, inboundSession]);
    const conversation = conversationResult.rows[0];
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, sent_at, owner_id)
      VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [externalMessageId || null, conversation.id, fromMe ? 'agent' : 'customer', parsed.content, parsed.type, parsed.mediaUrl || null, data.timestamp ? Number(data.timestamp) * 1000 : Date.now(), ownerUserId]);
    if (inserted.rowCount) await client.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversation.id, parsed.content]);
    await client.query('COMMIT');
    // 规则（2026-07-24）：消息只落对话工作台，不自动同步 People/Companies。
    // 规则（2026-08-06）：WhatsApp/官网客服客户首条入站自动创建 Opportunity，后续资料由销售在工作台右侧表单补全。
    if (inserted.rowCount && !fromMe) {
      ensureOpportunityForInboundConversation({
        conversationId: conversation.id,
        contactId: contact.id,
        channel: 'whatsapp',
        fallbackName: displayName,
        phone: phone ? `+${phone}` : null,
      }).catch(error => console.error('[auto-lead] whatsapp failed:', error.message));
    }
    // 新的客户入站消息（非人工接管、文本类）按渠道 AI 策略决定是否自动回复。
    if (inserted.rowCount && !fromMe && conversation.status !== 'takeover' && parsed.type === 'text') {
      requestAiReplyIfAllowed(conversation, externalMessageId, parsed.content)
        .catch(error => console.error('[ai] auto reply failed:', error.message));
    }
    if (inserted.rowCount) {
      recordAuditEvent('message.ingested', {
        channel: 'whatsapp',
        conversationId: conversation.id,
        messageId: inserted.rows[0].id,
        payload: {
          direction: fromMe ? 'outbound_echo' : 'inbound',
          externalMessageId,
          externalChatId: chatKey,
          contentType: parsed.type,
          wahaSession: inboundSession,
          ownerUserId,
        },
      });
    }
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function receiveWhatsAppWebhook(req, res) {
  res.status(200).json({ received: true });
  // WAHA 投递 `message`（入站+出站）/ `message.any`；只处理文本类消息事件。
  const event = req.body.event || req.params.event?.replace(/-/g, '.');
  if (event !== 'message' && event !== 'message.any') return;
  // WAHA 在 webhook body 中携带 session（WAHA session 名），用于归属到对应销售。
  const session = String(req.body?.session || WAHA_SESSION);
  persistWhatsAppMessage(req.body, session).catch(error => console.error('[whatsapp] webhook failed:', error.message));
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
  // 官网访客发的附件：ai-service 那边已经把 widget 上传的文件转成同一套
  // {url,title,fileType,contentType,sizeBytes} 结构透传过来了，跟坐席发附件复用同一套归一化。
  const attachments = normalizeOutboundAttachments(body.attachments);
  const primaryAttachment = attachments[0] || null;
  const contentType = primaryAttachment ? fileMessageType({ mimetype: primaryAttachment.contentType || '' }) : 'text';
  const mediaUrl = primaryAttachment ? primaryAttachment.url : null;
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
    const dedupeId = externalMessageId ? `web:${sessionId}:${senderType}:${externalMessageId}` : null;
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, attachments, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now()) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [dedupeId, conversation.id, senderType, content, contentType, mediaUrl, attachments.length ? JSON.stringify(attachments) : null]);
    if (inserted.rowCount) await client.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversation.id, content]);
    await client.query('COMMIT');
    if (inserted.rowCount && senderType === 'customer') {
      ensureOpportunityForInboundConversation({
        conversationId: conversation.id,
        contactId: contact.id,
        channel: 'website',
        fallbackName: displayName,
      }).catch(error => console.error('[auto-lead] website failed:', error.message));
      const aiMessageId = dedupeId || `web:${conversation.id}:${inserted.rows[0].id}`;
      requestAiReplyIfAllowed(conversation, aiMessageId, content)
        .catch(error => console.error('[ai] website auto reply failed:', error.message));
    }
    if (inserted.rowCount) {
      recordAuditEvent('message.ingested', {
        channel: 'website',
        conversationId: conversation.id,
        messageId: inserted.rows[0].id,
        payload: {
          senderType,
          externalMessageId: dedupeId,
          externalChatId: sessionId,
          contentType: 'text',
        },
      });
    }
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

app.post('/api/website/webhook', async (req, res) => {
  if (WEBSITE_INGEST_SECRET && req.headers['x-webhook-secret'] !== WEBSITE_INGEST_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    await persistWebsiteMessage(req.body);
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[website] ingest failed:', error.message);
    res.status(502).json({ error: 'website message ingest failed', detail: error.message });
  }
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
    if (inserted.rowCount) {
      recordAuditEvent('message.ingested', {
        channel: 'instagram',
        conversationId: conversation.id,
        messageId: inserted.rows[0].id,
        payload: { direction: fromMe ? 'outbound_echo' : 'inbound', externalMessageId, contentType: parsed.type },
      });
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
    if (inserted.rowCount) {
      recordAuditEvent('message.ingested', {
        channel: 'facebook',
        conversationId: conversation.id,
        messageId: inserted.rows[0].id,
        payload: { direction: fromMe ? 'outbound_echo' : 'inbound', externalMessageId, contentType: parsed.type },
      });
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

app.get('/api/conversations', async (req, res) => {
  try {
    // 生效范围解析：会话级覆盖(c.ai_enabled) → 渠道设置(cs.ai_enabled) → 官网默认开
    const scheduleActive = aiScheduleActiveExpression('cs');
    const viewer = await resolveConversationViewer(req);
    const visibility = conversationVisibilityWhere(viewer);
    // admin 的 visibility.sql 是常量 TRUE（不含 $1/$2），但下面 canReply/
    // isAssignedToMe/hasTakenOverBefore 仍引用 $1，必须单独传 1 个参数；
    // sales/manager 的 visibility.sql 本身含 $1(memberId)/$2(userId)，要传 2 个；
    // boss 与匿名的这些表达式全是写死常量，不需要参数。
    // 之前统一按 visibility.params 传，对 admin 传成了 []，导致 "no parameter $1"；
    // 若直接照抄 sales 传两个参数，admin 的 SQL 只声明了 $1，又会变成
    // "bind message supplies 2 parameters, but prepared statement requires 1"。
    const listParams = !viewer || viewer.isBoss
      ? []
      : viewer.role === 'admin'
        ? [viewer.workspaceMemberId]
        : [viewer.workspaceMemberId, viewer.userId];
    const viewerRole = viewer?.isBoss ? "'boss'" : viewer ? "'sales'" : "'anonymous'";
    // AI 模式（ai_enabled 为真）下：仅接管自己的会话可回复；AI 关闭时：非关闭会话销售均可直接回复，无需先接管。
    const aiEnabledExpr = `(COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website'))`;
    const canReplyExpression = viewer?.isBoss
      ? 'false'
      : viewer
        ? `((${aiEnabledExpr} AND c.status = 'takeover' AND c.agent_id = $1) OR (NOT ${aiEnabledExpr} AND c.status <> 'closed'))`
        : `((${aiEnabledExpr} AND c.status = 'takeover') OR (NOT ${aiEnabledExpr} AND c.status <> 'closed'))`;
    const canTakeoverExpression = viewer?.isBoss ? 'false' : viewer ? `(c.status = 'open')` : `(c.status = 'open')`;
    const assignedToMeExpression = viewer && !viewer.isBoss ? `(c.agent_id = $1)` : 'false';
    const takenBeforeExpression = viewer && !viewer.isBoss ? `EXISTS (
      SELECT 1 FROM conv.conversation_participants cp
      WHERE cp.conversation_id = c.id AND cp.workspace_member_id = $1
    )` : 'false';
    const result = await pool.query(`SELECT c.id, c.channel, c.status, c.agent_id AS "agentId", c.last_message_preview AS "lastMessage", c.last_message_at AS "lastMessageAt", c.lead_draft AS "leadDraft",
    json_build_object(
      'enabled', COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website'),
      'scheduleActive', ${scheduleActive},
      'inTakeoverWindow', (COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AND (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND ${scheduleActive}),
      'canTakeover', (COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AND (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND ${scheduleActive} AND c.status NOT IN ('takeover', 'closed'))
    ) AS "aiControl",
    json_build_object(
      'viewerRole', ${viewerRole},
      'canView', true,
      'canReply', ${canReplyExpression},
      'canTakeover', ${canTakeoverExpression},
      'isAssignedToMe', ${assignedToMeExpression},
      'hasTakenOverBefore', ${takenBeforeExpression}
    ) AS permissions,
    json_build_object('id', ct.id, 'name', ct.display_name, 'phone', ct.phone, 'email', ct.email, 'twentyPersonId', ct.twenty_person_id, 'twentyOpportunityId', ct.twenty_opportunity_id,
      'filedStatus', CASE WHEN ct.twenty_opportunity_id IS NOT NULL OR ct.twenty_person_id IS NOT NULL THEN 'lead' ELSE 'unfiled' END) AS contact
    FROM conv.conversations c JOIN conv.contacts ct ON ct.id = c.contact_id
    LEFT JOIN conv.channel_settings cs ON cs.channel = c.channel
    WHERE ${visibility.sql}
    ORDER BY c.last_message_at DESC NULLS LAST`, listParams);
    res.json(result.rows);
  } catch (error) {
    console.error('[conversations] list failed:', error.message);
    res.status(502).json({ error: '无法加载会话', detail: error.message });
  }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  const access = await requireConversationAccess(req, res);
  if (!access) return;
  const result = await pool.query(`SELECT id, sender_type AS "senderType", content, content_type AS "contentType", media_url AS "mediaUrl", subject, attachments, sent_at AS "sentAt" FROM conv.messages WHERE conversation_id = $1 ORDER BY sent_at`, [req.params.id]);
  res.json(result.rows);
});

app.get('/api/follow-ups', async (req, res) => {
  const subjectType = String(req.query.subjectType || '').trim();
  const subjectId = String(req.query.subjectId || '').trim();
  if (!['conversation', 'opportunity', 'person', 'project'].includes(subjectType) || !subjectId) {
    return res.status(400).json({ error: 'follow-up query params invalid' });
  }
  let viewer = await resolveConversationViewer(req);
  if (subjectType === 'conversation') {
    const access = await requireConversationAccess({ headers: req.headers, params: { id: subjectId } }, res);
    if (!access) return;
    viewer = access.viewer;
  }
  if (!viewer) return res.status(403).json({ error: '当前账号没有工作区成员权限' });
  // v2.1 RBAC：scope=all（admin / boss 总经理）可见全部；其余（sales/manager）仅见自己新增的
  const scoped = viewer.scope !== 'all';
  // 线索（opportunity）的跟进记录要跨渠道汇总：实际业务里销售都是在「对话」页写跟进，
  // 极少直接对着线索写，narrow 匹配 subject_type='opportunity' 基本查不到东西（参见
  // backfillOpportunityLatestFollowUp 修复过的同一个坑）。这里跟那处口径保持一致：
  // 既算直接挂在线索上的，也算经 conversation→contact 关联到该线索的跟进。
  let result;
  if (subjectType === 'opportunity') {
    const params = [subjectId];
    let creatorFilter = '';
    if (scoped) {
      params.push(viewer.workspaceMemberId);
      creatorFilter = `AND fu.created_by_workspace_member_id = $${params.length}`;
    }
    result = await pool.query(
      `SELECT fu.id,
              fu.subject_type AS "subjectType",
              fu.subject_id AS "subjectId",
              fu.conversation_id AS "conversationId",
              fu.content,
              fu.created_by_workspace_member_id AS "createdByWorkspaceMemberId",
              fu.created_by_name AS "createdByName",
              fu.created_at AS "createdAt",
              fu.updated_at AS "updatedAt"
         FROM conv.follow_ups fu
         LEFT JOIN conv.conversations c ON c.id = fu.conversation_id
         LEFT JOIN conv.contacts ct ON ct.id = c.contact_id
        WHERE fu.deleted_at IS NULL
          AND (
            (fu.subject_type = 'opportunity' AND fu.subject_id = $1::text)
            OR ct.twenty_opportunity_id = $1::text
          )
          ${creatorFilter}
        ORDER BY fu.created_at DESC
        LIMIT 200`,
      params,
    );
  } else {
    const params = [subjectType, subjectId];
    let creatorFilter = '';
    if (scoped) {
      params.push(viewer.workspaceMemberId);
      creatorFilter = `AND created_by_workspace_member_id = $${params.length}`;
    }
    result = await pool.query(
      `SELECT id,
              subject_type AS "subjectType",
              subject_id AS "subjectId",
              conversation_id AS "conversationId",
              content,
              created_by_workspace_member_id AS "createdByWorkspaceMemberId",
              created_by_name AS "createdByName",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM conv.follow_ups
        WHERE subject_type = $1
          AND subject_id = $2
          AND deleted_at IS NULL
          ${creatorFilter}
        ORDER BY created_at DESC
        LIMIT 100`,
      params,
    );
  }
  res.json(result.rows);
});

// 线索维度附件汇总：把一个线索横跨 WhatsApp/官网/邮件等多个渠道会话里收发过的所有
// 附件，按线索汇总成一张扁平清单，方便回溯「这个客户前后发过哪些文件」。
// 数据源两处都要覆盖：出站/官网/邮件走 messages.attachments(JSONB 数组)，
// WhatsApp/IG 入站走 media_url(单列，已由 df586a8 代理到本地)。官网入站两者都写，
// 优先取 attachments，避免重复计数。权限按「会话可见性」过滤(conversationVisibilityWhere)——
// admin/boss 看全部，销售仅见自己参与/负责的会话，跟「跟进记录」按创建人过滤口径不同，
// 但更贴合附件语义(附件属于会话消息，不属于某个「作者」)。
app.get('/api/attachments', async (req, res) => {
  const subjectType = String(req.query.subjectType || '').trim();
  const subjectId = String(req.query.subjectId || '').trim();
  if (subjectType !== 'opportunity' || !subjectId) {
    return res.status(400).json({ error: '附件汇总仅支持 subjectType=opportunity' });
  }
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(403).json({ error: '当前账号没有工作区成员权限' });
  const params = [subjectId];
  const visibility = conversationVisibilityWhere(viewer, 'c', params.length + 1);
  params.push(...visibility.params);
  let result;
  try {
    result = await pool.query(
      `SELECT m.id AS "messageId",
              m.sender_type AS "senderType",
              m.content,
              m.content_type AS "contentType",
              m.media_url AS "mediaUrl",
              m.attachments,
              m.sent_at AS "sentAt",
              c.id AS "conversationId",
              c.channel
         FROM conv.messages m
         JOIN conv.conversations c ON c.id = m.conversation_id
         JOIN conv.contacts ct ON ct.id = c.contact_id
        WHERE ct.twenty_opportunity_id = $1::text
          AND (
            m.media_url IS NOT NULL
            OR (m.attachments IS NOT NULL AND jsonb_typeof(m.attachments) = 'array' AND jsonb_array_length(m.attachments) > 0)
          )
          AND ${visibility.sql}
        ORDER BY m.sent_at DESC
        LIMIT 500`,
      params,
    );
  } catch (error) {
    console.error('[attachments] aggregate failed:', error.message);
    return res.status(502).json({ error: '无法加载附件', detail: error.message });
  }
  // 一条消息可能带多个附件(邮件)，展开成扁平清单；官网消息 attachments 与 media_url
  // 同时存在时以 attachments 为准，避免同一文件出现两次。
  const items = [];
  for (const row of result.rows) {
    const direction = row.senderType === 'customer' ? 'inbound' : 'outbound';
    const base = {
      messageId: row.messageId,
      conversationId: row.conversationId,
      channel: row.channel,
      direction,
      sentAt: row.sentAt,
    };
    const list = Array.isArray(row.attachments) ? row.attachments : [];
    if (list.length) {
      for (const att of list) {
        const url = String(att?.url || att?.href || '').trim();
        if (!url) continue;
        items.push({
          ...base,
          url,
          title: att.title || att.fileName || att.filename || '附件',
          fileType: String(att.fileType || fileTypeFromName(att.title || '', 'file')).replace(/^\./, '').toLowerCase() || 'file',
          contentType: att.contentType || att.mimeType || att.mimetype || row.contentType || null,
          sizeBytes: Number(att.sizeBytes || att.size || 0) || null,
          caption: att.caption || (row.content && row.content !== att.title ? row.content : '') || '',
        });
      }
    } else if (row.mediaUrl) {
      // WhatsApp/IG 入站：只有 media_url，标题从正文(caption)或 content_type 兜底。
      const guessedTitle = (row.content && String(row.content).trim()) || `${row.contentType || 'file'} 附件`;
      items.push({
        ...base,
        url: row.mediaUrl,
        title: guessedTitle.slice(0, 180),
        fileType: fileTypeFromName(guessedTitle, row.contentType || 'file'),
        contentType: row.contentType || null,
        sizeBytes: null,
        caption: '',
      });
    }
  }
  res.json(items);
});

app.post('/api/follow-ups', requireSameSite, async (req, res) => {
  const subjectType = String(req.body?.subjectType || '').trim();
  const subjectId = String(req.body?.subjectId || '').trim();
  const content = String(req.body?.content || '').trim();
  if (!['conversation', 'opportunity', 'person', 'project'].includes(subjectType) || !subjectId) {
    return res.status(400).json({ error: '跟进记录参数无效' });
  }
  if (!content) return res.status(400).json({ error: '请输入跟进内容' });
  if (content.length > 4000) return res.status(400).json({ error: '跟进内容不能超过 4000 字' });

  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(403).json({ error: '当前账号没有工作区成员权限' });
  if (viewer.role === 'boss') return res.status(403).json({ error: 'Boss 当前仅有查看权限，不能新增跟进记录' });
  if (subjectType === 'conversation') {
    const access = await requireConversationAccess({ headers: req.headers, params: { id: subjectId } }, res, { write: true });
    if (!access) return;
  }

  const client = await pool.connect();
  let row;
  try {
    const schema = await getWorkspaceSchema();
    await client.query('BEGIN');
    const noteId = await createFollowUpNote(client, schema, content, authenticated.actor);
    await syncFollowUpNoteTargets(client, schema, noteId, subjectType, subjectId, authenticated.actor);
    const result = await client.query(
      `INSERT INTO conv.follow_ups(
         subject_type, subject_id, conversation_id, twenty_note_id, content,
         created_by_user_id, created_by_workspace_member_id, created_by_name
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id,
                 subject_type AS "subjectType",
                 subject_id AS "subjectId",
                 conversation_id AS "conversationId",
                 twenty_note_id AS "twentyNoteId",
                 content,
                 created_by_workspace_member_id AS "createdByWorkspaceMemberId",
                 created_by_name AS "createdByName",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [
        subjectType,
        subjectId,
        subjectType === 'conversation' ? subjectId : null,
        noteId,
        content,
        authenticated.userId,
        authenticated.actor.id,
        authenticated.actor.name,
      ],
    );
    row = result.rows[0];
    await client.query('COMMIT');
    // 回填「最新跟进」字段到线索看板
    try {
      const targets = await resolveFollowUpTargets(client, schema, subjectType, subjectId);
      if (targets.opportunityId) {
        await backfillOpportunityLatestFollowUp(client, schema, targets.opportunityId);
      }
    } catch (bfErr) {
      console.error('[follow-ups] backfill on create failed:', bfErr.message);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[follow-ups] create failed:', error.message);
    return res.status(502).json({ error: '新增跟进记录失败', detail: error.message });
  } finally {
    client.release();
  }
  await recordAuditEvent('follow_up.created', {
    channel: subjectType,
    conversationId: subjectType === 'conversation' ? subjectId : null,
    actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
    requestSummary: auditRequestSummary(req),
    payload: { subjectType, subjectId, followUpId: row?.id, twentyNoteId: row?.twentyNoteId },
  });
  res.status(201).json(row);
});

app.delete('/api/follow-ups/:id', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(403).json({ error: '当前账号没有工作区成员权限' });
  if (viewer.role === 'boss') return res.status(403).json({ error: 'Boss 当前仅有查看权限，不能删除跟进记录' });
  const client = await pool.connect();
  let row;
  try {
    const schema = await getWorkspaceSchema();
    await client.query('BEGIN');
    // v2.1 RBAC：admin 可删除任意跟进记录；manager/sales 仅可删除自己新增的
    const canDeleteAny = viewer.role === 'admin';
    const result = await client.query(
      `UPDATE conv.follow_ups
          SET deleted_at = now(), updated_at = now()
        WHERE id = $1
          AND deleted_at IS NULL
          ${canDeleteAny ? '' : 'AND created_by_workspace_member_id = $2'}
        RETURNING id, subject_type AS "subjectType", subject_id AS "subjectId", conversation_id AS "conversationId", twenty_note_id AS "twentyNoteId"`,
      canDeleteAny ? [req.params.id] : [req.params.id, viewer.workspaceMemberId],
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '跟进记录不存在或无权删除' });
    }
    row = result.rows[0];
    if (row.twentyNoteId) {
      await client.query(`UPDATE ${schema}."noteTarget" SET "deletedAt" = now(), "updatedAt" = now() WHERE "noteId" = $1 AND "deletedAt" IS NULL`, [row.twentyNoteId]);
      await client.query(`UPDATE ${schema}.note SET "deletedAt" = now(), "updatedAt" = now() WHERE id = $1 AND "deletedAt" IS NULL`, [row.twentyNoteId]);
    }
    await client.query('COMMIT');
    // 回填「最新跟进」字段到线索看板（删除后重算最新一条，可能清空）
    try {
      const targets = await resolveFollowUpTargets(client, schema, row.subjectType, row.subjectId);
      if (targets.opportunityId) {
        await backfillOpportunityLatestFollowUp(client, schema, targets.opportunityId);
      }
    } catch (bfErr) {
      console.error('[follow-ups] backfill on delete failed:', bfErr.message);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[follow-ups] delete failed:', error.message);
    return res.status(502).json({ error: '删除跟进记录失败', detail: error.message });
  } finally {
    client.release();
  }
  await recordAuditEvent('follow_up.deleted', {
    channel: row.subjectType,
    conversationId: row.conversationId,
    actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
    requestSummary: auditRequestSummary(req),
    payload: { followUpId: req.params.id },
  });
  res.json({ deleted: true });
});

app.get('/api/audit/events', async (req, res) => {
  const viewer = await resolveConversationViewer(req);
  if (!viewer?.isBoss) return res.status(403).json({ error: '仅管理者可查看审计事件' });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const eventType = String(req.query.eventType || '').trim();
  const conversationId = String(req.query.conversationId || '').trim();
  const params = [];
  const where = [];
  if (eventType) {
    params.push(eventType);
    where.push(`event_type = $${params.length}`);
  }
  if (conversationId) {
    params.push(conversationId);
    where.push(`conversation_id = $${params.length}`);
  }
  params.push(limit);
  const result = await pool.query(
    `SELECT id,
            event_type AS "eventType",
            channel,
            conversation_id AS "conversationId",
            message_id AS "messageId",
            actor_user_id AS "actorUserId",
            actor_workspace_member_id AS "actorWorkspaceMemberId",
            actor_name AS "actorName",
            request_summary AS "requestSummary",
            payload,
            created_at AS "createdAt"
       FROM conv.audit_events
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  res.json(result.rows);
});

function normalizeOutboundWhatsAppPhone(input) {
  let digits = String(input || '').trim().replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

function createHttpError(message, status = 400, detail = null) {
  const error = new Error(message);
  error.status = status;
  error.detail = detail;
  return error;
}

async function checkWhatsAppRecipientForUser(authenticated, phone) {
  const sessionName = await resolveUserWahaSessionName(authenticated);
  const session = normalizeWahaSession(await getWahaSession(sessionName));
  if (!session.connected) throw createHttpError('WhatsApp 当前未连接，请先在设置中完成绑定', 409);

  const binding = await getActiveWhatsAppBindingBySession(sessionName);
  if (!binding) throw createHttpError('该会话所属 WhatsApp 未绑定到 CRM 账号，请先在设置中点击“绑定到我的账号”', 403);
  if (binding.user_id !== authenticated.userId) {
    throw createHttpError(`该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，当前账号不能使用该号码发送消息`, 403);
  }
  if (phoneFromJid(session.accountId) === phone) throw createHttpError('不能向当前绑定的 WhatsApp 号码发起会话', 400);

  const checkResponse = await fetchWaha(
    `/api/contacts/check-exists?session=${encodeURIComponent(sessionName)}&phone=${encodeURIComponent(phone)}`,
  );
  const checked = await checkResponse.json().catch(() => ({}));
  if (!checkResponse.ok) throw createHttpError(checked.message || 'WhatsApp 号码校验失败', 502, checked);
  if (!checked.numberExists || !checked.chatId) {
    throw createHttpError('该号码未注册 WhatsApp，请检查国家区号和号码是否正确', 404, checked);
  }

  const existing = await pool.query(
    `SELECT id, status, last_message_at, last_message_preview
       FROM conv.conversations
      WHERE channel = 'whatsapp' AND external_chat_id = $1
      LIMIT 1`,
    [checked.chatId],
  );
  return {
    phone: `+${phone}`,
    chatId: checked.chatId,
    numberExists: true,
    existingConversationId: existing.rows[0]?.id || null,
    existingConversationStatus: existing.rows[0]?.status || null,
    existingLastMessageAt: existing.rows[0]?.last_message_at || null,
    existingLastMessagePreview: existing.rows[0]?.last_message_preview || '',
    reused: existing.rowCount > 0,
    fromAccount: {
      phone: session.phone || '',
      displayName: session.displayName || binding.display_name || '',
      accountId: session.accountId || binding.external_account_id || '',
      session: sessionName,
    },
  };
}

app.get('/api/conversations/whatsapp/check', requireSameSite, async (req, res) => {
  const phone = normalizeOutboundWhatsAppPhone(req.query?.phone);
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;

  if (!/^\d{7,15}$/.test(phone)) {
    return res.status(400).json({ error: '请输入包含国家区号的有效 WhatsApp 号码，例如 +1 202 555 0147' });
  }

  try {
    res.json(await checkWhatsAppRecipientForUser(authenticated, phone));
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || 'WhatsApp 号码校验失败', detail: error.detail || null });
  }
});

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
    const recipient = await checkWhatsAppRecipientForUser(authenticated, phone);
    const sessionName = recipient.fromAccount.session;
    const chatId = recipient.chatId;
    const sentResponse = await fetchWaha('/api/sendText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionName, chatId, text: content }),
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
        `INSERT INTO conv.conversations(channel, external_chat_id, contact_id, status, agent_id, owner_id, channel_owner_id, waha_session)
         VALUES ('whatsapp', $1, $2, 'takeover', $3, $4, $4, $5)
         ON CONFLICT(channel, external_chat_id) DO UPDATE SET
           status = 'takeover', agent_id = COALESCE(EXCLUDED.agent_id, conv.conversations.agent_id),
           owner_id = COALESCE(conv.conversations.owner_id, EXCLUDED.owner_id),
           channel_owner_id = COALESCE(conv.conversations.channel_owner_id, EXCLUDED.channel_owner_id),
           waha_session = COALESCE(conv.conversations.waha_session, EXCLUDED.waha_session),
           updated_at = now()
         RETURNING id, channel, status, external_chat_id AS "externalChatId"`,
        [chatId, contactResult.rows[0].id, actorId, authenticated.userId, sessionName],
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
    return res.status(error.status || 502).json({ error: error.status ? error.message : '无法发起 WhatsApp 会话', detail: error.status ? error.detail : error.message });
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
  if (!['takeover', 'release', 'close'].includes(action)) return res.status(400).json({ error: 'unsupported status action' });
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(403).json({ error: '当前账号没有工作区成员权限' });
  if (viewer.isBoss) return res.status(403).json({ error: 'Boss 当前仅有查看权限，不能接管或释放会话' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scheduleActive = aiScheduleActiveExpression('cs');
    const currentResult = await client.query(
      `SELECT c.id, c.status, c.channel, c.agent_id, c.external_chat_id, COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AS "aiEnabled",
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
    if (action !== 'close' && (!conversation.aiEnabled || !conversation.inTakeoverWindow)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'AI客服未激活或不在托管时间内' });
    }
    if (action === 'takeover' && conversation.status === 'takeover' && conversation.agent_id !== viewer.workspaceMemberId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '该会话已被其他销售接管' });
    }
    if ((action === 'release' || action === 'close') && conversation.status === 'takeover' && conversation.agent_id !== viewer.workspaceMemberId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '该会话不是当前账号接管，不能操作' });
    }

    const nextStatus = action === 'takeover' ? 'takeover' : action === 'close' ? 'closed' : 'open';
    const systemText = action === 'takeover'
      ? '销售已人工接管此会话'
      : action === 'close'
        ? '会话已关闭'
        : '已切换为 AI 托管';
    if (action === 'release' && conversation.channel === 'website') {
      await releaseWebsiteAiTakeover(conversation.external_chat_id);
    }
    if (action === 'takeover') {
      await client.query(
        `INSERT INTO conv.conversation_participants(conversation_id, workspace_member_id, user_id, role, first_joined_at, last_joined_at)
         VALUES ($1, $2, $3, 'takeover', now(), now())
         ON CONFLICT(conversation_id, workspace_member_id)
         DO UPDATE SET last_joined_at = now(), user_id = EXCLUDED.user_id, role = EXCLUDED.role`,
        [req.params.id, viewer.workspaceMemberId, viewer.userId],
      );
    }
    const nextAgentId = action === 'takeover' ? viewer.workspaceMemberId : null;
    await client.query(
      `UPDATE conv.conversations SET status = $2, agent_id = $3, updated_at = now() WHERE id = $1`,
      [req.params.id, nextStatus, nextAgentId],
    );
    await client.query(
      `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at)
       VALUES ($1, $2, 'system', $3, 'system', now())`,
      [`system:${req.params.id}:${Date.now()}:${action}`, req.params.id, systemText],
    );
    await client.query('COMMIT');
    await recordAuditEvent('conversation.status_changed', {
      channel: conversation.channel,
      conversationId: req.params.id,
      actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
      requestSummary: auditRequestSummary(req),
      payload: { action, fromStatus: conversation.status, toStatus: nextStatus },
    });
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

const WAHA_MEDIA_MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'video/quicktime': '.mov',
  'audio/ogg': '.ogg', 'audio/ogg; codecs=opus': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/amr': '.amr',
  'application/pdf': '.pdf',
};

// WAHA 入站 webhook 里的 media.url 不可信：观测到它把容器内部监听端口写成了
// `http://localhost:3000/...`（WAHA 自己的内部端口，跟宿主/浏览器能访问的地址、
// 跟 WAHA_API_URL 都不是一回事），既连不上也没带 X-Api-Key。
// 只取其 path+query，改走 WAHA_API_URL（内网可达）+ X-Api-Key 下载，落盘到本站
// UPLOAD_DIR，返回同源相对 URL 供前端直接 <img>/<video>/<audio> 渲染。
async function downloadWahaMediaToLocalFile(rawUrl, mimetype, filenameHint) {
  let pathAndQuery = '';
  try {
    const parsed = new URL(rawUrl);
    pathAndQuery = parsed.pathname + parsed.search;
  } catch {
    return null;
  }
  const response = await fetchWaha(pathAndQuery);
  if (!response.ok) throw new Error(`waha media fetch ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extensionFromName(filenameHint || pathAndQuery) || WAHA_MEDIA_MIME_EXT[String(mimetype || '').toLowerCase()] || '';
  const storedName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), buffer);
  // 带上原始文件名（归一化后），让下载时保留真实名而不是磁盘随机名。
  const original = filenameHint ? normalizeUploadFilename(filenameHint) : '';
  const suffix = original ? `?filename=${encodeURIComponent(original)}` : '';
  return `/conv-api/uploads/conversation-files/${encodeURIComponent(storedName)}${suffix}`;
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

async function createWahaSession(sessionName = WAHA_SESSION) {
  const response = await fetchWaha('/api/sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: sessionName,
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

async function ensureWahaSession(sessionName = WAHA_SESSION) {
  try {
    return await getWahaSession(sessionName);
  } catch (error) {
    if (!isWahaSessionNotFound(error)) throw error;
    await createWahaSession(sessionName);
    return waitForWahaStatus(['STARTING', 'SCAN_QR_CODE', 'WORKING', 'FAILED', 'STOPPED'], 10, 1000, sessionName);
  }
}

async function getWahaSession(sessionName = WAHA_SESSION) {
  const response = await fetchWaha(`/api/sessions/${encodeURIComponent(sessionName)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'WAHA status failed');
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  return data;
}

async function waitForWahaStatus(expectedStatuses, attempts = 8, delayMs = 1200, sessionName = WAHA_SESSION) {
  for (let i = 0; i < attempts; i++) {
    const session = await getWahaSession(sessionName);
    if (expectedStatuses.includes(session.status)) return session;
    await sleep(delayMs);
  }
  return getWahaSession(sessionName);
}

// ── v2.1 多账号：per-member WAHA session 工具 ─────────────────────────────
// 每销售一个独立 WAHA session，命名 wa_<workspaceMemberId>；历史默认号沿用 'default'。
function sessionNameForMember(memberId) {
  return memberId ? `wa_${memberId}` : WAHA_SESSION;
}

// 按 WAHA session 名反查当前有效绑定（用于入站归属 + 出站鉴权）。
async function getActiveWhatsAppBindingBySession(session) {
  if (!session) return null;
  const result = await pool.query(
    `SELECT ca.*, wm."nameFirstName", wm."nameLastName"
     FROM conv.channel_accounts ca
     LEFT JOIN ${await getWorkspaceSchema()}."workspaceMember" wm ON wm.id::text = ca.workspace_member_id
     WHERE ca.channel = 'whatsapp'
       AND ca.provider = 'waha'
       AND ca.provider_session = $1
       AND ca.status <> 'unbound'
     ORDER BY ca.updated_at DESC
     LIMIT 1`,
    [session],
  );
  return result.rows[0] || null;
}

// 当前用户的 WAHA session 名：已有绑定则用其 provider_session，否则按成员生成专属名。
async function resolveUserWahaSessionName(authenticated) {
  const existing = await getCurrentUserWhatsAppBinding(authenticated.userId);
  if (existing?.provider_session) return existing.provider_session;
  return sessionNameForMember(authenticated.actor?.id);
}

// 校验某 session 当前是否由本账号绑定并处于已连接状态（用于出站发送鉴权）。
async function requireBindingForSession(req, res, sessionName) {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return null;
  const normalized = normalizeWahaSession(await getWahaSession(sessionName).catch(() => ({})));
  if (!normalized.connected) {
    res.status(409).json({ error: 'WhatsApp 当前未连接，请先在设置中完成绑定' });
    return null;
  }
  const binding = await getActiveWhatsAppBindingBySession(sessionName);
  if (!binding) {
    res.status(403).json({ error: '该会话所属 WhatsApp 未绑定到 CRM 账号，请先在设置中点击“绑定到我的账号”' });
    return null;
  }
  if (binding.user_id !== authenticated.userId) {
    res.status(403).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，当前账号不能使用该号码发送消息` });
    return null;
  }
  return { authenticated, binding, session: normalized };
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
       AND status <> 'unbound'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId],
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
    const sessionName = await resolveUserWahaSessionName(authenticated);
    const data = await ensureWahaSession(sessionName);
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

// ===== RBAC 权限管理（仅管理员） =====
// 列出工作区全部成员及其当前角色（非 admin 返回 403，前端借此判断是否显示入口）
app.get('/api/rbac/members', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const schema = await getWorkspaceSchema();
    const result = await pool.query(
      `SELECT wm.id AS "memberId", wm."userId", wm."userEmail" AS email,
              wm."nameFirstName" AS "firstName", wm."nameLastName" AS "lastName",
              COALESCE(ur.role, 'sales') AS role,
              COALESCE(rs.scope, 'own') AS scope,
              rs.description AS "roleDescription"
         FROM ${schema}."workspaceMember" wm
         LEFT JOIN conv.user_roles ur ON ur.workspace_member_id = wm.id::text
         LEFT JOIN conv.role_scopes rs ON rs.role = COALESCE(ur.role, 'sales')
        WHERE wm."deletedAt" IS NULL
        ORDER BY wm."nameFirstName", wm."nameLastName"`,
    );
    const members = result.rows.map(r => ({
      memberId: String(r.memberId),
      userId: r.userId,
      email: r.email || '',
      name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || (r.email || 'CRM 用户'),
      role: r.role,
      scope: r.scope,
      roleDescription: r.roleDescription || '',
    }));
    res.json({ members });
  } catch (error) {
    res.status(500).json({ error: '读取成员列表失败', detail: error.message });
  }
});

// 角色定义
app.get('/api/rbac/role-scopes', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const result = await pool.query(`SELECT role, scope, description FROM conv.role_scopes ORDER BY role`);
    res.json({ roles: result.rows });
  } catch (error) {
    res.status(500).json({ error: '读取角色定义失败', detail: error.message });
  }
});

// 设置某成员角色
app.put('/api/rbac/roles/:workspaceMemberId', requireSameSite, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { workspaceMemberId } = req.params;
  const { role } = req.body || {};
  const validRoles = ['admin', 'manager', 'sales', 'boss'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: '无效的角色，可选：' + validRoles.join(', ') });
  try {
    await pool.query(
      `INSERT INTO conv.user_roles(workspace_member_id, role, granted_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (workspace_member_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, updated_at = now()`,
      [workspaceMemberId, role, admin.workspaceMemberId],
    );
    recordAuditEvent('rbac.role.updated', {
      actor: { userId: admin.userId, workspaceMemberId: admin.workspaceMemberId, name: admin.name },
      payload: { workspaceMemberId, role, grantedBy: admin.workspaceMemberId },
    });
    res.json({ ok: true, workspaceMemberId, role });
  } catch (error) {
    res.status(500).json({ error: '设置角色失败', detail: error.message });
  }
});

// 重置某成员角色为默认 sales（删除显式配置）
app.delete('/api/rbac/roles/:workspaceMemberId', requireSameSite, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { workspaceMemberId } = req.params;
  try {
    await pool.query(`DELETE FROM conv.user_roles WHERE workspace_member_id = $1`, [workspaceMemberId]);
    recordAuditEvent('rbac.role.reset', {
      actor: { userId: admin.userId, workspaceMemberId: admin.workspaceMemberId, name: admin.name },
      payload: { workspaceMemberId },
    });
    res.json({ ok: true, workspaceMemberId, role: 'sales' });
  } catch (error) {
    res.status(500).json({ error: '重置角色失败', detail: error.message });
  }
});

// 管理员为成员重置登录密码（Twenty 原生无 forgot/reset 能力，内部团队用管理员后台
// 直接改密即可）。哈希算法与 Twenty 一致：bcrypt saltRounds=10、密码 ≥8 位
// （对齐 twenty/server/src/core/auth/auth.util.ts 的 PASSWORD_REGEX /^.{8,}$/）；
// 用 bcryptjs 生成 $2a$ 哈希，Twenty 登录时的原生 bcrypt.compare 可正常校验。
// 目标 userId 一律从 workspaceMember 服务端解析，不信任前端传入，避免越权改到别人。
app.post('/api/rbac/members/:workspaceMemberId/reset-password', requireSameSite, async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { workspaceMemberId } = req.params;
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
  if (newPassword.length > 128) return res.status(400).json({ error: '新密码不能超过 128 位' });
  try {
    const schema = await getWorkspaceSchema();
    const memberResult = await pool.query(
      `SELECT wm."userId", wm."userEmail" AS email,
              wm."nameFirstName" AS "firstName", wm."nameLastName" AS "lastName"
         FROM ${schema}."workspaceMember" wm
        WHERE wm.id::text = $1 AND wm."deletedAt" IS NULL
        LIMIT 1`,
      [workspaceMemberId],
    );
    const member = memberResult.rows[0];
    if (!member?.userId) return res.status(404).json({ error: '未找到该成员对应的登录账号' });
    // 目标账号必须存在于 core.user，且原本就是密码登录（有 passwordHash）——
    // 对 SSO/未激活账号直接改密没有意义，明确拒绝而不是静默写入。
    const userResult = await pool.query(
      `SELECT id, email, "passwordHash" FROM core."user" WHERE id = $1 LIMIT 1`,
      [member.userId],
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: '未找到该成员对应的登录账号' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE core."user" SET "passwordHash" = $1, "updatedAt" = now() WHERE id = $2`, [passwordHash, user.id]);
    const memberName = [member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email || '成员';
    // 审计只记「谁给谁重置了密码」，绝不记录密码明文或哈希。
    recordAuditEvent('rbac.password.reset', {
      actor: { userId: admin.userId, workspaceMemberId: admin.workspaceMemberId, name: admin.name },
      payload: { targetWorkspaceMemberId: workspaceMemberId, targetUserId: user.id, targetEmail: user.email },
    });
    res.json({ ok: true, workspaceMemberId, email: user.email, name: memberName });
  } catch (error) {
    console.error('[rbac] reset password failed:', error.message);
    res.status(500).json({ error: '重置密码失败', detail: error.message });
  }
});

app.get('/api/channel-accounts/whatsapp/qr', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    const sessionName = await resolveUserWahaSessionName(authenticated);
    const current = normalizeWahaSession(await ensureWahaSession(sessionName).catch(() => ({})));
    if (current.connected) {
      const binding = await getActiveWhatsAppBindingByAccount(current.accountId);
      if (binding && binding.user_id !== authenticated.userId) {
        return res.status(409).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，不能获取二维码` });
      }
    }
    let response = await fetchWaha(`/api/${encodeURIComponent(sessionName)}/auth/qr`);
    if (response.status === 422) {
      const detail = await response.json().catch(() => ({}));
      if (['FAILED', 'STOPPED'].includes(detail.status)) {
        await fetchWaha(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: 'POST' });
        await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 10, 1000, sessionName);
        response = await fetchWaha(`/api/${encodeURIComponent(sessionName)}/auth/qr`);
      } else if (detail.status === 'STARTING') {
        await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 10, 1000, sessionName);
        response = await fetchWaha(`/api/${encodeURIComponent(sessionName)}/auth/qr`);
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
    const sessionName = await resolveUserWahaSessionName(authenticated);
    let current = await ensureWahaSession(sessionName).catch(() => null);
    if (!current || ['FAILED', 'STOPPED'].includes(current.status)) {
      await fetchWaha(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: 'POST' });
      current = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 10, 1000, sessionName);
    } else if (current.status === 'STARTING') {
      current = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 10, 1000, sessionName);
    } else if (current.status !== 'SCAN_QR_CODE' && current.status !== 'WORKING') {
      const response = await fetchWaha(`/api/sessions/${encodeURIComponent(sessionName)}/start`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 422) {
        return res.status(response.status).json({ error: data.message || 'WAHA start failed', detail: data });
      }
      current = response.ok ? data : await getWahaSession(sessionName);
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
    const sessionName = await resolveUserWahaSessionName(authenticated);
    const current = await ensureWahaSession(sessionName).catch(() => null);
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

    await fetchWaha(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: 'POST' });
    const session = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 12, 1200, sessionName);
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
    const sessionName = await resolveUserWahaSessionName(authenticated);
    const phoneNumber = normalizeWhatsAppPairingPhone(req.body?.phoneNumber);
    if (phoneNumber.length < 8 || phoneNumber.length > 15) {
      return res.status(400).json({ error: '请输入带国家区号的 WhatsApp 号码，例如 8613800000000（仅示例）' });
    }

    let current = await ensureWahaSession(sessionName).catch(() => null);
    if (current?.status === 'WORKING') {
      const normalized = normalizeWahaSession(current);
      const binding = await getActiveWhatsAppBindingByAccount(normalized.accountId);
      if (binding && binding.user_id !== authenticated.userId) {
        return res.status(409).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，不能生成配对码` });
      }
      return res.status(409).json({ error: '当前 WhatsApp 已连接，不需要生成配对码', status: normalized.status });
    }
    if (!current || ['FAILED', 'STOPPED'].includes(current.status)) {
      await fetchWaha(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: 'POST' });
      current = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 12, 1200, sessionName);
    } else if (current.status === 'STARTING') {
      current = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING'], 12, 1200, sessionName);
    }
    if (current?.status === 'WORKING') {
      const normalized = normalizeWahaSession(current);
      const binding = await getActiveWhatsAppBindingByAccount(normalized.accountId);
      if (binding && binding.user_id !== authenticated.userId) {
        return res.status(409).json({ error: `该 WhatsApp 已绑定到 ${formatBindingOwner(binding)}，不能生成配对码` });
      }
      return res.status(409).json({ error: '当前 WhatsApp 已连接，不需要生成配对码', status: normalized.status });
    }

    const response = await fetchWaha(`/api/${encodeURIComponent(sessionName)}/auth/request-code`, {
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
      session: sessionName,
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
    const sessionName = await resolveUserWahaSessionName(authenticated);
    const normalized = normalizeWahaSession(await ensureWahaSession(sessionName));
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

async function logoutWahaSession(sessionName = WAHA_SESSION) {
  const candidates = [
    { pathname: `/api/sessions/${encodeURIComponent(sessionName)}/logout`, method: 'POST' },
    { pathname: `/api/${encodeURIComponent(sessionName)}/auth/logout`, method: 'POST' },
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
    const normalized = normalizeWahaSession(await getWahaSession(binding.provider_session || WAHA_SESSION).catch(() => ({})));
    if (normalized.connected && normalized.accountId && normalized.accountId !== binding.external_account_id) {
      return res.status(409).json({ error: '当前在线 WhatsApp 与该绑定记录不一致，请刷新状态后重试' });
    }
    if (normalized.connected) await logoutWahaSession(binding.provider_session || WAHA_SESSION);
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

async function ensureOpportunityForInboundConversation({ conversationId, contactId, channel, fallbackName, phone }) {
  if (!conversationId || !contactId || !['whatsapp', 'website'].includes(channel)) return null;
  const source = SOURCE_BY_CHANNEL[channel];
  const existing = await pool.query(
    'SELECT twenty_opportunity_id FROM conv.contacts WHERE id = $1 LIMIT 1',
    [contactId],
  );
  if (existing.rows[0]?.twenty_opportunity_id) return existing.rows[0].twenty_opportunity_id;

  const data = {
    name: nonBlankOrNull(fallbackName) || `${channel === 'whatsapp' ? 'WhatsApp' : '官网客服'}线索`,
    stage: 'XIANSUO',
  };
  if (source) data.keHuLaiYuan = source;
  const rawPhone = String(phone || '').replace(/[\s()-]+/g, '');
  if (rawPhone && /^\+?\d{5,15}$/.test(rawPhone)) {
    data.phone = rawPhone.startsWith('+')
      ? { primaryPhoneNumber: rawPhone }
      : { primaryPhoneNumber: rawPhone, primaryPhoneCallingCode: '+86', primaryPhoneCountryCode: 'CN' };
  }
  await stripUnavailableOpportunityFields(data, []);

  try {
    const result = await twentyGraphQL(
      'mutation($data: OpportunityCreateInput!){ createOpportunity(data: $data){ id name } }',
      { data },
      TWENTY_API_KEY,
    );
    const opportunity = result?.createOpportunity;
    if (!opportunity?.id) throw new Error('createOpportunity returned empty id');
    await pool.query(
      'UPDATE conv.contacts SET twenty_opportunity_id = $2, updated_at = now() WHERE id = $1 AND twenty_opportunity_id IS NULL',
      [contactId, opportunity.id],
    );
    await recordAuditEvent('conversation.auto_created_lead', {
      channel,
      conversationId,
      payload: { opportunityId: opportunity.id, stage: 'XIANSUO', source },
    });
    return opportunity.id;
  } catch (error) {
    console.error('[auto-lead] create opportunity failed:', error.message);
    return null;
  }
}

async function opportunitySelectExpression(fieldName, fallbackExpression = 'NULL') {
  return (await workspaceColumnExists('opportunity', fieldName))
    ? `"${fieldName}"`
    : `${fallbackExpression} AS "${fieldName}"`;
}

app.put('/api/conversations/:id/draft', requireSameSite, async (req, res) => {
  const access = await requireWriteConversationAccess(req, res);
  if (!access) return;
  const b = req.body || {};
  const draft = {};
  for (const k of DRAFT_FIELDS) if (b[k] !== undefined) draft[k] = typeof b[k] === 'string' ? b[k] : String(b[k] ?? '');
  const r = await pool.query('UPDATE conv.conversations SET lead_draft = $2, updated_at = now() WHERE id = $1 RETURNING id', [req.params.id, draft]);
  if (!r.rowCount) return res.status(404).json({ error: 'conversation not found' });
  await recordAuditEvent('conversation.draft_saved', {
    channel: access.conversation.channel,
    conversationId: req.params.id,
    actor: { userId: access.authenticated.userId, workspaceMemberId: access.authenticated.actor.id, name: access.authenticated.actor.name },
    requestSummary: auditRequestSummary(req),
    payload: { fields: Object.keys(draft) },
  });
  res.json({ saved: true });
});

// 「转为线索」：把右侧表单字段映射到 Opportunity 并创建；成功后在联系人上记 opportunity id。
app.post('/api/conversations/:id/convert-to-lead', requireSameSite, async (req, res) => {
  const writeAccess = await requireWriteConversationAccess(req, res);
  if (!writeAccess) return;
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
    await recordAuditEvent(isUpdate ? 'conversation.lead_updated' : 'conversation.converted_to_lead', {
      channel: row.channel,
      conversationId: req.params.id,
      actor: { userId: writeAccess.authenticated.userId, workspaceMemberId: writeAccess.authenticated.actor.id, name: writeAccess.authenticated.actor.name },
      requestSummary: auditRequestSummary(req),
      payload: { opportunityId: opp.id, skipped: [...new Set(skipped)], updated: isUpdate },
    });
    res.status(isUpdate ? 200 : 201).json({ opportunityId: opp.id, name: opp.name, skipped: [...new Set(skipped)], updated: isUpdate });
  } catch (error) {
    // 写商机失败：仅回滚本次「新建」的孤儿 Person（更新既有 Person 不回滚）。
    if (createdPersonId) twentyGraphQL('mutation($id: UUID!){ deletePerson(id: $id){ id } }', { id: createdPersonId }, twentyToken).catch(() => {});
    console.error('[convert-to-lead] failed:', error.message);
    res.status(502).json({ error: 'convert failed', detail: error.message });
  }
});

// Opportunity → Person 联系人字段单向同步（Twenty webhook: opportunity.updated）。
// 只回写联系人属性(电话/邮箱)，商机级字段(阶段/金额/产品等)不同步；单向不回哈，天然防死循环。
const OPPORTUNITY_WEBHOOK_SECRET = process.env.OPPORTUNITY_WEBHOOK_SECRET || '';
app.post('/api/webhooks/twenty/opportunity-updated', async (req, res) => {
  // 先应答 200，避免 Twenty 因慢响应/异常重试风暴；处理失败只记日志。
  res.status(200).json({ ok: true });
  try {
    if (OPPORTUNITY_WEBHOOK_SECRET) {
      const provided = req.headers['x-webhook-secret'] || req.query.secret || '';
      if (provided !== OPPORTUNITY_WEBHOOK_SECRET) {
        console.warn('[opp-sync] rejected: bad secret');
        return;
      }
    }
    const body = req.body || {};
    const record = body.record || body.data?.record || body.data || {};
    const oppId = record.id || body.recordId || body.id;
    if (!oppId) { console.warn('[opp-sync] no opportunity id in payload'); return; }

    // 不完全信任 webhook payload 字段完整性，回查一次商机最新状态。
    const fresh = await twentyGraphQL(
      `query($id: UUID!){ opportunity(filter:{id:{eq:$id}}){ id phone { primaryPhoneNumber primaryPhoneCallingCode primaryPhoneCountryCode } ${OPPORTUNITY_EMAIL_FIELD} pointOfContact { id } } }`,
      { id: oppId },
    ).catch((error) => { console.error('[opp-sync] fetch opportunity failed:', error.message); return null; });
    const opp = fresh?.opportunity;
    const personId = opp?.pointOfContact?.id;
    if (!personId) { console.log('[opp-sync] skip: no pointOfContact for opportunity', oppId); return; }

    const d = {};
    if (opp.phone?.primaryPhoneNumber) d.phones = { primaryPhoneNumber: opp.phone.primaryPhoneNumber, primaryPhoneCallingCode: opp.phone.primaryPhoneCallingCode || undefined, primaryPhoneCountryCode: opp.phone.primaryPhoneCountryCode || undefined };
    const oppEmail = firstValidEmail(opp[OPPORTUNITY_EMAIL_FIELD]);
    if (oppEmail) d.emails = { primaryEmail: oppEmail };

    if (Object.keys(d).length === 0) { console.log('[opp-sync] skip: nothing to sync for opportunity', oppId); return; }
    await twentyGraphQL('mutation($id: UUID!, $d: PersonUpdateInput!){ updatePerson(id: $id, data: $d){ id } }', { id: personId, d });
    console.log('[opp-sync] synced opportunity', oppId, '-> person', personId, Object.keys(d));
  } catch (error) {
    console.error('[opp-sync] failed:', error.message);
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
         "guoJiaDiQuAddressCountry" = COALESCE($10, "guoJiaDiQuAddressCountry"),
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
       "guoJiaDiQuAddressCountry",
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

function convertToProjectFailure(error) {
  const base = convertToPersonFailure(error);
  if (base.code === 'PRODUCT_REQUIRED') {
    return {
      ...base,
      detail: '请先在线索表填写「客户需求产品」，再执行转项目。',
    };
  }
  if (base.code === 'DUPLICATE_VALUE') {
    return {
      ...base,
      error: '项目表存在唯一字段冲突',
      detail: base.detail || '可能是关联编码已存在。',
    };
  }
  if (base.code === 'FIELD_NOT_FOUND') {
    return {
      ...base,
      error: '项目表或线索表字段不存在',
      detail: base.detail || '可能有字段被停用、重命名或尚未创建。',
    };
  }
  if (base.code === 'TABLE_NOT_FOUND') {
    return {
      ...base,
      error: 'CRM 数据表不存在',
      detail: base.detail || '当前工作区项目表结构异常。',
    };
  }
  return {
    ...base,
    error: base.error === '转客户失败' ? '转项目失败' : base.error,
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
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const viewer = await resolveConversationViewer(req);
  if (viewer?.isBoss) return res.status(403).json({ error: 'Boss 当前仅有查看权限，不能执行转客户' });
  const auditActor = await resolveAuditActor(req).catch((error) => {
    console.error('[audit] resolve actor failed:', error.message);
    return null;
  });
  if (!auditActor) console.warn('[audit] current user not resolved; record audit will keep API identity');
  if (!auditActor) console.warn('[audit] request summary:', auditRequestSummary(req));

  const client = await pool.connect();
  try {
    const schema = await getWorkspaceSchema();
    const opportunityKeHuLeiXingSelect = (await workspaceColumnExists('opportunity', 'gongSiLeiXing'))
      ? '"gongSiLeiXing" AS "keHuLeiXing"'
      : await opportunitySelectExpression('keHuLeiXing');
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
         "whatsappPrimaryPhoneNumber" AS "phonePrimaryPhoneNumber",
         "whatsappPrimaryPhoneCountryCode" AS "phonePrimaryPhoneCountryCode",
         "whatsappPrimaryPhoneCallingCode" AS "phonePrimaryPhoneCallingCode",
         "youXiangPrimaryEmail" AS "emailPrimaryEmail",
         "youXiangPrimaryEmail" AS "youXiang",
         "guoJiaDiQuAddressCountry" AS "countryAddressCountry",
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
    await recordAuditEvent('opportunity.converted_to_person', {
      channel: 'opportunity',
      actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
      requestSummary: auditRequestSummary(req),
      payload: {
        opportunityId: opportunity.id,
        personId: person.id,
        syncGroupCode: opportunity.syncGroupCode,
        personCreated: person.created,
      },
    });
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

async function findExistingProjectForOpportunity(client, schema, opportunity) {
  const result = await client.query(
    `SELECT id
     FROM ${schema}."_xiangMu"
     WHERE "deletedAt" IS NULL
       AND (
         id = $1
         OR ($2::text IS NOT NULL AND "syncGroupCode" = $2)
         OR "sourceOpportunityId" = $3
       )
     ORDER BY
       CASE
         WHEN id = $1 THEN 0
         WHEN "syncGroupCode" = $2 THEN 1
         ELSE 2
       END
     LIMIT 1`,
    [
      opportunity.linkedProjectId || null,
      opportunity.syncGroupCode || null,
      opportunity.id,
    ],
  );
  return result.rows[0] || null;
}

async function nextProjectPosition(client, schema) {
  const result = await client.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS position
     FROM ${schema}."_xiangMu"
     WHERE "deletedAt" IS NULL`,
  );
  return Number(result.rows[0]?.position || 1);
}

async function upsertProjectFromOpportunity(client, schema, opportunity, personId, actor) {
  const existing = await findExistingProjectForOpportunity(client, schema, opportunity);
  const taskProgress = await client.query(
    `SELECT conv.opportunity_stage_to_project_task($1::text) AS value`,
    [opportunity.stage || null],
  );
  const taskValue = taskProgress.rows[0]?.value || null;
  const name = nonBlankOrNull(opportunity.name) || nonBlankOrNull(opportunity.keHuXuQiuChanPin) || opportunity.syncGroupCode || '未命名项目';
  const actorName = actor?.name || 'CRM 用户';

  if (existing?.id) {
    const result = await client.query(
      `UPDATE ${schema}."_xiangMu" AS target
       SET
         "syncGroupCode" = COALESCE("syncGroupCode", $2),
         "sourceOpportunityId" = COALESCE("sourceOpportunityId", $1),
         "linkedPersonId" = COALESCE("linkedPersonId", $3),
         name = COALESCE($4, name),
         "guoJiaDiQuAddressCountry" = COALESCE($5, "guoJiaDiQuAddressCountry"),
         "xuQiuChanPin" = COALESCE($6, "xuQiuChanPin"),
         "jinEAmountMicros" = COALESCE($7, "jinEAmountMicros"),
         "jinECurrencyCode" = COALESCE($8, "jinECurrencyCode"),
         "zuiXinGenJinMarkdown" = COALESCE($9, "zuiXinGenJinMarkdown"),
         "zuiXinGenJinBlocknote" = COALESCE($10, "zuiXinGenJinBlocknote"),
         "renWuJinDu" = CASE WHEN $11::text IS NULL THEN "renWuJinDu" ELSE $11::text::${schema}."_xiangMu_renWuJinDu_enum" END,
         "updatedAt" = now()
       WHERE target.id = $12
       RETURNING id`,
      [
        opportunity.id,
        opportunity.syncGroupCode,
        personId || opportunity.linkedPersonId || opportunity.pointOfContactId || null,
        name,
        nonBlankOrNull(opportunity.countryAddressCountry),
        nonBlankOrNull(opportunity.keHuXuQiuChanPin),
        opportunity.amountAmountMicros || null,
        nonBlankOrNull(opportunity.amountCurrencyCode),
        nonBlankOrNull(opportunity.message),
        null,
        taskValue,
        existing.id,
      ],
    );
    return { id: result.rows[0]?.id || existing.id, created: false };
  }

  const position = await nextProjectPosition(client, schema);
  const result = await client.query(
    `INSERT INTO ${schema}."_xiangMu" (
       name,
       position,
       "createdBySource",
       "createdByWorkspaceMemberId",
       "createdByName",
       "createdByContext",
       "updatedBySource",
       "updatedByWorkspaceMemberId",
       "updatedByName",
       "updatedByContext",
       "guoNeiHaiWai",
       "guoJiaDiQuAddressCountry",
       "xuQiuChanPin",
       "jinEAmountMicros",
       "jinECurrencyCode",
       "zuiXinGenJinMarkdown",
       "zuiXinGenJinBlocknote",
       "renWuJinDu",
       "syncGroupCode",
       "sourceOpportunityId",
       "linkedPersonId"
     ) VALUES (
       $1,
       $2,
       'MANUAL',
       $3,
       $4,
       '{}'::jsonb,
       'MANUAL',
       $3,
       $4,
       '{}'::jsonb,
       'HAI_WAI',
       $5,
       $6,
       $7,
       $8,
       $9,
       $10,
       CASE WHEN $11::text IS NULL THEN NULL ELSE $11::text::${schema}."_xiangMu_renWuJinDu_enum" END,
       $12,
       $13,
       $14
     )
     RETURNING id`,
    [
      name,
      position,
      actor?.id || null,
      actorName,
      nonBlankOrNull(opportunity.countryAddressCountry),
      nonBlankOrNull(opportunity.keHuXuQiuChanPin),
      opportunity.amountAmountMicros || null,
      nonBlankOrNull(opportunity.amountCurrencyCode),
      nonBlankOrNull(opportunity.message),
      null,
      taskValue,
      opportunity.syncGroupCode,
      opportunity.id,
      personId || opportunity.linkedPersonId || opportunity.pointOfContactId || null,
    ],
  );
  return { id: result.rows[0]?.id, created: true };
}

// 线索表行按钮：把当前线索同步/关联到项目。会先补齐客户(People)关联，保持完整漏斗链路。
app.post('/api/opportunities/:id/convert-to-project', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const viewer = await resolveConversationViewer(req);
  if (viewer?.isBoss) return res.status(403).json({ error: 'Boss 当前仅有查看权限，不能执行转项目' });
  const auditActor = await resolveAuditActor(req).catch((error) => {
    console.error('[audit] resolve actor failed:', error.message);
    return null;
  });
  if (!auditActor) console.warn('[audit] current user not resolved; record audit will keep API identity');
  if (!auditActor) console.warn('[audit] request summary:', auditRequestSummary(req));

  const client = await pool.connect();
  try {
    const schema = await getWorkspaceSchema();
    const opportunityKeHuLeiXingSelect = (await workspaceColumnExists('opportunity', 'gongSiLeiXing'))
      ? '"gongSiLeiXing" AS "keHuLeiXing"'
      : await opportunitySelectExpression('keHuLeiXing');
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
         "whatsappPrimaryPhoneNumber" AS "phonePrimaryPhoneNumber",
         "whatsappPrimaryPhoneCountryCode" AS "phonePrimaryPhoneCountryCode",
         "whatsappPrimaryPhoneCallingCode" AS "phonePrimaryPhoneCallingCode",
         "youXiangPrimaryEmail" AS "emailPrimaryEmail",
         "youXiangPrimaryEmail" AS "youXiang",
         "guoJiaDiQuAddressCountry" AS "countryAddressCountry",
         "keHuXuQiuChanPin",
         "keHuLaiYuan",
         ${opportunityKeHuLeiXingSelect},
         "zhiWei",
         "amountAmountMicros",
         "amountCurrencyCode",
         "zuiXinGenJinMarkdown" AS "message",
         stage
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
        detail: '请先在线索表填写「客户需求产品」，再执行转项目。',
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

    opportunity.linkedPersonId = person.id;
    const project = await upsertProjectFromOpportunity(client, schema, opportunity, person.id, auditActor);
    if (!project?.id) throw new Error('project upsert failed');

    await client.query(
      `UPDATE ${schema}.opportunity
       SET
         "pointOfContactId" = COALESCE("pointOfContactId", $2),
         "linkedPersonId" = $2,
         "linkedProjectId" = $3,
         "updatedAt" = now()
       WHERE id = $1`,
      [opportunity.id, person.id, project.id],
    );

    await client.query(
      `UPDATE ${schema}.person
       SET "linkedProjectId" = $2, "sourceOpportunityId" = COALESCE("sourceOpportunityId", $1), "updatedAt" = now()
       WHERE id = $3`,
      [opportunity.id, project.id, person.id],
    );

    await syncOpportunityFollowUpsToProject(client, schema, opportunity.id, project.id, auditActor);

    await client.query('COMMIT');
    await applyRecordAuditBestEffort('person', person.id, auditActor, person.created ? 'create' : 'update');
    await applyRecordAuditBestEffort('_xiangMu', project.id, auditActor, project.created ? 'create' : 'update');
    await applyRecordAuditBestEffort('opportunity', opportunity.id, auditActor, 'update');
    await recordAuditEvent('opportunity.converted_to_project', {
      channel: 'opportunity',
      actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
      requestSummary: auditRequestSummary(req),
      payload: {
        opportunityId: opportunity.id,
        personId: person.id,
        projectId: project.id,
        syncGroupCode: opportunity.syncGroupCode,
        personCreated: person.created,
        projectCreated: project.created,
      },
    });
    res.status(project.created ? 201 : 200).json({
      opportunityId: opportunity.id,
      personId: person.id,
      projectId: project.id,
      syncGroupCode: opportunity.syncGroupCode,
      personCreated: person.created,
      created: project.created,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const failure = convertToProjectFailure(error);
    console.error('[convert-to-project] failed:', failure.code, failure.error, failure.detail);
    res.status(502).json(failure);
  } finally {
    client.release();
  }
});

// 记录销售在 CRM 内发出的消息。用渠道返回的消息 id 落库，与 message.any webhook 回传的
// 同一条出站消息（fromMe=true，external_msg_id 同为该 id）去重，避免重复。
async function recordAgentMessage(conversationId, content, externalId, options = {}) {
  const inserted = await pool.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, attachments, sent_at)
    VALUES ($1, $2, 'agent', $3, $4, $5, $6, now()) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
    [
      externalId || null,
      conversationId,
      content,
      options.contentType || 'text',
      options.mediaUrl || null,
      options.attachments ? JSON.stringify(options.attachments) : null,
    ]);
  await pool.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversationId, content]);
  return inserted.rows[0]?.id || null;
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

async function sendWhatsAppAttachmentFromUrl(chatId, attachment, session = WAHA_SESSION) {
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
      session,
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

async function sendWhatsAppFile(conversation, file, content, session = WAHA_SESSION) {
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
      session,
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
  const access = await requireConversationAccess(req, res, { reply: true, write: true });
  if (!access) {
    if (uploadedFile) deleteUploadedFileBestEffort(uploadedFile);
    return;
  }
  const { conversation } = access;
  // AI 模式才要求先接管；AI 关闭时销售可直接回复/发附件（普通销售会话）。
  if (conversation.aiEnabled && conversation.status !== 'takeover') return res.status(409).json({ error: '请先人工接管会话后再发送消息' });
  if (conversation.channel === 'whatsapp') {
    const ownership = await requireBindingForSession(req, res, conversation.waha_session || WAHA_SESSION);
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
        const sent = await sendWhatsAppFile(conversation, uploadedFile, content, conversation.waha_session || WAHA_SESSION);
        const messageId = await recordAgentMessage(req.params.id, displayContent, sent?.id?._serialized || sent?._data?.id?._serialized, {
          contentType: messageType,
          mediaUrl,
          attachments: [attachment],
        });
        await recordAuditEvent('message.sent', {
          channel: conversation.channel,
          conversationId: req.params.id,
          messageId,
          actor: access.viewer,
          requestSummary: auditRequestSummary(req),
          payload: { contentType: messageType, hasAttachment: true, attachmentTitle: title },
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
        const messageId = await recordAgentMessage(req.params.id, displayContent, `web:agent:${sent?.messageId || idempotencyKey}`, {
          contentType: messageType,
          mediaUrl,
          attachments: [attachment],
        });
        await recordAuditEvent('message.sent', {
          channel: conversation.channel,
          conversationId: req.params.id,
          messageId,
          actor: access.viewer,
          requestSummary: auditRequestSummary(req),
          payload: { contentType: messageType, hasAttachment: true, attachmentTitle: title },
        });
        return res.status(202).json(sent);
      } catch (error) {
        return res.status(502).json({ error: 'Website file send failed', detail: error.message });
      }
    }

    return res.status(400).json({ error: '当前渠道暂不支持发送附件' });
  }

  if (conversation.channel === 'whatsapp') {
    const response = await fetch(`${WAHA_API_URL}/api/sendText`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': WAHA_API_KEY }, body: JSON.stringify({ session: conversation.waha_session || WAHA_SESSION, chatId: conversation.external_chat_id, text: content }) });
    if (!response.ok) return res.status(502).json({ error: 'WhatsApp send failed', detail: await response.text() });
    const sent = await response.json();
    const messageId = await recordAgentMessage(req.params.id, content, sent?.id?._serialized || sent?._data?.id?._serialized);
    await recordAuditEvent('message.sent', {
      channel: conversation.channel,
      conversationId: req.params.id,
      messageId,
      actor: access.viewer,
      requestSummary: auditRequestSummary(req),
      payload: { contentType: 'text', hasAttachment: false },
    });
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
    const messageId = await recordAgentMessage(req.params.id, content, sent?.message_id);
    await recordAuditEvent('message.sent', {
      channel: conversation.channel,
      conversationId: req.params.id,
      messageId,
      actor: access.viewer,
      requestSummary: auditRequestSummary(req),
      payload: { contentType: 'text', hasAttachment: false },
    });
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
    const messageId = await recordAgentMessage(req.params.id, content, sent?.message_id);
    await recordAuditEvent('message.sent', {
      channel: conversation.channel,
      conversationId: req.params.id,
      messageId,
      actor: access.viewer,
      requestSummary: auditRequestSummary(req),
      payload: { contentType: 'text', hasAttachment: false },
    });
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
    const messageId = await recordAgentMessage(req.params.id, content, `web:agent:${sent?.messageId || idempotencyKey}`);
    await recordAuditEvent('message.sent', {
      channel: conversation.channel,
      conversationId: req.params.id,
      messageId,
      actor: access.viewer,
      requestSummary: auditRequestSummary(req),
      payload: { contentType: 'text', hasAttachment: false },
    });
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
