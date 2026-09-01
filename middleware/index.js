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
const {
  AI_SETTING_CHANNELS,
  aiScheduleActiveExpression,
  buildAiSettingResponses,
  normalizeAiSettingPayload,
  serializeAiSettingRow,
} = require('./lib/ai-settings');
const { conversationVisibilityWhere } = require('./lib/conversation-visibility');
const {
  isWebsiteFormPayload,
  mapLegacyCreateOpportunityGraphQLPayload,
  normalizeWebsiteFormPayload,
} = require('./lib/website-form');
const {
  attachmentFromUploadedFile,
  createUploadFileAllowed,
  deleteUploadedFileBestEffort,
  extensionFromName,
  fileMessageType,
  fileTitle,
  fileTypeFromName,
  normalizeOutboundAttachments,
  normalizeUploadFilename,
} = require('./lib/files');

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
const WAHA_STATUS_POLL_SECONDS = Math.max(30, Number(process.env.WAHA_STATUS_POLL_SECONDS || 60));
const WAHA_AUTO_RESTART_ON_DISCONNECT = String(process.env.WAHA_AUTO_RESTART_ON_DISCONNECT ?? 'true').toLowerCase() !== 'false';
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
const uploadFileAllowed = createUploadFileAllowed({
  allowedExtensions: ALLOWED_UPLOAD_EXTENSIONS,
  allowedMimePrefixes: ALLOWED_UPLOAD_MIME_PREFIXES,
  allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
});
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

function getWebsiteIngressSecret() {
  return String(WEBSITE_INGEST_SECRET || '').trim();
}

function getProvidedWebsiteIngressSecret(req) {
  return String(
    req.headers['x-webhook-secret']
    || req.headers['x-crm-webhook-secret']
    || req.query?.secret
    || '',
  ).trim();
}

function requireWebsiteIngressSecret(req, res, scope = 'website ingest') {
  const expected = getWebsiteIngressSecret();
  if (!expected) {
    console.error(`[${scope}] WEBSITE_INGEST_SECRET is not configured; rejecting external ingest`);
    res.status(503).json({ error: 'website ingest secret is not configured' });
    return false;
  }
  if (getProvidedWebsiteIngressSecret(req) !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function isLegacyWebsiteOpportunityGraphQLCompat(mapped) {
  const query = String(mapped?.payload?.query || '');
  const data = mapped?.payload?.variables?.data;
  return Boolean(
    mapped?.changed
    && /\bcreateOpportunity\b/.test(query)
    && data
    && typeof data === 'object'
    && !Array.isArray(data),
  );
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
  if (!token) return null;
  let tokenPayload;
  try {
    tokenPayload = await verifyTwentyAccessToken(token);
  } catch (error) {
    console.warn('[auth] viewer token verification failed:', error.message);
    return null;
  }
  const userId = tokenPayload?.sub || '';
  if (!userId || !tokenPayload?.workspaceId) return null;
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
  let isSupervisor = false;
  try {
    const roleResult = await pool.query(
      `SELECT ur.role AS conv_role, rs.scope AS conv_scope,
              COALESCE(
                string_agg(DISTINCT r2.label, ',') FILTER (WHERE r2.label IS NOT NULL),
                ''
              ) AS native_role_labels
         FROM ${schema}."workspaceMember" wm
         LEFT JOIN conv.user_roles ur ON ur.workspace_member_id = wm.id::text
         LEFT JOIN conv.role_scopes rs ON rs.role = ur.role
         LEFT JOIN core."userWorkspace" uw2 ON uw2."userId" = wm."userId"
         LEFT JOIN core."roleTarget" rt2 ON rt2."userWorkspaceId" = uw2."id"
         LEFT JOIN core."role" r2 ON r2.id = rt2."roleId"
        WHERE wm."userId" = $1 AND wm."deletedAt" IS NULL
        GROUP BY ur.role, rs.scope
        LIMIT 1`,
      [userId],
    );
    const row = roleResult.rows[0];
    if (row) {
      role = row.conv_role || 'sales';
      scope = row.conv_scope || 'own';
      // 原生角色自动联动（仅当 conv.user_roles 未显式赋予更高角色时生效）。
      // 匹配必须按角色 label，绝不能按 canReadAllObjectRecords（本实例所有原生角色该标志均为 true，
      // 按标志判断会把销售也升级成 boss，破坏「销售只看自己」隔离）。
      // 总经理/销售主管/Admin 原生角色 → 分别联动 boss/boss/admin，均可在 history 视图看全部对话历史。
      // 其中 总经理/销售主管 联动为 boss（scope=all，只读看全部），与「设置→账户→权限」手动配 boss 等价。
      if (role === 'sales' || role === 'own') {
        const labels = String(row.native_role_labels || '')
          .split(',')
          .map((s) => s.trim().toLowerCase());
        if (labels.some((l) => l.includes('销售主管'))) {
          role = 'manager';
          scope = 'team';
          isSupervisor = true;
        } else if (labels.some((l) => l.includes('总经理'))) {
          role = 'boss';
          scope = 'all';
        } else if (labels.some((l) => l === 'admin')) {
          role = 'admin';
          scope = 'all';
        }
      }
    }
  } catch (_err) {
    // 角色表尚未就绪时安全降级为 sales/own，不阻断现有功能
  }
  return {
    userId,
    workspaceId: String(tokenPayload.workspaceId),
    workspaceMemberId: String(member.id),
    email,
    name: [member.nameFirstName, member.nameLastName].filter(Boolean).join(' ').trim() || email || 'CRM 用户',
    isBoss: role === 'boss',
      role,
      scope,
      isSupervisor: isSupervisor || role === 'manager',
  };
}

app.get('/api/presence', async (req, res) => {
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
  try {
    const result = await pool.query(
      `SELECT status, updated_at AS "updatedAt"
         FROM conv.agent_presence
        WHERE workspace_id = $1 AND user_id = $2
        LIMIT 1`,
      [viewer.workspaceId, viewer.userId],
    );
    return res.json({ status: result.rows[0]?.status || 'offline', updatedAt: result.rows[0]?.updatedAt || null });
  } catch (error) {
    console.error('[presence] read failed:', error.message);
    return res.status(503).json({ error: '无法读取接待状态' });
  }
});

app.patch('/api/presence', async (req, res) => {
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!['online', 'offline'].includes(status)) {
    return res.status(400).json({ error: '接待状态只能是 online 或 offline' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO conv.agent_presence(workspace_id, user_id, workspace_member_id, status, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET
         workspace_member_id = EXCLUDED.workspace_member_id,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING status, updated_at AS "updatedAt"`,
      [viewer.workspaceId, viewer.userId, viewer.workspaceMemberId, status],
    );
    if (status === 'offline') {
      await releaseWebsiteTakeoversForOfflineAgents();
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('[presence] update failed:', error.message);
    return res.status(503).json({ error: '接待状态保存失败' });
  }
});

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
  if (!viewer) {
    res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
    return null;
  }
  const workspaceSchema = await getWorkspaceSchema();
  const visibility = conversationVisibilityWhere(viewer, 'c', 2, {
    workspaceSchema,
    allowPrivilegedAllChannels: !!options.historyView,
  });
  const visibleResult = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM conv.conversations c WHERE c.id = $1 AND ${visibility.sql}) AS visible`,
    [conversation.id, ...visibility.params],
  );
  if (!visibleResult.rows[0]?.visible) {
    res.status(403).json({ error: '当前账号无权查看该会话' });
    return null;
  }
  if (options.write && viewer.role === 'boss' && !viewer.isSupervisor) {
    res.status(403).json({ error: '当前角色仅有查看权限，不能接管或发送消息' });
    return null;
  }
  if (options.reply && conversation.aiEnabled && !(conversation.status === 'takeover' && conversation.agent_id === viewer.workspaceMemberId)) {
    res.status(403).json({ error: '该会话未由当前账号接管，不能发送消息' });
    return null;
  }
  if (options.reply && conversation.channel === 'website' && viewer.role !== 'boss') {
    const presenceResult = await pool.query(
      `SELECT status FROM conv.agent_presence WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [viewer.workspaceId, viewer.userId],
    );
    if (presenceResult.rows[0]?.status !== 'online') {
      res.status(409).json({ error: '请先切换为在线状态，再回复官网客户' });
      return null;
    }
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
      ORDER BY fu.created_at DESC`,
    [opportunityId],
  );
  const entries = result.rows || [];
  // 每条跟进 => 富文本：一行加粗署名（作者 · 时间）+ 内容段落（多行内容逐段渲染）。
  const blocks = [];
  const mdLines = [];
  for (const e of entries) {
    const sig = `${e.createdByName || '未知'} · ${formatFollowUpTime(e.createdAt)}`;
    blocks.push({
      id: crypto.randomUUID(),
      type: 'paragraph',
      props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
      content: [{ type: 'text', text: sig, styles: { bold: true } }],
      children: [],
    });
    mdLines.push(`**${sig}**`);
    const contentLines = String(e.content || '').split(/\r?\n/);
    for (const line of (contentLines.length ? contentLines : [''])) {
      blocks.push({
        id: crypto.randomUUID(),
        type: 'paragraph',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: line, styles: {} }],
        children: [],
      });
      mdLines.push(line);
    }
    mdLines.push(''); // 跟进之间空行分隔
  }
  const markdown = mdLines.join('\n').replace(/\n+$/, '');
  const blocknote = JSON.stringify(blocks);
  try {
    await client.query(
      `UPDATE ${schema}.opportunity
         SET "genJinJiLuBlocknote" = $2,
             "genJinJiLuMarkdown" = $3,
             "updatedAt" = now()
       WHERE id = $1`,
      [opportunityId, blocknote, markdown],
    );
  } catch (error) {
    console.error('[follow-ups] backfill genJinJiLu failed:', error.message);
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

app.post('/api/graphql-compat', async (req, res) => {
  const mapped = mapLegacyCreateOpportunityGraphQLPayload(req.body);
  try {
    const headers = { 'Content-Type': 'application/json' };
    const authorization = String(req.headers.authorization || '');
    const cookie = String(req.headers.cookie || '');
    const hasExplicitUserAuth = Boolean(authorization || cookie || String(req.headers['x-twenty-access-token'] || '').trim());
    const canUseSystemToken = !hasExplicitUserAuth && isLegacyWebsiteOpportunityGraphQLCompat(mapped);

    if (!hasExplicitUserAuth) {
      if (!canUseSystemToken) {
        return res.status(401).json({ error: 'unauthorized graphql proxy request' });
      }
      if (!requireWebsiteIngressSecret(req, res, 'graphql-compat')) return;
      if (!TWENTY_API_KEY) {
        return res.status(503).json({ error: 'twenty api key is not configured' });
      }
      headers.Authorization = `Bearer ${TWENTY_API_KEY}`;
    } else {
      if (cookie) headers.Cookie = cookie;
      if (authorization) headers.Authorization = authorization;
      const forwardedToken = String(req.headers['x-twenty-access-token'] || '').trim();
      if (!headers.Authorization && forwardedToken) headers.Authorization = `Bearer ${forwardedToken}`;
    }

    const originalData = req.body?.variables?.data;
    const mappedData = mapped.payload?.variables?.data;
    const legacyCompanyName = typeof originalData?.company === 'string'
      ? originalData.company.trim()
      : String(originalData?.companyName || originalData?.company_name || originalData?.organization || originalData?.organisation || '').trim();
    if (mapped.changed && mappedData && legacyCompanyName && !mappedData.companyId) {
      try {
        const existingCompany = await findCompanyByExactName(legacyCompanyName, TWENTY_API_KEY);
        const company = existingCompany || await createCompanyByName(legacyCompanyName, TWENTY_API_KEY, null);
        if (company?.id) mappedData.companyId = company.id;
      } catch (error) {
        console.error('[graphql-compat] company link failed:', error.message);
      }
    }
    const response = await fetch(`${TWENTY_API_URL}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify(mapped.payload),
    });
    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    else {
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) res.setHeader('Set-Cookie', setCookie);
    }
    if (mapped.changed) res.setHeader('X-CRM-GraphQL-Compat', 'legacy-opportunity-input');
    res.send(text);
  } catch (error) {
    console.error('[graphql-compat] forward failed:', error.message);
    res.status(502).json({ error: 'graphql compat forward failed', detail: error.message });
  }
});

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
    CREATE TABLE IF NOT EXISTS conv.conversation_read_states (
      conversation_id UUID REFERENCES conv.conversations(id) ON DELETE CASCADE,
      scope_key TEXT NOT NULL,
      last_read_at TIMESTAMPTZ,
      last_read_message_id UUID,
      read_by_member_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, scope_key));
    CREATE INDEX IF NOT EXISTS conversation_read_states_scope_idx
      ON conv.conversation_read_states(scope_key, conversation_id);
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
      content TEXT, content_type TEXT DEFAULT 'text', media_url TEXT, sender_role TEXT NOT NULL DEFAULT 'sales', sent_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS sender_role TEXT NOT NULL DEFAULT 'sales';
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS twenty_opportunity_id TEXT;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS lead_draft JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS ai_takeover_until TIMESTAMPTZ;
    -- 官网接管超时自动释放：接管时写入计时起点，释放/关闭时清空。
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS taken_over_at TIMESTAMPTZ;
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
    -- 当前用户的接待状态。状态属于 workspace + user，不与 WhatsApp 绑定状态混用。
    CREATE TABLE IF NOT EXISTS conv.agent_presence (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      workspace_member_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id));
    CREATE INDEX IF NOT EXISTS agent_presence_workspace_status_idx
      ON conv.agent_presence(workspace_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS conv.conversation_handoff_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conv.conversations(id) ON DELETE CASCADE,
      requested_by_member_id TEXT NOT NULL,
      from_agent_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
      decision TEXT CHECK (decision IN ('accepted', 'rejected')),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      effective_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_handoff_one_pending_idx
      ON conv.conversation_handoff_requests(conversation_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS conversation_handoff_pending_idx
      ON conv.conversation_handoff_requests(status, effective_at);
    ALTER TABLE conv.conversation_handoff_requests ADD COLUMN IF NOT EXISTS decision TEXT;
    CREATE TABLE IF NOT EXISTS conv.conversation_handoff_notices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conv.conversations(id) ON DELETE CASCADE,
      recipient_member_id TEXT NOT NULL,
      returned_by_member_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      seen_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS conversation_handoff_notice_recipient_idx
      ON conv.conversation_handoff_notices(recipient_member_id, seen_at, created_at DESC);
    -- 会话归属（多账号）：channel_owner=WA号主，owner=当前客户负责人
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS owner_id TEXT;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS channel_owner_id TEXT;
    ALTER TABLE conv.conversations ADD COLUMN IF NOT EXISTS waha_session TEXT;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS owner_id TEXT;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS raw_message_type TEXT;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS message_summary TEXT;
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
  // ===== 需求一（2026-08-18）对话名称统一编辑与持久化 =====
  // channel_display_name = 渠道原始名（webhook 每次同步，可回滚用）；
  // display_name         = 最终显示名（人工改过就是人工名）；
  // display_name_source  = 'manual' 时渠道 webhook 不得覆盖 display_name。
  await pool.query(`
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS channel_display_name TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS display_name_source TEXT NOT NULL DEFAULT 'channel';
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS display_name_updated_at TIMESTAMPTZ;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS display_name_updated_by TEXT;
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_display_name_source_check') THEN
        ALTER TABLE conv.contacts ADD CONSTRAINT contacts_display_name_source_check
          CHECK (display_name_source IN ('channel', 'manual'));
      END IF;
    END
    $do$;
    -- 历史初始化：只在渠道原始名为空时回填，绝不覆盖已存在的人工名。
    UPDATE conv.contacts SET channel_display_name = display_name
      WHERE channel_display_name IS NULL AND display_name IS NOT NULL AND display_name <> '';
  `);
  // ===== 需求二（2026-08-18）WhatsApp 消息送达/已读回执 =====
  // delivery_status 取值：pending / sent / delivered / read / failed（只升级不回退，failed 为终态）。
  // 历史消息按 'sent' 兜底：真实发生过的事实，且前端只对 agent/ai 的 WhatsApp 消息展示状态。
  await pool.query(`
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'sent';
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS delivery_status_code INTEGER;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS delivery_status_at TIMESTAMPTZ;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
    ALTER TABLE conv.messages ADD COLUMN IF NOT EXISTS status_detail TEXT;
    -- ack 靠 external_msg_id 反查消息，必须有索引（该列本身是 UNIQUE，已隐含索引）
    CREATE INDEX IF NOT EXISTS messages_delivery_status_idx
      ON conv.messages(conversation_id, delivery_status);
  `);
  // ===== 需求三（2026-08-18）官网访客 IP 地域与时区 =====
  // ip_address 仅作访问审计资料，不写入 Twenty 客户字段；geo_* 为推断数据，允许为空，必须记录 geo_source。
  await pool.query(`
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS ip_address INET;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_country_code TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_country_name TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_region TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_city TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_timezone TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_latitude NUMERIC(9,6);
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_longitude NUMERIC(9,6);
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_source TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS geo_updated_at TIMESTAMPTZ;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS landing_page_url TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS referrer_url TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS utm_source TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS utm_medium TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS utm_term TEXT;
    ALTER TABLE conv.contacts ADD COLUMN IF NOT EXISTS utm_content TEXT;
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
// WAHA `message` 事件为扁平 payload：{ from, body, hasMedia, media: { url, mimetype }, type }。
// 非文本消息的原始类型可能位于 type 或 _data.type，两个位置都兼容。
function whatsappRawMessageType(payload = {}) {
  return String(payload.type || payload._data?.type || payload.messageType || payload._data?.messageType || 'unknown')
    .trim().toLowerCase() || 'unknown';
}

function whatsappMessageSummary(payload = {}, rawType = whatsappRawMessageType(payload)) {
  const sender = payload.fromMe ? '我方' : '客户';
  const reaction = payload.reaction || payload.reactionText || payload._data?.reaction || payload._data?.reactionText || payload._data?.body || '';
  if (['reaction', 'reaction_message'].includes(rawType)) {
    return `${sender}发送了表情回应${reaction ? ` ${String(reaction).trim()}` : ''}`;
  }
  if (['location', 'live_location', 'location_message'].includes(rawType)) return `${sender}分享了位置`;
  if (['vcard', 'contact', 'contacts', 'multi_vcard'].includes(rawType)) return `${sender}分享了联系人`;
  if (['poll_creation', 'poll_update', 'poll'].includes(rawType)) return `${sender}${rawType === 'poll_update' ? '回复了投票' : '发起了投票'}`;
  return `${sender}发送了暂不支持的 WhatsApp 消息（类型：${rawType}）`;
}

function messageContent(payload = {}) {
  const media = payload.media || {};
  const mime = media.mimetype || '';
  const rawType = whatsappRawMessageType(payload);
  if (payload.hasMedia && media.url) {
    if (mime.startsWith('image/')) return { content: payload.body || '[图片]', type: 'image', mediaUrl: media.url, rawType, summary: null };
    if (mime.startsWith('video/')) return { content: payload.body || '[视频]', type: 'video', mediaUrl: media.url, rawType, summary: null };
    if (mime.startsWith('audio/')) return { content: '[语音]', type: 'audio', mediaUrl: media.url, rawType, summary: null };
    // WAHA 给的 media.filename 常是 UTF-8 被当 latin1 传过来的乱码，走同款归一化修复
    // （normalizeUploadFilename 会侦测 mojibake 并 latin1→utf8 还原）。
    const fileTitle = media.filename ? normalizeUploadFilename(media.filename) : (payload.body || '[文件]');
    return { content: fileTitle, type: 'file', mediaUrl: media.url, rawType, summary: null };
  }
  if (payload.body && !['reaction', 'reaction_message', 'location', 'live_location', 'location_message', 'vcard', 'contact', 'contacts', 'multi_vcard', 'poll_creation', 'poll_update', 'poll'].includes(rawType)) {
    return { content: payload.body, type: 'text', rawType, summary: null };
  }
  const summary = whatsappMessageSummary(payload, rawType);
  return { content: summary, type: 'unknown', rawType, summary };
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

async function saveAiSetting(client, setting) {
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
    [
      setting.channel,
      setting.enabled,
      setting.scheduleEnabled,
      setting.scheduleStart,
      setting.scheduleEnd,
      setting.timezone,
    ],
  );
  return serializeAiSettingRow(saved.rows[0]);
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
    `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, attachments, sent_at,
       delivery_status, delivery_status_at)
     VALUES ($1, $2, 'ai', $3, $4, $5, $6, now(), $7, now())
     ON CONFLICT(external_msg_id) DO NOTHING`,
    [
      externalId || null,
      conversationId,
      content,
      options.contentType || 'text',
      options.mediaUrl || null,
      options.attachments ? JSON.stringify(options.attachments) : null,
      // AI 自动回复调用渠道 API 成功后才落库，因此初始状态是 sent，后续由 message.ack 升级。
      options.deliveryStatus || 'sent',
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
  // 渠道原始名：只有客户入站事件的 notifyName 才是客户真名；
  // 出站回声（fromMe）里的 notifyName 是本机账号自己，不能当客户名写入。
  const channelName = (!fromMe && String(data.notifyName || data._data?.notifyName || '').trim()) || null;
  const displayName = channelName || phone || counterpartyJid;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 需求一：渠道名写 channel_display_name；display_name 仅在非人工命名时才跟随渠道名同步。
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name, channel_display_name, phone, owner_id)
      VALUES ('whatsapp', $1, $2, $2, $3, $4) ON CONFLICT(channel, external_id)
      DO UPDATE SET channel_display_name = COALESCE($5::text, conv.contacts.channel_display_name, EXCLUDED.channel_display_name),
        display_name = CASE WHEN conv.contacts.display_name_source = 'manual'
            THEN conv.contacts.display_name
            ELSE COALESCE($5::text, conv.contacts.display_name, EXCLUDED.display_name) END,
        phone = COALESCE(EXCLUDED.phone, conv.contacts.phone),
        owner_id = COALESCE(conv.contacts.owner_id, EXCLUDED.owner_id),
        updated_at = now() RETURNING *`,
      [chatKey, displayName, phone ? `+${phone}` : null, ownerUserId, channelName]);
    const contact = contactResult.rows[0];
    const conversationResult = await client.query(`INSERT INTO conv.conversations(channel, external_chat_id, contact_id, owner_id, channel_owner_id, waha_session)
      VALUES ('whatsapp', $1, $2, $3, $3, $4) ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET updated_at = now(),
        owner_id = COALESCE(conv.conversations.owner_id, EXCLUDED.owner_id),
        channel_owner_id = COALESCE(conv.conversations.channel_owner_id, EXCLUDED.channel_owner_id),
        waha_session = COALESCE(conv.conversations.waha_session, EXCLUDED.waha_session)
      RETURNING *`, [chatKey, contact.id, ownerUserId, inboundSession]);
    const conversation = conversationResult.rows[0];
    const inserted = await client.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, media_url, sent_at, owner_id, raw_message_type, message_summary)
      VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9, $10) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
      [externalMessageId || null, conversation.id, fromMe ? 'agent' : 'customer', parsed.content, parsed.type, parsed.mediaUrl || null, data.timestamp ? Number(data.timestamp) * 1000 : Date.now(), ownerUserId, parsed.rawType, parsed.summary]);
    if (inserted.rowCount) await client.query(`UPDATE conv.conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now() WHERE id = $1`, [conversation.id, parsed.content]);
    await client.query('COMMIT');
    // 沟通状态表单：新会话首条消息即落 duiHuaLiShi 档案（幂等；仅上线后新会话）。
    syncConversationToHistory(conversation.id, { createIfMissing: true }).catch(() => {});
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

// ── 沟通状态表单：会话 → duiHuaLiShi 历史档案同步 ──────────────────────────────
// 设计（docs/19）：1 会话 = 1 条 duiHuaLiShi 记录。原生表格/看板概览 + 点进钻取气泡看全文。
// 仅同步「功能上线后」新建的会话（不回填历史，用户已确认）。
const HISTORY_SYNC_EPOCH = '2026-08-18T16:30:00+08:00';

function mapConvChannelToHistory(channel) {
  switch (String(channel || '').toLowerCase()) {
    case 'whatsapp': return 'WHATSAPP';
    case 'website': return 'GUAN_WANG_KE_FU';
    case 'instagram': return 'INS';
    case 'facebook': return 'FACEBOOK';
    case 'email': return 'EMAIL';
    default: return null;
  }
}
function mapConvStatusToHistory(status) {
  switch (String(status || '').toLowerCase()) {
    case 'takeover': return 'TAKEOVER';
    case 'closed': return 'CLOSED';
    case 'ai': return 'AI';
    default: return 'OPEN';
  }
}

async function findDuiHuaLiShiByConversationId(conversationId) {
  const data = await twentyGraphQL(
    `query($cid: String!) {
      duiHuaLiShis(filter: { conversationId: { eq: $cid } }, first: 1) { edges { node { id } } }
    }`,
    { cid: conversationId },
  );
  return data?.duiHuaLiShis?.edges?.[0]?.node?.id || null;
}

// 从 conv.* 读取会话全量状态，组装成 duiHuaLiShi 字段（幂等 upsert 载荷）。
async function buildHistoryPayload(conversationId) {
  const workspaceSchema = await getWorkspaceSchema();
  const res = await pool.query(
    `SELECT c.id, c.channel, c.status, c.owner_id, c.last_message_at, c.last_message_preview,
            ct.display_name, ct.phone,
            wm.id AS "ownerMemberId",
            (SELECT count(*) FROM conv.messages m WHERE m.conversation_id = c.id) AS message_count,
            (SELECT bool_or(m.sender_type = 'agent') FROM conv.messages m WHERE m.conversation_id = c.id) AS has_human
       FROM conv.conversations c
       LEFT JOIN conv.contacts ct ON ct.id = c.contact_id
       LEFT JOIN ${workspaceSchema}."workspaceMember" wm
              ON wm."userId"::text = c.owner_id AND wm."deletedAt" IS NULL
      WHERE c.id = $1`,
    [conversationId],
  );
  const c = res.rows[0];
  if (!c) return null;
  const title = (c.display_name && String(c.display_name).trim())
    || (c.phone ? `+${c.phone}` : null)
    || c.id;
  return {
    name: String(title).slice(0, 255),
    channel: mapConvChannelToHistory(c.channel),
    conversationStatus: mapConvStatusToHistory(c.status),
    // 2026-08-19：负责人字段升级为 RELATION→workspaceMember（ownerMember）。
    // conv.owner_id 存的是 userId，须转成 workspaceMemberId 才能挂 RELATION；查不到则留空。
    ownerMemberId: c.ownerMemberId || null,
    lastMessageAt: c.last_message_at ? new Date(c.last_message_at).toISOString() : null,
    lastMessagePreview: c.last_message_preview ? String(c.last_message_preview).slice(0, 1000) : null,
    messageCount: Number(c.message_count) || 0,
    hasHumanMessage: Boolean(c.has_human),
    conversationId: c.id,
  };
}

// 幂等同步：已存在则更新；不存在且 createIfMissing 为真且会话为「新会话」则创建。
async function syncConversationToHistory(conversationId, { createIfMissing = false } = {}) {
  try {
    if (!conversationId || !TWENTY_API_KEY) return;
    const payload = await buildHistoryPayload(conversationId);
    if (!payload) return;
    const existingId = await findDuiHuaLiShiByConversationId(conversationId);
    if (existingId) {
      await twentyGraphQL(
        `mutation($id: UUID!, $d: DuiHuaLiShiUpdateInput!) { updateDuiHuaLiShi(id: $id, data: $d) { id } }`,
        { id: existingId, d: payload },
      );
      return;
    }
    if (!createIfMissing) return;
    // 仅同步上线后新建的会话，不回填历史。
    const convRow = await pool.query(`SELECT created_at FROM conv.conversations WHERE id = $1`, [conversationId]);
    const createdAt = convRow.rows[0]?.created_at;
    if (createdAt && new Date(createdAt).getTime() < new Date(HISTORY_SYNC_EPOCH).getTime()) return;
    await twentyGraphQL(
      `mutation($d: DuiHuaLiShiCreateInput!) { createDuiHuaLiShi(data: $d) { id } }`,
      { d: payload },
    );
  } catch (error) {
    console.error('[history-sync] failed for', conversationId, ':', error.message);
  }
}

// ── 需求二：WhatsApp 送达/已读回执 ───────────────────────────────────────────
// 状态等级用于防止 webhook 乱序把高状态覆盖回低状态；failed 是终态，不参与升级比较。
const DELIVERY_STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };

// WAHA ack → CRM 状态。ackName 优先（语义明确），缺失时退回数字 code。
// 依据 https://waha.devlike.pro/docs/how-to/events/
function mapWahaAckStatus(ackName, ackCode) {
  const name = String(ackName || '').trim().toUpperCase();
  if (name === 'ERROR') return 'failed';
  if (name === 'PENDING') return 'pending';
  if (name === 'SERVER') return 'sent';
  if (name === 'DEVICE') return 'delivered';
  if (name === 'READ' || name === 'PLAYED') return 'read';
  if (!Number.isFinite(Number(ackCode))) return null;
  const code = Number(ackCode);
  if (code === -1) return 'failed';
  if (code === 0) return 'pending';
  if (code === 1) return 'sent';
  if (code === 2) return 'delivered';
  if (code === 3 || code === 4) return 'read';
  return null;
}

// 只更新已存在的出站消息（agent/ai）；找不到就记日志，绝不新建空消息。
async function persistWhatsAppMessageAck(payload, session) {
  const data = payload.payload || payload;
  const externalMessageId = String(data.id?._serialized || data.id || '').trim();
  const ackName = String(data.ackName || '').toUpperCase();
  const ackCode = Number.isFinite(Number(data.ack)) ? Number(data.ack) : null;
  if (!externalMessageId) return { ignored: true, reason: 'missing_message_id' };

  // session 必须是已绑定的 WhatsApp 账号，避免未知来源伪造回执。
  const binding = await getActiveWhatsAppBindingBySession(session);
  if (!binding) {
    console.warn('[whatsapp-ack] reject ack for unknown/unbound session:', session);
    return { ignored: true, reason: 'unbound_session' };
  }

  const nextStatus = mapWahaAckStatus(ackName, ackCode);
  if (!nextStatus) return { ignored: true, reason: 'unsupported_ack' };

  const nextRank = DELIVERY_STATUS_RANK[nextStatus];
  // 单条 SQL 完成「查找 + 状态等级比较 + 幂等更新」，避免并发 ack 互相覆盖。
  const updated = await pool.query(
    `UPDATE conv.messages SET
       delivery_status = $2,
       delivery_status_code = $3,
       delivery_status_at = now(),
       delivered_at = CASE WHEN $2 IN ('delivered', 'read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
       read_at = CASE WHEN $2 = 'read' THEN COALESCE(read_at, now()) ELSE read_at END,
       failed_at = CASE WHEN $2 = 'failed' THEN COALESCE(failed_at, now()) ELSE failed_at END,
       status_detail = CASE WHEN $2 = 'failed' THEN COALESCE($4, status_detail) ELSE status_detail END
     WHERE external_msg_id = $1
       AND sender_type IN ('agent', 'ai')
       AND delivery_status <> 'failed'
       AND ($2 = 'failed' OR COALESCE($5::int, -1) > COALESCE((CASE delivery_status
             WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 END), -1))
     RETURNING id, conversation_id, delivery_status`,
    [externalMessageId, nextStatus, ackCode, ackName ? `WAHA ack ${ackName}` : null,
      Number.isFinite(nextRank) ? nextRank : null],
  );
  if (!updated.rowCount) {
    // 可能是：ack 早于消息落库 / 客户入站消息的 ack / 重复或倒退的 ack —— 都不是错误，只记录便于排查。
    console.warn('[whatsapp-ack] no outbound message upgraded:', externalMessageId, ackName || ackCode, 'session=', session);
    return { ignored: true, reason: 'no_upgradable_message' };
  }
  return { updated: true, messageId: updated.rows[0].id, status: updated.rows[0].delivery_status };
}

async function receiveWhatsAppWebhook(req, res) {
  res.status(200).json({ received: true });
  const event = req.body.event || req.params.event?.replace(/-/g, '.');
  // WAHA 在 webhook body 中携带 session（WAHA session 名），用于归属到对应销售。
  const session = String(req.body?.session || WAHA_SESSION);
  if (event === 'session.status') {
    const normalized = normalizeWahaSessionStatusPayload(req.body, session);
    syncWahaBindingStatus(session, normalized, 'webhook')
      .catch(error => console.error('[whatsapp-status] webhook failed:', error.message));
    return;
  }
  // 需求二：ack 必须单独处理，绝不能当普通文本消息落库。
  if (event === 'message.ack') {
    persistWhatsAppMessageAck(req.body, session)
      .catch(error => console.error('[whatsapp-ack] webhook failed:', error.message));
    return;
  }
  // WAHA 投递 `message`（入站+出站）/ `message.any`；只处理文本类消息事件。
  if (event !== 'message' && event !== 'message.any') return;
  persistWhatsAppMessage(req.body, session).catch(error => console.error('[whatsapp] webhook failed:', error.message));
}
app.post('/api/whatsapp/webhook', receiveWhatsAppWebhook);
app.post('/api/whatsapp/webhook/:event', receiveWhatsAppWebhook);

// 官网客服（AI 客服服务的 website 渠道）访客消息 → CRM 会话工作台。
// AI 服务在存下访客消息后转发到此端点；middleware 按 channel='website' 落入同一 conv 库。
// 官网消息发送方映射：ai-service 的 visitor/ai/agent → conv 库 sender_type。
// agent 是销售在 CRM 回复后由 ai-service 广播回来的回声，CRM 已自行落库，避免重复入库。
const WEBSITE_SENDER_MAP = { visitor: 'customer', customer: 'customer', ai: 'ai', agent: 'agent' };

// ===== 需求三（2026-08-18）官网访客 IP 地域与时区 =====
// 真实客户端 IP 只允许从可信边界取，绝不信任请求体里的 clientIp（浏览器可伪造）。
// 优先级：Cloudflare 边缘头(CF-Connecting-IP) -> X-Forwarded-For 首段(最接近客户端) ->
//          X-Real-IP(可信反代) -> middleware socket 直连地址。
// 注意：X-Real-IP 可能被内网网关/端口映射写成容器 IP（如 172.18.0.11），必须排在 XFF 之后，
//       否则真实公网 IP 会被内网 IP 顶掉，地域解析永远失败。
function extractClientIp(req) {
  if (!req) return null;
  const headers = req.headers || {};
  const candidates = [];
  if (headers['cf-connecting-ip']) candidates.push(String(headers['cf-connecting-ip']).trim());
  if (headers['x-forwarded-for']) {
    // 只取 XFF 首段：cloudflared/Docker 转发会追加中间跳板 IP（172.18.0.x），首段才是客户端公网 IP。
    const first = String(headers['x-forwarded-for']).split(',')[0].trim();
    if (first) candidates.push(first);
  }
  if (headers['x-real-ip']) candidates.push(String(headers['x-real-ip']).trim());
  if (req.socket && req.socket.remoteAddress) candidates.push(req.socket.remoteAddress);
  for (const raw of candidates) {
    const ip = raw.replace(/^::ffff:/, '').trim();
    if (ip && ip !== '::1' && ip.toLowerCase() !== 'localhost') return ip;
  }
  return null;
}

// 是否可公开解析地域的公网 IP：拒绝私网/回环/链路本地/容器网段，避免把服务器或内网地址当客户位置。
function isPublicIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  let v = ip.trim();
  if (v === '::1' || v.toLowerCase() === 'localhost') return false;
  if (v.startsWith('::ffff:')) v = v.slice(7);
  if (v.includes(':')) {
    // 非映射 IPv6：ULA(fc00::/7) 与链路本地(fe80::/10) 视为不可公开解析
    const p = v.toLowerCase();
    if (p.startsWith('fc') || p.startsWith('fd') || p.startsWith('fe8') || p.startsWith('fe9') ||
        p.startsWith('fea') || p.startsWith('feb')) return false;
    return true;
  }
  const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255 || Number.isNaN(n))) return false;
  const [a, b] = o;
  if (a === 0) return false;                               // 0.0.0.0/8
  if (a === 10) return false;                              // 私网 10/8
  if (a === 127) return false;                             // 回环
  if (a === 169 && b === 254) return false;                // 链路本地 169.254/16
  if (a === 100 && b >= 64 && b <= 127) return false;      // CGNAT 100.64/10
  if (a === 172 && b >= 16 && b <= 31) return false;       // 私网 172.16/12
  if (a === 192 && b === 168) return false;                // 私网 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return false;   // 测试网 198.18/15
  return true;
}

function cleanWebsiteMetaText(value, maxLength = 1000) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function firstWebsiteMetaString(...values) {
  for (const value of values) {
    const clean = cleanWebsiteMetaText(value);
    if (clean) return clean;
  }
  return null;
}

function parseUtmFromUrl(pageUrl) {
  if (!pageUrl) return {};
  try {
    const url = new URL(pageUrl);
    return {
      source: cleanWebsiteMetaText(url.searchParams.get('utm_source'), 255),
      medium: cleanWebsiteMetaText(url.searchParams.get('utm_medium'), 255),
      campaign: cleanWebsiteMetaText(url.searchParams.get('utm_campaign'), 255),
      term: cleanWebsiteMetaText(url.searchParams.get('utm_term'), 255),
      content: cleanWebsiteMetaText(url.searchParams.get('utm_content'), 255),
    };
  } catch {
    return {};
  }
}

function extractWebsiteContext(body = {}) {
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  const pageUrl = firstWebsiteMetaString(body.pageUrl, body.pageURL, body.landingPageUrl, metadata.pageUrl, metadata.landingPageUrl);
  const referrer = firstWebsiteMetaString(body.referrer, body.referer, body.referrerUrl, metadata.referrer, metadata.referer);
  const fromUrl = parseUtmFromUrl(pageUrl);
  return {
    pageUrl,
    referrer,
    utmSource: firstWebsiteMetaString(body.utm_source, body.utmSource, utm.source, utm.utm_source, metadata.utm_source, metadata.utmSource, fromUrl.source),
    utmMedium: firstWebsiteMetaString(body.utm_medium, body.utmMedium, utm.medium, utm.utm_medium, metadata.utm_medium, metadata.utmMedium, fromUrl.medium),
    utmCampaign: firstWebsiteMetaString(body.utm_campaign, body.utmCampaign, utm.campaign, utm.utm_campaign, metadata.utm_campaign, metadata.utmCampaign, fromUrl.campaign),
    utmTerm: firstWebsiteMetaString(body.utm_term, body.utmTerm, utm.term, utm.utm_term, metadata.utm_term, metadata.utmTerm, fromUrl.term),
    utmContent: firstWebsiteMetaString(body.utm_content, body.utmContent, utm.content, utm.utm_content, metadata.utm_content, metadata.utmContent, fromUrl.content),
  };
}

function extractTrustedWebsiteClientIp(req) {
  const headers = req?.headers || {};
  const body = req?.body && typeof req.body === 'object' ? req.body : {};
  const candidates = [];
  if (headers['cf-connecting-ip']) candidates.push(String(headers['cf-connecting-ip']).trim());
  if (headers['x-original-client-ip']) candidates.push(String(headers['x-original-client-ip']).trim());
  if (headers['x-forwarded-for']) {
    candidates.push(...String(headers['x-forwarded-for']).split(',').map((part) => part.trim()));
  }
  if (headers['x-real-ip']) candidates.push(String(headers['x-real-ip']).trim());
  // 仅 website webhook 通过密钥校验后调用本函数；请求体 IP 只作为 AI 服务内部转发兜底。
  for (const key of ['clientIp', 'clientIP', 'ip', 'visitorIp', 'visitorIP']) {
    if (body[key]) candidates.push(String(body[key]).trim());
  }
  if (req?.socket?.remoteAddress) candidates.push(req.socket.remoteAddress);
  for (const raw of candidates) {
    const ip = String(raw || '').replace(/^::ffff:/, '').trim();
    if (isPublicIp(ip)) return ip;
  }
  return null;
}

// IP→Geo 缓存（含 null 结果），避免每条消息都打外部服务。TTL 24h。
const _geoCache = new Map();
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// 解析 IP 地域。私网/回环/空 -> null（绝不调用外部服务，也不伪造城市）。
// 仅当配置了已批准的外部服务（GEOIP_PROVIDER_URL）才联网解析；否则返回 null，前端显示「未知」。
// 任何失败都返回 null，不阻断官网消息入库。
async function resolveGeoByIp(ip) {
  const clean = (ip || '').toString().replace(/^::ffff:/, '').trim();
  if (!isPublicIp(clean)) return null;
  const now = Date.now();
  const cached = _geoCache.get(clean);
  if (cached && now - cached.t < GEO_CACHE_TTL_MS) return cached.v;
  let result = null;
  // 默认内置 ip-api.com 免费 HTTP 接口（24h 缓存；免费版 45 req/min，官网访客量远低于此）。
  // 若需切换服务商，用 GEOIP_PROVIDER_URL / GEOIP_PROVIDER_NAME 环境变量覆盖。
  const providerUrl = process.env.GEOIP_PROVIDER_URL || 'http://ip-api.com/json';
  const providerName = process.env.GEOIP_PROVIDER_NAME || 'ip-api';
  // 首次 800ms 超时在 macmini 网络下偏紧（实测偶发超 1s），放宽到 3s；失败再试一次。
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const sep = providerUrl.includes('?') ? '&' : '?';
      const targetUrl = providerName === 'ip-api' && /\/json\/?$/.test(providerUrl)
        ? `${providerUrl.replace(/\/$/, '')}/${encodeURIComponent(clean)}`
        : `${providerUrl}${sep}ip=${encodeURIComponent(clean)}`;
      const resp = await fetch(targetUrl, {
        signal: controller.signal, headers: { accept: 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        if (data) {
          result = {
            countryCode: data.countryCode || data.country_code || data.country?.iso_code || null,
            countryName: data.countryName || data.country_name || data.country || null,
            region: data.region || data.regionName || null,
            city: data.city || null,
            timezone: data.timezone || data.time_zone || null,
            latitude: data.latitude ?? data.lat ?? null,
            longitude: data.longitude ?? data.lon ?? data.lng ?? null,
            source: providerName,
          };
        }
      }
    } catch (err) {
      if (attempt === 1) console.error('[geo] resolve failed, skip:', err.message);
    } finally {
      clearTimeout(timer);
    }
  }
  _geoCache.set(clean, { v: result, t: now });
  return result;
}

async function persistWebsiteMessage(body, clientIp) {
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
  // 渠道原始名：官网表单/widget 传来的真实姓名才算渠道名；没有就用「网站访客 xxxxxx」兜底。
  const channelName = String(body.displayName || '').trim() || null;
  const displayName = channelName || `网站访客 ${visitorId.slice(-6) || sessionId.slice(-6)}`;
  // 官网访客发的附件：ai-service 那边已经把 widget 上传的文件转成同一套
  // {url,title,fileType,contentType,sizeBytes} 结构透传过来了，跟坐席发附件复用同一套归一化。
  const attachments = normalizeOutboundAttachments(body.attachments);
  const primaryAttachment = attachments[0] || null;
  const contentType = primaryAttachment ? fileMessageType({ mimetype: primaryAttachment.contentType || '' }) : 'text';
  const mediaUrl = primaryAttachment ? primaryAttachment.url : null;
  const websiteContext = extractWebsiteContext(body);
  const storedClientIp = isPublicIp(clientIp) ? clientIp : null;
  // 需求三：解析官网访客真实 IP 地域（私网/回环直接返回 null，不阻断入库）。
  const geo = (await resolveGeoByIp(storedClientIp)) || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contactResult = await client.query(`INSERT INTO conv.contacts(
        channel, external_id, display_name, channel_display_name,
        ip_address, geo_country_code, geo_country_name, geo_region, geo_city,
        geo_timezone, geo_latitude, geo_longitude, geo_source, geo_updated_at,
        landing_page_url, referrer_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content)
      VALUES ('website', $1, $2, $2, $4, $5, $6, $7, $8, $9, $10, $11, $12::text,
        CASE WHEN $12::text IS NOT NULL THEN now() ELSE NULL END,
        $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT(channel, external_id)
      DO UPDATE SET
        channel_display_name = COALESCE($3::text, conv.contacts.channel_display_name, EXCLUDED.channel_display_name),
        display_name = CASE WHEN conv.contacts.display_name_source = 'manual'
            THEN conv.contacts.display_name
            ELSE COALESCE($3::text, conv.contacts.display_name, EXCLUDED.display_name) END,
        -- IP/Geo：仅在新值非空时覆盖（IP 通常稳定不回退；地理解析可能为空则保留旧值）
        ip_address = COALESCE($4::inet, conv.contacts.ip_address),
        geo_country_code = COALESCE($5, conv.contacts.geo_country_code),
        geo_country_name = COALESCE($6, conv.contacts.geo_country_name),
        geo_region = COALESCE($7, conv.contacts.geo_region),
        geo_city = COALESCE($8, conv.contacts.geo_city),
        geo_timezone = COALESCE($9, conv.contacts.geo_timezone),
        geo_latitude = COALESCE($10, conv.contacts.geo_latitude),
        geo_longitude = COALESCE($11, conv.contacts.geo_longitude),
        geo_source = COALESCE($12::text, conv.contacts.geo_source),
        geo_updated_at = CASE WHEN $12::text IS NOT NULL THEN now() ELSE conv.contacts.geo_updated_at END,
        landing_page_url = COALESCE($13, conv.contacts.landing_page_url),
        referrer_url = COALESCE($14, conv.contacts.referrer_url),
        utm_source = COALESCE($15, conv.contacts.utm_source),
        utm_medium = COALESCE($16, conv.contacts.utm_medium),
        utm_campaign = COALESCE($17, conv.contacts.utm_campaign),
        utm_term = COALESCE($18, conv.contacts.utm_term),
        utm_content = COALESCE($19, conv.contacts.utm_content),
        updated_at = now() RETURNING *`,
      [visitorId || sessionId, displayName, channelName,
       storedClientIp,
       geo?.countryCode ?? null, geo?.countryName ?? null, geo?.region ?? null, geo?.city ?? null,
       geo?.timezone ?? null, geo?.latitude ?? null, geo?.longitude ?? null, geo?.source ?? null,
       websiteContext.pageUrl, websiteContext.referrer, websiteContext.utmSource, websiteContext.utmMedium,
       websiteContext.utmCampaign, websiteContext.utmTerm, websiteContext.utmContent]);
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
    // 官网渠道「已读」：访客发下一条消息 = 已看到之前的我方回复 → 把该会话所有出站消息（agent/ai）
    // 标记为 read（read_at 首次写入后保持）。只升不回退；消息 API 会把 deliveryStatus 带给前端展示。
    if (inserted.rowCount && senderType === 'customer') {
      await client.query(
        `UPDATE conv.messages SET delivery_status = 'read', read_at = COALESCE(read_at, now())
          WHERE conversation_id = $1 AND sender_type IN ('agent', 'ai') AND delivery_status <> 'read'`,
        [conversation.id],
      );
    }
    await client.query('COMMIT');
    // 沟通状态表单：官网客服新会话落 duiHuaLiShi 档案（幂等；仅上线后新会话）。
    syncConversationToHistory(conversation.id, { createIfMissing: true }).catch(() => {});
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

// 生成线索id：XS-<YYYYMMDDHHMMSS>（年月日时分秒）。同一秒内极端并发时加 2 位随机后缀防重。
function generateLeadId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let id = 'XS-' + ts;
  // 同一秒内的并发去重兜底：后缀 2 位 base36
  if (generateLeadId._seen && generateLeadId._seen.has(ts)) {
    id += '-' + crypto.randomBytes(1).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
  }
  generateLeadId._seen = generateLeadId._seen || new Set();
  generateLeadId._seen.add(ts);
  // 仅保留最近 60 秒的标记，避免内存无限增长
  if (generateLeadId._seen.size > 120) generateLeadId._seen = new Set([ts]);
  return id;
}

async function createWebsiteFormOpportunity(body, req) {
  const { opportunity, raw } = normalizeWebsiteFormPayload(body);

  // 线索id：CRM 自动生成（XS-<年月日时分秒>，如 XS-20260817185541），同时作为内部归类键 customerIdentityKey
  const leadNo = generateLeadId();
  const customerIdentityKey = leadNo;

  // 线索名称兜底：normalize 已按 公司→联系人→邮箱→电话 取身份；四者全空时用线索编号，保证列表首列绝不空白。
  if (!String(opportunity.name || '').trim()) {
    opportunity.name = leadNo;
  }

  // 建线索（标准字段走 GraphQL；leadNo/customerIdentityKey 为自定义列，建完用 DB 补齐）
  const result = await twentyGraphQL(
    'mutation($data: OpportunityCreateInput!){ createOpportunity(data: $data){ id name } }',
    { data: opportunity },
    TWENTY_API_KEY,
  );
  const created = result?.createOpportunity;
  if (!created?.id) throw new Error('createOpportunity returned empty id');
  const opportunityId = created.id;

  // 落库自定义字段 + 表单 name -> opportunity「联系人姓名」暂存列（不提前建 Person）
  let personId = null; // 预留：转客户时由 upsertPersonFromOpportunity 生成 Person 并回填
  const schema = await getWorkspaceSchema();
  const client = await pool.connect();

  // ── 关键且独立：线索id + 归类键先落库 ─────────────────────────
  // 单独一个事务，先于任何「建公司 / syncGroupCode」逻辑；即使后续非关键步骤
  // 整段失败，已提交的线索id 也绝不会被回滚。
  // （DB 触发器 opportunity_leadno_default_trg 在 INSERT 时已兜底写 leadNo，此为二级保险。）
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ${schema}.opportunity
       SET "leadNo" = $2, "customerIdentityKey" = $3, "updatedAt" = now()
       WHERE id = $1`,
      [opportunityId, leadNo, customerIdentityKey],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[website-form] leadNo write failed (trigger still backs up):', err.message);
  }

  // ── 非关键 enrichment：syncGroupCode + 公司关联 + 联系人姓名 ──────────
  // best-effort，失败仅告警，绝不连累上面的线索id。
  try {
    await client.query('BEGIN');

    // 确保线索有 syncGroupCode，用于三表（线索/客户/项目）关联
    let syncGroupCode = null;
    const oppRes = await client.query(
      `SELECT "syncGroupCode" FROM ${schema}.opportunity WHERE id = $1`,
      [opportunityId],
    );
    syncGroupCode = oppRes.rows[0]?.syncGroupCode || null;
    if (!syncGroupCode) {
      const codeRes = await client.query(
        `UPDATE ${schema}.opportunity SET "syncGroupCode" = conv.next_sync_group_code("createdAt"), "updatedAt" = now() WHERE id = $1 RETURNING "syncGroupCode"`,
        [opportunityId],
      );
      syncGroupCode = codeRes.rows[0]?.syncGroupCode || null;
    }

    // 公司：表单带了公司名时，建/关联 Company（去重：findCompanyByExactName 按名匹配，无则新建），统一收口进公司表
    let companyId = null;
    const companyName = raw.company;
    if (companyName) {
      try {
        const existing = await findCompanyByExactName(companyName, TWENTY_API_KEY);
        const company = existing || await createCompanyByName(companyName, TWENTY_API_KEY, null);
        companyId = company?.id || null;
      } catch (err) {
        console.error('[website-form] create/link company failed:', err.message);
      }
    }

    // 联系人姓名：表单 name 收口到 opportunity 的「联系人姓名」暂存列，不提前建 Person。
    // Person（客户主数据）在"转客户"时由 upsertPersonFromOpportunity 读取该列生成，并回填 pointOfContactId。
    const contactName = raw.name;

    await client.query(
      `UPDATE ${schema}.opportunity
       SET "lianXiRenXingMing" = COALESCE($2, "lianXiRenXingMing"),
           "companyId" = COALESCE("companyId", $3),
           "updatedAt" = now()
       WHERE id = $1`,
      [opportunityId, contactName || null, companyId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[website-form] post-create enrichment (non-critical) failed:', err.message);
  } finally {
    client.release();
  }

  await recordAuditEvent('website_form.created_opportunity', {
    channel: 'website_form',
    requestSummary: req ? {
      origin: req.headers.origin || '',
      referer: req.headers.referer || '',
      userAgent: req.headers['user-agent'] || '',
    } : undefined,
    payload: {
      opportunityId,
      leadNo,
      customerIdentityKey,
      contactName: raw.name || null,
      fields: Object.keys(raw).filter((key) => raw[key]),
      source: opportunity.keHuLaiYuan,
      stage: opportunity.stage,
    },
  });
  return { opportunityId, name: created.name, source: opportunity.keHuLaiYuan, stage: opportunity.stage, leadNo, customerIdentityKey, personId };
}

app.post('/api/website/form', async (req, res) => {
  if (!requireWebsiteIngressSecret(req, res, 'website-form')) return;
  try {
    const created = await createWebsiteFormOpportunity(req.body, req);
    res.status(201).json({ received: true, ...created });
  } catch (error) {
    console.error('[website-form] create opportunity failed:', error.message);
    res.status(502).json({ error: 'website form ingest failed', detail: error.message });
  }
});

app.post('/api/website/webhook', async (req, res) => {
  if (!requireWebsiteIngressSecret(req, res, 'website-webhook')) return;
  try {
    if (isWebsiteFormPayload(req.body)) {
      const created = await createWebsiteFormOpportunity(req.body, req);
      return res.status(201).json({ received: true, ...created });
    }
    await persistWebsiteMessage(req.body, extractTrustedWebsiteClientIp(req));
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
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name, channel_display_name)
      VALUES ('instagram', $1, $2, $2) ON CONFLICT(channel, external_id)
      DO UPDATE SET channel_display_name = COALESCE(conv.contacts.channel_display_name, EXCLUDED.channel_display_name),
        updated_at = now() RETURNING *`, [senderId, `Instagram ${senderId.slice(-6)}`]);
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
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name, channel_display_name)
      VALUES ('facebook', $1, $2, $2) ON CONFLICT(channel, external_id)
      DO UPDATE SET channel_display_name = COALESCE(conv.contacts.channel_display_name, EXCLUDED.channel_display_name),
        updated_at = now() RETURNING *`, [counterpartyId, `Facebook ${counterpartyId.slice(-6)}`]);
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

// 官网由销售团队共享已读；WhatsApp 按绑定账号所属用户独立计算。
function conversationReadScopeKey(viewer, channel) {
  if (channel === 'website') return `website:workspace:${viewer.workspaceId}`;
  return `${channel}:user:${viewer.userId}`;
}

app.get('/api/conversations', async (req, res) => {
  try {
    // 生效范围解析：会话级覆盖(c.ai_enabled) → 渠道设置(cs.ai_enabled) → 官网默认开
    const scheduleActive = aiScheduleActiveExpression('cs');
    const viewer = await resolveConversationViewer(req);
    if (!viewer) return res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
    const workspaceSchema = await getWorkspaceSchema();
    const historyView = String(req.query?.view || req.query?.scope || '').trim() === 'history';
    const visibility = conversationVisibilityWhere(viewer, 'c', 1, {
      workspaceSchema,
      allowPrivilegedAllChannels: historyView,
    });
    const listParams = [...visibility.params, viewer.workspaceId, viewer.userId];
    const readScopeSql = `(CASE WHEN c.channel = 'website'
      THEN 'website:workspace:' || $3::text
      ELSE c.channel || ':user:' || $4::text END)`;
    const viewerRole = viewer.isBoss ? "'boss'" : `'${viewer.role || 'sales'}'`;
    // AI 模式（ai_enabled 为真）下：仅接管自己的会话可回复；AI 关闭时：非关闭会话销售均可直接回复，无需先接管。
    const aiEnabledExpr = `(COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website'))`;
    const canReplyExpression = viewer.isBoss && !viewer.isSupervisor
      ? 'false'
      : `((${aiEnabledExpr} AND c.status = 'takeover' AND c.agent_id = $1) OR (NOT ${aiEnabledExpr} AND c.status <> 'closed'))`;
    const canTakeoverExpression = viewer.isBoss && !viewer.isSupervisor ? 'false' : `(c.status = 'open')`;
    const canTransferExpression = viewer.isSupervisor
      ? `(c.channel = 'website' AND c.status = 'takeover' AND c.agent_id IS NOT NULL AND c.agent_id <> $1 AND pending_handoff.id IS NULL)`
      : 'false';
    const canReturnExpression = viewer.isSupervisor
      ? `(c.channel = 'website' AND c.status = 'takeover' AND c.agent_id = $1 AND latest_sales_handoff.id IS NOT NULL)`
      : 'false';
    const assignedToMeExpression = !viewer.isBoss ? `(c.agent_id = $1)` : 'false';
    const takenBeforeExpression = !viewer.isBoss ? `EXISTS (
      SELECT 1 FROM conv.conversation_participants cp
      WHERE cp.conversation_id = c.id AND cp.workspace_member_id = $1
    )` : 'false';
    const result = await pool.query(`SELECT c.id, c.channel, c.status, c.agent_id AS "agentId",
    NULLIF(CONCAT_WS(' ', current_agent."nameFirstName", current_agent."nameLastName"), '') AS "currentAgentName",
    c.last_message_preview AS "lastMessage", c.last_message_at AS "lastMessageAt", c.lead_draft AS "leadDraft", c.taken_over_at AS "takenOverAt",
    COALESCE(unread.unread_count, 0)::int AS "unreadCount",
    CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object(
      'name', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p."nameFirstName", p."nameLastName")), ''), ''),
      'leadNo', COALESCE(o."leadNo"::text, ''),
      'company', COALESCE(co.name, p."gongSiMingCheng", ''),
      'companyId', COALESCE(o."companyId"::text, ''),
      'phone', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', o."whatsappPrimaryPhoneCallingCode", o."whatsappPrimaryPhoneNumber")), ''), ct.phone, ''),
      'email', COALESCE(o."youXiangPrimaryEmail", ct.email, ''),
      'country', COALESCE(o."guoJiaDiQuAddressCountry", p."guoJiaDiQuAddressCountry", ''),
      'source', COALESCE(o."keHuLaiYuan"::text, ''),
      'companyType', COALESCE(o."gongSiLeiXing"::text, p."keHuLeiXing"::text, ''),
      'stage', COALESCE(o.stage::text, ''),
      'product', COALESCE(o."keHuXuQiuChanPin", p."keHuXuQiuChanPin", ''),
      'note', COALESCE(o."guanWangBeiZhuMarkdown", o."genJinJiLuMarkdown", ''),
      'ownerId', COALESCE(o."ownerId"::text, ''),
      'collaboratorId', COALESCE(o."xieBanRenId"::text, '')
    ) END AS "crmLeadDraft",
    json_build_object(
      'enabled', COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website'),
      'scheduleActive', ${scheduleActive},
      'inTakeoverWindow', (COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AND (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND ${scheduleActive}),
      'canTakeover', (COALESCE(c.ai_enabled, cs.ai_enabled, c.channel = 'website') AND (c.ai_takeover_until IS NULL OR c.ai_takeover_until > now()) AND c.status NOT IN ('takeover', 'closed'))
    ) AS "aiControl",
    json_build_object(
      'viewerRole', ${viewerRole},
      'isSupervisor', ${viewer.isSupervisor ? 'true' : 'false'},
      'canView', true,
      'canReply', ${canReplyExpression},
      'canTakeover', ${canTakeoverExpression},
      'canTransferSales', ${canTransferExpression},
      'canReturnSales', ${canReturnExpression},
      'returnAgentId', CASE WHEN ${canReturnExpression} THEN latest_sales_handoff.from_agent_id ELSE NULL END,
      'returnAgentName', CASE WHEN ${canReturnExpression} THEN latest_sales_handoff.from_agent_name ELSE NULL END,
      'canRespondHandoff', (pending_handoff.id IS NOT NULL AND pending_handoff.from_agent_id = $1),
      'isAssignedToMe', ${assignedToMeExpression},
      'hasTakenOverBefore', ${takenBeforeExpression}
    ) AS permissions,
    CASE WHEN pending_handoff.id IS NULL THEN NULL ELSE json_build_object(
      'status', pending_handoff.status,
      'id', pending_handoff.id,
      'fromAgentId', pending_handoff.from_agent_id,
      'decision', pending_handoff.decision,
      'requestedAt', pending_handoff.requested_at,
      'effectiveAt', pending_handoff.effective_at,
      'requestedByName', pending_handoff.requested_by_name
    ) END AS handoff,
    CASE WHEN return_notice.id IS NULL THEN NULL ELSE json_build_object(
      'id', return_notice.id,
      'message', return_notice.message,
      'createdAt', return_notice.created_at
    ) END AS "returnNotice",
    json_build_object('id', ct.id,
      -- 需求一：最终显示名由后端算好（人工名优先 → 渠道原始名 → 手机号/邮箱/外部 ID 兜底），前端不再自行拼接
      'name', COALESCE(NULLIF(ct.display_name, ''), NULLIF(ct.channel_display_name, ''), NULLIF(ct.phone, ''), NULLIF(ct.email, ''), ct.external_id, ''),
      'nameSource', COALESCE(ct.display_name_source, 'channel'),
      'channelName', COALESCE(ct.channel_display_name, ''),
      'phone', ct.phone, 'email', ct.email, 'twentyPersonId', ct.twenty_person_id, 'twentyOpportunityId', ct.twenty_opportunity_id,
      -- 需求三：官网访客地域（IP 仅审计用，列表不展示完整 IP；WhatsApp 等不填这些字段 -> 空串）
      'country', COALESCE(ct.geo_country_name, ct.geo_country_code, ''),
      'region', COALESCE(ct.geo_region, ''),
      'city', COALESCE(ct.geo_city, ''),
      'timezone', COALESCE(ct.geo_timezone, ''),
      'ip', COALESCE(host(ct.ip_address), ''),
      'geoSource', COALESCE(ct.geo_source, ''),
      'pageUrl', COALESCE(ct.landing_page_url, ''),
      'referrer', COALESCE(ct.referrer_url, ''),
      'utmSource', COALESCE(ct.utm_source, ''),
      'utmMedium', COALESCE(ct.utm_medium, ''),
      'utmCampaign', COALESCE(ct.utm_campaign, ''),
      'utmTerm', COALESCE(ct.utm_term, ''),
      'utmContent', COALESCE(ct.utm_content, ''),
      'filedStatus', CASE WHEN ct.twenty_opportunity_id IS NOT NULL OR ct.twenty_person_id IS NOT NULL THEN 'lead' ELSE 'unfiled' END) AS contact
    FROM conv.conversations c JOIN conv.contacts ct ON ct.id = c.contact_id
    LEFT JOIN conv.channel_settings cs ON cs.channel = c.channel
    LEFT JOIN ${workspaceSchema}."workspaceMember" current_agent
      ON current_agent.id::text = c.agent_id AND current_agent."deletedAt" IS NULL
    LEFT JOIN ${workspaceSchema}.opportunity o ON o.id::text = ct.twenty_opportunity_id AND o."deletedAt" IS NULL
    LEFT JOIN ${workspaceSchema}.person p ON p."deletedAt" IS NULL AND p.id = COALESCE(o."pointOfContactId", o."linkedPersonId")
    LEFT JOIN ${workspaceSchema}.company co ON co."deletedAt" IS NULL AND co.id = o."companyId"
    LEFT JOIN LATERAL (
      SELECT r.id, r.status, r.from_agent_id, r.decision, r.requested_at, r.effective_at,
             NULLIF(CONCAT_WS(' ', wm."nameFirstName", wm."nameLastName"), '') AS requested_by_name
        FROM conv.conversation_handoff_requests r
        LEFT JOIN ${workspaceSchema}."workspaceMember" wm
          ON wm.id::text = r.requested_by_member_id AND wm."deletedAt" IS NULL
       WHERE r.conversation_id = c.id AND r.status = 'pending'
       ORDER BY r.requested_at DESC LIMIT 1
    ) pending_handoff ON TRUE
    LEFT JOIN LATERAL (
      SELECT n.id, n.message, n.created_at
        FROM conv.conversation_handoff_notices n
       WHERE n.conversation_id = c.id
         AND n.recipient_member_id = $1
         AND n.seen_at IS NULL
       ORDER BY n.created_at DESC
       LIMIT 1
    ) return_notice ON TRUE
    LEFT JOIN LATERAL (
      SELECT r.id, r.from_agent_id,
             NULLIF(CONCAT_WS(' ', wm."nameFirstName", wm."nameLastName"), '') AS from_agent_name
        FROM conv.conversation_handoff_requests r
        LEFT JOIN ${workspaceSchema}."workspaceMember" wm
          ON wm.id::text = r.from_agent_id AND wm."deletedAt" IS NULL
       WHERE r.conversation_id = c.id
         AND r.status = 'completed'
         AND r.requested_by_member_id = $1
         AND c.agent_id = $1
       ORDER BY r.completed_at DESC NULLS LAST, r.requested_at DESC
       LIMIT 1
    ) latest_sales_handoff ON TRUE
    LEFT JOIN conv.conversation_read_states read_state
      ON read_state.conversation_id = c.id AND read_state.scope_key = ${readScopeSql}
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS unread_count
      FROM conv.messages unread_message
      WHERE unread_message.conversation_id = c.id
        AND unread_message.sender_type = 'customer'
        AND (read_state.last_read_at IS NULL OR unread_message.sent_at > read_state.last_read_at)
    ) unread ON TRUE
    WHERE ${visibility.sql}
    ORDER BY c.last_message_at DESC NULLS LAST`, listParams);
    res.json(result.rows);
  } catch (error) {
    console.error('[conversations] list failed:', error.message);
    res.status(502).json({ error: '无法加载会话', detail: error.message });
  }
});

app.post('/api/conversations/:id/read', async (req, res) => {
  const access = await requireConversationAccess(req, res);
  if (!access) return;
  const { viewer, conversation } = access;
  const scopeKey = conversationReadScopeKey(viewer, conversation.channel);
  try {
    const latest = await pool.query(
      `SELECT id, now() AS "readAt"
         FROM conv.messages
        WHERE conversation_id = $1
          AND sender_type = 'customer'
          AND sent_at <= now()
        ORDER BY sent_at DESC
        LIMIT 1`,
      [conversation.id],
    );
    const message = latest.rows[0];
    if (!message) return res.json({ conversationId: conversation.id, scopeKey, marked: false });
    await pool.query(
      `INSERT INTO conv.conversation_read_states(
         conversation_id, scope_key, last_read_at, last_read_message_id, read_by_member_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conversation_id, scope_key) DO UPDATE SET
         last_read_at = EXCLUDED.last_read_at,
         last_read_message_id = EXCLUDED.last_read_message_id,
         read_by_member_id = EXCLUDED.read_by_member_id,
         updated_at = now()
       WHERE conv.conversation_read_states.last_read_at IS NULL
          OR conv.conversation_read_states.last_read_at < EXCLUDED.last_read_at`,
      [conversation.id, scopeKey, message.readAt, message.id, viewer.workspaceMemberId],
    );
    res.json({ conversationId: conversation.id, scopeKey, marked: true, readThroughMessageId: message.id, readThroughAt: message.sentAt });
  } catch (error) {
    console.error('[conversations] mark read failed:', error.message);
    res.status(502).json({ error: '标记已读失败' });
  }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  const historyView = String(req.query?.view || req.query?.scope || '').trim() === 'history';
  const access = await requireConversationAccess(req, res, { historyView });
  if (!access) return;
  const workspaceSchema = await getWorkspaceSchema();
  const result = await pool.query(`SELECT m.id, m.sender_type AS "senderType", m.sender_role AS "senderRole", m.content, m.content_type AS "contentType", m.media_url AS "mediaUrl", m.subject, m.attachments, m.sent_at AS "sentAt",
      m.raw_message_type AS "rawMessageType", m.message_summary AS "messageSummary",
      CASE WHEN m.sender_type = 'agent' THEN COALESCE(
        NULLIF(CONCAT_WS(' ', sender_member."nameFirstName", sender_member."nameLastName"), ''),
        NULLIF(CONCAT_WS(' ', owner_member."nameFirstName", owner_member."nameLastName"), ''),
        NULLIF((SELECT ae.actor_name
                  FROM conv.audit_events ae
                 WHERE ae.message_id = m.id
                   AND ae.event_type IN ('message.sent', 'message.send_failed')
                 ORDER BY ae.created_at DESC
                 LIMIT 1), ''),
        '未识别成员'
      ) ELSE NULL END AS "senderName",
      -- 需求二：出站消息送达状态（pending/sent/delivered/read/failed）
      delivery_status AS "deliveryStatus", delivery_status_at AS "deliveryStatusAt",
      delivered_at AS "deliveredAt", read_at AS "readAt", failed_at AS "failedAt", status_detail AS "statusDetail"
    FROM conv.messages m
    JOIN conv.conversations c ON c.id = m.conversation_id
    LEFT JOIN ${workspaceSchema}."workspaceMember" sender_member
      ON sender_member."userId"::text = m.owner_id AND sender_member."deletedAt" IS NULL
    LEFT JOIN ${workspaceSchema}."workspaceMember" owner_member
      ON owner_member.id::text = c.agent_id AND owner_member."deletedAt" IS NULL
    WHERE m.conversation_id = $1 ORDER BY m.sent_at`, [req.params.id]);
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
  const workspaceSchema = await getWorkspaceSchema();
  const visibility = conversationVisibilityWhere(viewer, 'c', params.length + 1, { workspaceSchema });
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
  const binding = await getCurrentUserWhatsAppBinding(authenticated.userId);
  if (!binding?.provider_session) {
    throw createHttpError('当前 CRM 账号还没有绑定 WhatsApp，请先到“设置 -> 账户 -> 渠道”完成绑定', 403);
  }

  const sessionName = binding.provider_session;
  let session;
  try {
    session = normalizeWahaSession(await getWahaSession(sessionName));
  } catch (error) {
    if (isWahaSessionNotFound(error)) {
      throw createHttpError('当前绑定的 WhatsApp 会话不存在或已失效，请先到“设置 -> 账户 -> 渠道”重新绑定', 409);
    }
    throw error;
  }
  if (!session.connected) throw createHttpError('WhatsApp 当前未连接，请先在设置中完成绑定', 409);
  if (phoneFromJid(session.accountId) === phone) throw createHttpError('不能向当前绑定的 WhatsApp 号码发起会话', 400);

  const checkResponse = await fetchWaha(
    `/api/contacts/check-exists?session=${encodeURIComponent(sessionName)}&phone=${encodeURIComponent(phone)}`,
  );
  const checked = await checkResponse.json().catch(() => ({}));
  if (!checkResponse.ok) throw createHttpError(checked.message || 'WhatsApp 号码校验失败', 502, checked);
  if (!checked.numberExists || !checked.chatId) {
    throw createHttpError('该号码未注册 WhatsApp，请检查国家区号和号码是否正确', 404, checked);
  }
  const providerChatId = checked.chatId;
  const canonicalChatId = `${phone}@c.us`;

  const existing = await pool.query(
    `SELECT id, status, last_message_at, last_message_preview
       FROM conv.conversations c
       LEFT JOIN conv.contacts ct ON ct.id = c.contact_id
      WHERE c.channel = 'whatsapp'
        AND (
          c.external_chat_id = $1
          OR c.external_chat_id = $2
          OR ct.phone = $3
        )
      ORDER BY CASE WHEN c.external_chat_id = $1 THEN 0 ELSE 1 END, c.updated_at DESC
      LIMIT 1`,
    [canonicalChatId, providerChatId, `+${phone}`],
  );
  return {
    phone: `+${phone}`,
    chatId: canonicalChatId,
    providerChatId,
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
    const providerChatId = recipient.providerChatId || recipient.chatId;
    const sentResponse = await fetchWaha('/api/sendText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionName, chatId: providerChatId, text: content }),
    });
    const sent = await sentResponse.json().catch(() => ({}));
    if (!sentResponse.ok) throw new Error(sent.message || 'WhatsApp 消息发送失败');

    const externalMessageId = sent?.id?._serialized || sent?._data?.id?._serialized || null;
    await pool.query(
      `UPDATE conv.outbound_requests SET status = 'sent', result = $2, updated_at = now() WHERE idempotency_key = $1`,
      [idempotencyKey, JSON.stringify({ phone: `+${phone}`, chatId, providerChatId, externalMessageId })],
    );
    const actorId = authenticated.userId;
    const client = await pool.connect();
    let conversation;
    let reused = false;
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT c.id
           FROM conv.conversations c
           LEFT JOIN conv.contacts ct ON ct.id = c.contact_id
          WHERE c.channel = 'whatsapp'
            AND (c.external_chat_id = $1 OR c.external_chat_id = $2 OR ct.phone = $3)
          LIMIT 1`,
        [chatId, providerChatId, `+${phone}`],
      );
      reused = existing.rowCount > 0;
      const contactResult = await client.query(
        `INSERT INTO conv.contacts(channel, external_id, display_name, channel_display_name, phone)
         VALUES ('whatsapp', $1, $2, $2, $3)
         ON CONFLICT(channel, external_id) DO UPDATE SET
           channel_display_name = COALESCE(conv.contacts.channel_display_name, EXCLUDED.channel_display_name),
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
      // 沟通状态表单：销售主动发起的会话也落 duiHuaLiShi 档案（幂等；仅上线后新会话）。
      syncConversationToHistory(conversation.id, { createIfMissing: true }).catch(() => {});
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

app.patch('/api/conversations/:id/handoff', requireSameSite, async (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase();
  // 销售主管接管销售会话不再允许原销售拒绝；该接口仅兼容旧客户端的确认请求。
  if (action !== 'accept') return res.status(403).json({ error: '销售主管接管请求无需销售确认或拒绝' });
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestResult = await client.query(
      `SELECT r.id, r.conversation_id, r.requested_by_member_id, r.from_agent_id,
              c.channel, c.status
         FROM conv.conversation_handoff_requests r
         JOIN conv.conversations c ON c.id = r.conversation_id
        WHERE r.conversation_id = $1 AND r.status = 'pending'
          AND r.from_agent_id = $2
        ORDER BY r.requested_at DESC
        LIMIT 1
        FOR UPDATE OF r`,
      [req.params.id, viewer.workspaceMemberId],
    );
    const request = requestResult.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '没有找到需要处理的接管请求' });
    }
    await client.query(
      `UPDATE conv.conversation_handoff_requests
          SET decision = 'accepted'
        WHERE id = $1`,
      [request.id],
    );
    await client.query(
      `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at, owner_id)
       VALUES ($1, $2, 'system', $3, 'system', now(), $4)`,
      [`system:${request.conversation_id}:${Date.now()}:transfer-accepted`, request.conversation_id,
        `当前销售已接受销售主管的接管请求`, viewer.userId],
    );
    await client.query('COMMIT');
    return res.json({ status: 'pending', decision: 'accepted' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[handoff] response failed:', error.message);
    return res.status(502).json({ error: '接管请求处理失败' });
  } finally {
    client.release();
  }
});

app.patch('/api/conversations/:id/status', requireSameSite, async (req, res) => {
  const action = String(req.body?.action || '').trim();
  if (!['takeover', 'release', 'close', 'transfer', 'return'].includes(action)) return res.status(400).json({ error: 'unsupported status action' });
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(403).json({ error: '当前账号没有工作区成员权限' });
  if (viewer.isBoss && !viewer.isSupervisor) return res.status(403).json({ error: '当前角色仅有查看权限，不能接管或释放会话' });

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
    const workspaceSchema = await getWorkspaceSchema();
    const visibility = conversationVisibilityWhere(viewer, 'c', 2, { workspaceSchema });
    const visibleResult = await client.query(
      `SELECT EXISTS(SELECT 1 FROM conv.conversations c WHERE c.id = $1 AND ${visibility.sql}) AS visible`,
      [req.params.id, ...visibility.params],
    );
    if (!visibleResult.rows[0]?.visible) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: '当前账号无权操作该会话' });
    }
    // 人工接管/释放不再受 AI 排班时段限制：排班只决定 AI 是否自动回复，不该卡住人。
    // 仅当会话本身未开启 AI 托管模式（aiEnabled=false，如普通非官网会话）时才拦截。
    if (action === 'transfer') {
      if (!viewer.isSupervisor || conversation.channel !== 'website' || conversation.status !== 'takeover' || !conversation.agent_id || conversation.agent_id === viewer.workspaceMemberId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: '仅销售主管可以接管其他销售正在沟通的官网会话' });
      }
      const pending = await client.query(
        `INSERT INTO conv.conversation_handoff_requests(
           conversation_id, requested_by_member_id, from_agent_id, effective_at)
         VALUES ($1, $2, $3, now() + interval '10 seconds')
         ON CONFLICT DO NOTHING
         RETURNING id, requested_at AS "requestedAt", effective_at AS "effectiveAt"`,
        [conversation.id, viewer.workspaceMemberId, conversation.agent_id],
      );
      if (!pending.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '该会话已有接管请求，请等待 10 秒后再操作' });
      }
      await client.query(
        `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at, owner_id)
         VALUES ($1, $2, 'system', $3, 'system', now(), $4)`,
        [`system:${conversation.id}:${Date.now()}:transfer-request`, conversation.id,
          `销售主管 ${viewer.name} 请求接管此销售会话，10秒后完成转交`, viewer.userId],
      );
      await client.query('COMMIT');
      return res.status(202).json({
        status: 'pending',
        requestedAt: pending.rows[0].requestedAt,
        effectiveAt: pending.rows[0].effectiveAt,
      });
    }
    if (action === 'return') {
      if (!viewer.isSupervisor || conversation.channel !== 'website' || conversation.status !== 'takeover' || conversation.agent_id !== viewer.workspaceMemberId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: '仅当前接管该会话的销售主管可以交还销售' });
      }
      const handoffResult = await client.query(
        `SELECT r.id, r.from_agent_id,
                NULLIF(CONCAT_WS(' ', wm."nameFirstName", wm."nameLastName"), '') AS from_agent_name
           FROM conv.conversation_handoff_requests r
           LEFT JOIN ${workspaceSchema}."workspaceMember" wm
             ON wm.id::text = r.from_agent_id AND wm."deletedAt" IS NULL
          WHERE r.conversation_id = $1
            AND r.status = 'completed'
            AND r.requested_by_member_id = $2
          ORDER BY r.completed_at DESC NULLS LAST, r.requested_at DESC
          LIMIT 1
          FOR UPDATE OF r`,
        [conversation.id, viewer.workspaceMemberId],
      );
      const handoff = handoffResult.rows[0];
      if (!handoff?.from_agent_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: '未找到可交还的原销售' });
      }
      await client.query(
        `UPDATE conv.conversations
            SET agent_id = $2, taken_over_at = now(), updated_at = now()
          WHERE id = $1 AND agent_id = $3
          RETURNING id`,
        [conversation.id, handoff.from_agent_id, viewer.workspaceMemberId],
      );
      await client.query(
        `INSERT INTO conv.conversation_participants(conversation_id, workspace_member_id, user_id, role, first_joined_at, last_joined_at)
         SELECT $1, wm.id, wm."userId", 'takeover', now(), now()
           FROM ${workspaceSchema}."workspaceMember" wm
          WHERE wm.id::text = $2 AND wm."deletedAt" IS NULL
         ON CONFLICT(conversation_id, workspace_member_id)
         DO UPDATE SET last_joined_at = now(), user_id = EXCLUDED.user_id, role = EXCLUDED.role`,
        [conversation.id, handoff.from_agent_id],
      );
      await client.query(
        `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at, owner_id)
         VALUES ($1, $2, 'system', $3, 'system', now(), $4)`,
        [`system:${conversation.id}:${Date.now()}:transfer-return`, conversation.id,
          `销售主管已将会话交还给 ${handoff.from_agent_name || '原销售'}`, viewer.userId],
      );
      await client.query(
        `INSERT INTO conv.conversation_handoff_notices(
           conversation_id, recipient_member_id, returned_by_member_id, message)
         VALUES ($1, $2, $3, $4)`,
        [conversation.id, handoff.from_agent_id, viewer.workspaceMemberId,
          `销售主管已将会话交还给你（${handoff.from_agent_name || '原销售'}）`],
      );
      await client.query('COMMIT');
      syncConversationToHistory(conversation.id, { createIfMissing: false }).catch(() => {});
      return res.json({
        id: conversation.id,
        status: conversation.status,
        agentId: handoff.from_agent_id,
        agentName: handoff.from_agent_name || '原销售',
      });
    }
    if (action !== 'close' && !conversation.aiEnabled) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'AI客服未激活，暂不可人工接管' });
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
    // 接管写入计时起点；释放/关闭清空计时，避免重复触发自动释放。
    const nextTakenOverAt = action === 'takeover' ? 'now()' : 'NULL';
    await client.query(
      `UPDATE conv.conversations SET status = $2, agent_id = $3, taken_over_at = ${nextTakenOverAt}, updated_at = now() WHERE id = $1`,
      [req.params.id, nextStatus, nextAgentId],
    );
    await client.query(
      `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at)
       VALUES ($1, $2, 'system', $3, 'system', now())`,
      [`system:${req.params.id}:${Date.now()}:${action}`, req.params.id, systemText],
    );
    await client.query('COMMIT');
    // 沟通状态表单：状态变更（接管/释放/关闭）增量更新档案的「会话状态」。
    syncConversationToHistory(req.params.id, { createIfMissing: false }).catch(() => {});
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

app.patch('/api/conversations/:id/handoff-notice/:noticeId', requireSameSite, async (req, res) => {
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
  try {
    const result = await pool.query(
      `UPDATE conv.conversation_handoff_notices
          SET seen_at = now()
        WHERE id = $1 AND conversation_id = $2 AND recipient_member_id = $3 AND seen_at IS NULL
        RETURNING id`,
      [req.params.noticeId, req.params.id, viewer.workspaceMemberId],
    );
    if (!result.rowCount) return res.status(404).json({ error: '通知不存在或已处理' });
    return res.json({ id: result.rows[0].id, seen: true });
  } catch (error) {
    console.error('[handoff-notice] mark seen failed:', error.message);
    return res.status(502).json({ error: '通知状态更新失败' });
  }
});

// ── 需求一：对话名称人工编辑（全渠道通用）───────────────────────────────────
// 名称落在 conv.contacts.display_name 并把来源标记为 manual，之后渠道 webhook 不再覆盖；
// 传空名称 = 恢复渠道原始名（channel_display_name → 手机号 → 邮箱 → 外部 ID 兜底）。
const CONTACT_NAME_MAX_LENGTH = 120;

app.patch('/api/conversations/:id/name', requireSameSite, async (req, res) => {
  if (req.body?.name != null && typeof req.body.name !== 'string') {
    return res.status(400).json({ error: '名称格式无效' });
  }
  const rawName = String(req.body?.name ?? '').trim();
  if (rawName.length > CONTACT_NAME_MAX_LENGTH) {
    return res.status(400).json({ error: `名称不能超过 ${CONTACT_NAME_MAX_LENGTH} 个字符` });
  }
  // 登录 + 会话可见性 + 写权限（boss 只读）三重校验，全部复用既有逻辑。
  const access = await requireWriteConversationAccess(req, res);
  if (!access) return;
  const { authenticated, conversation } = access;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 只改「该会话关联的那一个 contact」：用 conversation_id 精确定位，
    // 避免跨渠道相同 external_id 或空 conversation_id 误伤其他客户。
    const currentResult = await client.query(
      `SELECT ct.id, ct.display_name, ct.channel_display_name, ct.display_name_source,
              ct.phone, ct.email, ct.external_id, ct.twenty_opportunity_id
         FROM conv.conversations c JOIN conv.contacts ct ON ct.id = c.contact_id
        WHERE c.id = $1 FOR UPDATE OF ct`,
      [req.params.id],
    );
    const contact = currentResult.rows[0];
    if (!contact) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '该会话没有关联客户，无法改名' });
    }
    const channelFallback = [contact.channel_display_name, contact.phone, contact.email, contact.external_id]
      .map(value => String(value || '').trim())
      .find(Boolean) || '';
    const nextName = rawName || channelFallback;
    const nextSource = rawName ? 'manual' : 'channel';
    const updated = await client.query(
      `UPDATE conv.contacts SET display_name = $2, display_name_source = $3,
              display_name_updated_at = now(), display_name_updated_by = $4, updated_at = now()
        WHERE id = $1
        RETURNING id, display_name, display_name_source, channel_display_name`,
      [contact.id, nextName, nextSource, authenticated.actor.id],
    );
    // 对话名称代表联系人身份；已关联线索时同步联系人姓名，避免工作台与线索详情不一致。
    // 不更新 opportunity.name/companyId，防止把联系人名误写为公司名称。
    if (contact.twenty_opportunity_id) {
      const schema = await getWorkspaceSchema();
      await client.query(
        `UPDATE ${schema}.opportunity
            SET "lianXiRenXingMing" = $2, "updatedAt" = now()
          WHERE id = $1 AND "deletedAt" IS NULL`,
        [contact.twenty_opportunity_id, nextName],
      );
    }
    await client.query('COMMIT');
    const row = updated.rows[0];
    recordAuditEvent('conversation.name_changed', {
      channel: conversation.channel,
      conversationId: req.params.id,
      actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
      requestSummary: auditRequestSummary(req),
      payload: {
        contactId: contact.id,
        fromName: contact.display_name || '',
        toName: row.display_name || '',
        fromSource: contact.display_name_source,
        toSource: row.display_name_source,
        channelName: row.channel_display_name || '',
      },
    });
    res.json({
      conversationId: req.params.id,
      contactId: row.id,
      name: row.display_name || '',
      source: row.display_name_source,
      channelName: row.channel_display_name || '',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[conversation-name] rename failed:', error.message);
    res.status(502).json({ error: '名称保存失败', detail: error.message });
  } finally {
    client.release();
  }
});

// 渠道级 AI 自动回复开关（工作台齿轮的「生效范围」）
app.get('/api/ai-settings', async (req, res) => {
  const viewer = await resolveConversationViewer(req);
  if (!viewer) return res.status(401).json({ error: '登录状态已失效，请刷新 CRM 后重试' });
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
    // 保证四个渠道恒定返回，缺失的按官网默认开、其余关兜底
    res.json(buildAiSettingResponses(result.rows));
  } catch (error) {
    console.error('[ai-settings] load failed:', error.message);
    res.status(502).json({ error: 'ai settings load failed', detail: error.message });
  }
});

app.patch('/api/ai-settings', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const normalized = normalizeAiSettingPayload(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const setting = normalized.setting;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await saveAiSetting(client, setting);
    // 清掉该渠道的会话级覆盖，令现有会话立即继承渠道设置
    await client.query(`UPDATE conv.conversations SET ai_enabled = NULL WHERE channel = $1`, [setting.channel]);
    await client.query('COMMIT');
    recordAuditEvent('ai-settings.updated', {
      actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
      payload: setting,
    });
    res.json(saved);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ai-settings] update failed:', error.message);
    res.status(502).json({ error: 'ai settings update failed', detail: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/ai-settings/batch', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const input = Array.isArray(req.body?.settings) ? req.body.settings : [];
  if (input.length === 0) return res.status(400).json({ error: 'settings must be a non-empty array' });
  if (input.length > AI_SETTING_CHANNELS.length) return res.status(400).json({ error: 'too many settings' });
  const seen = new Set();
  const settings = [];
  for (const item of input) {
    const normalized = normalizeAiSettingPayload(item);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    if (seen.has(normalized.setting.channel)) return res.status(400).json({ error: 'duplicate channel' });
    seen.add(normalized.setting.channel);
    settings.push(normalized.setting);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    for (const setting of settings) {
      saved.push(await saveAiSetting(client, setting));
    }
    await client.query(`UPDATE conv.conversations SET ai_enabled = NULL WHERE channel = ANY($1::text[])`, [settings.map(item => item.channel)]);
    await client.query('COMMIT');
    recordAuditEvent('ai-settings.batch_updated', {
      actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
      payload: { settings },
    });
    res.json({ settings: saved });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ai-settings] batch update failed:', error.message);
    res.status(502).json({ error: 'ai settings batch update failed', detail: error.message });
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

function normalizeWahaSessionStatusPayload(payload = {}, sessionName = WAHA_SESSION) {
  const data = payload.payload || payload;
  const nestedSession = data.session && typeof data.session === 'object' ? data.session : {};
  const status = data.status || data.state || nestedSession.status || nestedSession.state || payload.status || payload.state || '';
  const me = data.me || nestedSession.me || payload.me || {};
  const engine = data.engine || nestedSession.engine || payload.engine || {};
  return normalizeWahaSession({
    name: sessionName,
    status: status || 'UNKNOWN',
    me,
    engine,
  });
}

async function syncWahaBindingStatus(sessionName, normalized, source = 'status') {
  if (!sessionName || !normalized?.status) return null;
  const metadataPatch = {
    lastWahaStatus: normalized.status,
    lastWahaStatusAt: new Date().toISOString(),
    lastWahaStatusSource: source,
  };
  if (normalized.phone) metadataPatch.phone = normalized.phone;
  if (normalized.engine) metadataPatch.engine = normalized.engine;
  const result = await pool.query(
    `UPDATE conv.channel_accounts
        SET status = $2,
            external_account_id = COALESCE(NULLIF($3, ''), external_account_id),
            display_name = COALESCE(NULLIF($4, ''), display_name),
            metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
            updated_at = now()
      WHERE channel = 'whatsapp'
        AND provider = 'waha'
        AND provider_session = $1
        AND status <> 'unbound'
      RETURNING id, user_id, workspace_member_id, provider_session, external_account_id, display_name, status, metadata, updated_at`,
    [
      sessionName,
      normalized.status,
      normalized.accountId || '',
      normalized.displayName || normalized.phone || '',
      JSON.stringify(metadataPatch),
    ],
  );
  if (!result.rowCount) {
    console.warn('[whatsapp-status] no active CRM binding for WAHA session:', sessionName, normalized.status);
    return null;
  }
  return result.rows[0];
}

function wahaWebhookConfigMatches(session = {}) {
  const hooks = Array.isArray(session.config?.webhooks) ? session.config.webhooks : [];
  return hooks.some(hook => {
    const events = new Set(Array.isArray(hook.events) ? hook.events : []);
    return hook.url === WAHA_WEBHOOK_URL && WAHA_WEBHOOK_EVENTS.every(event => events.has(event));
  });
}

async function ensureWahaSessionWebhookConfig(sessionName, currentSession = null) {
  const current = currentSession || await getWahaSession(sessionName);
  if (wahaWebhookConfigMatches(current)) return { updated: false, session: current };
  const nextConfig = {
    ...(current.config || {}),
    webhooks: [
      {
        url: WAHA_WEBHOOK_URL,
        events: WAHA_WEBHOOK_EVENTS,
      },
    ],
  };
  const response = await fetchWaha(`/api/sessions/${encodeURIComponent(sessionName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: nextConfig }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'WAHA session config update failed');
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  console.log(`[whatsapp-status] updated webhook config for session ${sessionName}`);
  return { updated: true, session: data };
}

let wahaStatusPolling = false;
async function pollWahaBindingsOnce() {
  if (wahaStatusPolling) return { skipped: true, reason: 'poll already running' };
  wahaStatusPolling = true;
  try {
    const result = await pool.query(
      `SELECT DISTINCT provider_session
       FROM conv.channel_accounts
       WHERE channel = 'whatsapp'
         AND provider = 'waha'
         AND status <> 'unbound'
         AND provider_session IS NOT NULL
       ORDER BY provider_session`,
    );
    let checked = 0, restarted = 0, failed = 0;
    for (const row of result.rows) {
      const sessionName = row.provider_session;
      try {
        let session = await getWahaSession(sessionName);
        await ensureWahaSessionWebhookConfig(sessionName, session).catch(error => {
          console.error(`[whatsapp-status] webhook config update failed for ${sessionName}:`, error.message);
        });

        let normalized = normalizeWahaSession(session);
        if (WAHA_AUTO_RESTART_ON_DISCONNECT && ['FAILED', 'STOPPED'].includes(normalized.status)) {
          const response = await fetchWaha(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, { method: 'POST' });
          if (response.ok || response.status === 201 || response.status === 202) {
            restarted++;
            session = await waitForWahaStatus(['SCAN_QR_CODE', 'WORKING', 'FAILED', 'STOPPED'], 12, 1000, sessionName);
            normalized = normalizeWahaSession(session);
          }
        }
        await syncWahaBindingStatus(sessionName, normalized, 'poller');
        checked++;
      } catch (error) {
        failed++;
        console.error(`[whatsapp-status] poll failed for ${sessionName}:`, error.message);
        await pool.query(
          `UPDATE conv.channel_accounts
              SET status = $2,
                  metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                  updated_at = now()
            WHERE channel = 'whatsapp'
              AND provider = 'waha'
              AND provider_session = $1
              AND status <> 'unbound'`,
          [
            sessionName,
            error.status === 404 ? 'NOT_FOUND' : 'UNKNOWN',
            JSON.stringify({
              lastWahaStatus: error.status === 404 ? 'NOT_FOUND' : 'UNKNOWN',
              lastWahaStatusAt: new Date().toISOString(),
              lastWahaStatusSource: 'poller-error',
              lastWahaError: error.detail || error.message,
            }),
          ],
        ).catch(dbError => console.error('[whatsapp-status] failed to persist poll error:', dbError.message));
      }
    }
    if (checked || restarted || failed) {
      console.log(`[whatsapp-status] checked=${checked}, restarted=${restarted}, failed=${failed}`);
    }
    return { skipped: false, checked, restarted, failed };
  } finally {
    wahaStatusPolling = false;
  }
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

// 需求二：webhook 事件必须包含 message.ack，否则拿不到送达/已读回执。
const WAHA_WEBHOOK_EVENTS = ['message', 'message.ack', 'session.status'];

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
            events: WAHA_WEBHOOK_EVENTS,
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
    const syncedBinding = binding
      ? await syncWahaBindingStatus(sessionName, normalized, 'status-endpoint').catch(error => {
        console.error('[whatsapp-status] sync failed:', error.message);
        return null;
      })
      : null;
    const effectiveBinding = syncedBinding || binding;
    res.json({
      channel: 'whatsapp',
      provider: 'waha',
      ...normalized,
      phone: normalized.phone || effectiveBinding?.metadata?.phone || '',
      accountId: normalized.accountId || effectiveBinding?.external_account_id || '',
      displayName: normalized.displayName || effectiveBinding?.display_name || '',
      binding: {
        bound: !!effectiveBinding,
        boundToCurrentUser: !!effectiveBinding && effectiveBinding.user_id === authenticated.userId,
        boundByOther: !!effectiveBinding && effectiveBinding.user_id !== authenticated.userId,
        ownerName: effectiveBinding && effectiveBinding.user_id !== authenticated.userId ? formatBindingOwner(effectiveBinding) : '',
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

// ── 线索/客户联系人/项目 协办人（xieBanRenId）读写 ──────────────────────────────
// 协办人 = 单值 RELATION→workspaceMember（字段 xieBanRenId）。仅主负责人(ownerId)或 admin 可设置。
// 协办人可见性已在 lib/conversation-visibility.js 的 linkedCrmAssigneeSql 中纳入：
// 协作人可看关联记录的对话、可接管/回复（继续沟通）。
const COLLAB_OBJECTS = {
  opportunity: { table: 'opportunity', idCol: 'id', collabCol: 'xieBanRenId', ownerCol: 'ownerId' },
  person: { table: 'person', idCol: 'id', collabCol: 'xieBanRenId', ownerCol: 'ownerId' },
  xiangMu: { table: '_xiangMu', idCol: 'id', collabCol: 'xieBanRenId', ownerCol: 'ownerId' },
};

async function loadCollabRecord(schema, objectType, recordId) {
  const cfg = COLLAB_OBJECTS[objectType];
  if (!cfg) return null;
  const result = await pool.query(
    `SELECT "${cfg.idCol}" AS id, "${cfg.ownerCol}" AS "ownerId", "${cfg.collabCol}" AS "collaboratorId"
       FROM ${schema}.${cfg.table}
      WHERE "${cfg.idCol}" = $1 AND "deletedAt" IS NULL
      LIMIT 1`,
    [recordId],
  );
  return result.rows[0] || null;
}

app.get('/api/crm/:objectType/:id/collaborators', async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const { objectType, id } = req.params;
  if (!COLLAB_OBJECTS[objectType]) return res.status(400).json({ error: '不支持的对象类型' });
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ error: '记录 ID 格式无效' });
  try {
    const schema = await getWorkspaceSchema();
    const row = await loadCollabRecord(schema, objectType, id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    const viewer = await resolveConversationViewer(req);
    const isAdmin = viewer.role === 'admin' || viewer.role === 'boss';
    const isOwner = viewer.workspaceMemberId === row.ownerId;
    res.json({
      ok: true,
      objectType,
      recordId: id,
      ownerId: row.ownerId,
      collaboratorId: row.collaboratorId || null,
      canEdit: isAdmin || isOwner,
      currentUserId: viewer.workspaceMemberId,
    });
  } catch (error) {
    res.status(500).json({ error: '读取协办人失败', detail: error.message });
  }
});

// 工作区成员列表（仅 id + 姓名），供协办人选择器使用；任意已登录成员可访问。
app.get('/api/crm/members', async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  try {
    const schema = await getWorkspaceSchema();
    const result = await pool.query(
      `SELECT id AS "workspaceMemberId",
              NULLIF(TRIM(COALESCE("nameFirstName",'') || ' ' || COALESCE("nameLastName",'')), '') AS name
         FROM ${schema}."workspaceMember"
        WHERE "deletedAt" IS NULL
        ORDER BY name NULLS LAST`,
    );
    res.json({
      ok: true,
      members: result.rows.map((m) => ({ workspaceMemberId: m.workspaceMemberId, name: m.name || '未命名成员' })),
    });
  } catch (error) {
    res.status(500).json({ error: '读取成员列表失败', detail: error.message });
  }
});

app.put('/api/crm/:objectType/:id/collaborators', requireSameSite, async (req, res) => {
  const authenticated = await requireAuthenticatedTwentyUser(req, res);
  if (!authenticated) return;
  const { objectType, id } = req.params;
  if (!COLLAB_OBJECTS[objectType]) return res.status(400).json({ error: '不支持的对象类型' });
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ error: '记录 ID 格式无效' });
  const { collaboratorId } = req.body || {};
  if (collaboratorId && collaboratorId !== '') {
    if (!/^[0-9a-fA-F-]{36}$/.test(collaboratorId)) return res.status(400).json({ error: '协办人 ID 格式无效' });
  }
  const collabValue = collaboratorId && collaboratorId !== '' ? collaboratorId : null;
  try {
    const schema = await getWorkspaceSchema();
    const row = await loadCollabRecord(schema, objectType, id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    const viewer = await resolveConversationViewer(req);
    const isAdmin = viewer.role === 'admin' || viewer.role === 'boss';
    const isOwner = viewer.workspaceMemberId === row.ownerId;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: '仅主负责人或管理员可设置协办人' });
    }
    const cfg = COLLAB_OBJECTS[objectType];
    await pool.query(
      `UPDATE ${schema}.${cfg.table}
          SET "${cfg.collabCol}" = $1, "updatedAt" = now()
        WHERE "${cfg.idCol}" = $2`,
      [collabValue, id],
    );
    recordAuditEvent('crm.collaborator.updated', {
      actor: { userId: authenticated.userId, workspaceMemberId: authenticated.actor.id, name: authenticated.actor.name },
      payload: { objectType, recordId: id, collaboratorId: collabValue, by: isAdmin ? 'admin' : 'owner' },
    });
    res.json({ ok: true, objectType, recordId: id, ownerId: row.ownerId, collaboratorId: collabValue });
  } catch (error) {
    res.status(500).json({ error: '设置协办人失败', detail: error.message });
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
const normalizeEmailList = (value) => {
  if (!value) return [];
  if (typeof value === 'object') {
    return [
      value.primaryEmail,
      value.secondaryEmail,
      ...(Array.isArray(value.additionalEmails) ? value.additionalEmails : []),
    ]
      .flatMap((item) => normalizeEmailList(item))
      .filter(Boolean);
  }
  return String(value || '')
    .split(EMAIL_SEPARATOR_RE)
    .map((item) => item.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''))
    .filter(Boolean);
};
const VALID_OPPORTUNITY_STAGES = new Set([
  'WEI_CHU_LI_XIANSUO',
  'XIANSUO',
  'YOUXIAO_XIANSUO',
  'QUE_REN_XUN_PAN',
  'XUN_PAN_ZHUAN_ZONGBU',
  'ZONGBU_FANG_AN_BAO_JIA',
  'JI_SHU_CHENG_QING',
  'SHANG_WU_CHENG_QING',
  'YI_QIAN_DAN_FU_KUAN',
  'YI_FA_HUO',
]);
const LEGACY_OPPORTUNITY_STAGE_MAP = {
  XUNJIA: 'QUE_REN_XUN_PAN',
  BAOJIA: 'ZONGBU_FANG_AN_BAO_JIA',
  SHENYANG: 'JI_SHU_CHENG_QING',
  TANPAN: 'SHANG_WU_CHENG_QING',
  YIXIADAN: 'YI_QIAN_DAN_FU_KUAN',
  YIFUKUAN: 'YI_QIAN_DAN_FU_KUAN',
  YICHENGJIAO: 'YI_QIAN_DAN_FU_KUAN',
  YIFAHUO: 'YI_FA_HUO',
};
function normalizeOpportunityStage(value, fallback = 'XIANSUO') {
  const raw = String(value || '').trim();
  const mapped = LEGACY_OPPORTUNITY_STAGE_MAP[raw] || raw;
  return VALID_OPPORTUNITY_STAGES.has(mapped) ? mapped : fallback;
}
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

async function ensureOpportunityForInboundConversation({ conversationId, contactId, channel, phone }) {
  if (!conversationId || !contactId || !['whatsapp', 'website'].includes(channel)) return null;
  const source = SOURCE_BY_CHANNEL[channel];

  const data = {
    // 线索名称（列表首列）在下方按兜底链赋值：访客名/渠道名 → 电话 → 线索编号，
    // 保证聊天自动建的线索绝不空白（否则列表里是空名行，看着像"没进来"）。
    // 初始进度：仅「官网表单(GUAN_WANG_BIAO_DAN)」来源为「未处理线索」；
    // 其他渠道（官网客服 GUAN_WANG_KE_FU / WhatsApp 等）统一为「线索(XIANSUO)」。
    stage: source === 'GUAN_WANG_BIAO_DAN' ? 'WEI_CHU_LI_XIANSUO' : 'XIANSUO',
  };
  if (source) data.keHuLaiYuan = source;
  const rawPhone = String(phone || '').replace(/[\s()-]+/g, '');
  if (rawPhone && /^\+?\d{5,15}$/.test(rawPhone)) {
    data.whatsapp = rawPhone.startsWith('+')
      ? { primaryPhoneNumber: rawPhone }
      : { primaryPhoneNumber: rawPhone, primaryPhoneCallingCode: '+86', primaryPhoneCountryCode: 'CN' };
  }
  await stripUnavailableOpportunityFields(data, []);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT twenty_opportunity_id, display_name FROM conv.contacts WHERE id = $1 FOR UPDATE',
      [contactId],
    );
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    if (existing.rows[0]?.twenty_opportunity_id) {
      await client.query('COMMIT');
      return existing.rows[0].twenty_opportunity_id;
    }

    // 显式生成线索ID（与表单路径一致），同时作为三表关联键 customerIdentityKey；
    // 即便 DB 触发器已兜底，这里也写入 JS 生成值，使审计日志可携带稳定线索ID。
    const leadNo = generateLeadId();
    // 线索名称兜底链：访客名/渠道名（conv.contacts.display_name，如「网站访客 xxxxxx」）→ 电话 → 线索编号。
    const displayName = String(existing.rows[0]?.display_name || '').trim();
    data.name = displayName || rawPhone || leadNo;

    const result = await twentyGraphQL(
      'mutation($data: OpportunityCreateInput!){ createOpportunity(data: $data){ id name } }',
      { data },
      TWENTY_API_KEY,
    );
    const opportunity = result?.createOpportunity;
    if (!opportunity?.id) throw new Error('createOpportunity returned empty id');
    const schema = await getWorkspaceSchema();
    await client.query(
      `UPDATE ${schema}.opportunity SET "leadNo" = $2, "customerIdentityKey" = $3, "updatedAt" = now() WHERE id = $1`,
      [opportunity.id, leadNo, leadNo],
    );
    await client.query(
      'UPDATE conv.contacts SET twenty_opportunity_id = $2, updated_at = now() WHERE id = $1',
      [contactId, opportunity.id],
    );
    await client.query('COMMIT');
    await recordAuditEvent('conversation.auto_created_lead', {
      channel,
      conversationId,
      payload: { opportunityId: opportunity.id, leadNo, stage: data.stage, source },
    });
    return opportunity.id;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[auto-lead] create opportunity failed:', error.message);
    return null;
  } finally {
    client.release();
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

  // 联系人姓名：转线索阶段只把姓名收口到 opportunity 的「联系人姓名」暂存列，不立即建 Person。
  // Person（客户主数据）统一在"转客户"时由 upsertPersonFromOpportunity 生成，并回填 pointOfContactId。

  // Opportunity.name 对应线索列表首列「公司名称」；联系人姓名写入 lianXiRenXingMing，
  // 不再用姓名、会话名或 WhatsApp 号兜底，避免公司列混入非公司数据。
  const data = { name: company || '' };
  let companyId = String(b.companyId || '').trim();
  if (!companyId && company) {
    try {
      const existingCompany = await findCompanyByExactName(company, TWENTY_API_KEY);
      const resolvedCompany = existingCompany || await createCompanyByName(company, TWENTY_API_KEY, auditActor);
      companyId = resolvedCompany?.id || '';
    } catch (error) { console.error('[convert-to-lead] company write failed:', error.message); }
  }
  if (companyId) data.companyId = companyId;
  const source = b.source || SOURCE_BY_CHANNEL[row.channel];
  const isWebsiteFormSource = source === 'GUAN_WANG_BIAO_DAN';
  // 注：pointOfContactId 不在转线索阶段写入；联系人(Person)在"转客户"时生成并回填。
  if (b.stage) data.stage = normalizeOpportunityStage(b.stage);
  if (source) data.keHuLaiYuan = source;
  if (!isUpdate && isWebsiteFormSource && !data.stage) data.stage = 'WEI_CHU_LI_XIANSUO';
  if (b.companyType) data.keHuLeiXing = String(b.companyType);
  if (b.product) data.keHuXuQiuChanPin = String(b.product);
  if (b.note) { /* note 暂不写入机会（convert-to-lead 路程无 RICH_TEXT 入口，避免 message 字段不存在报错） */ }

  // 电话/邮箱/成员关系 best-effort：明显无效直接跳过，避免一个脏字段阻断整单推送。
  const skipped = [];
  const ownerId = String(b.ownerId || '').trim();
  const collaboratorId = String(b.collaboratorId || '').trim();
  const uuidRe = /^[0-9a-fA-F-]{36}$/;
  const assignmentPatch = {};
  if (ownerId) {
    if (uuidRe.test(ownerId)) assignmentPatch.ownerId = ownerId;
    else skipped.push('ownerId');
  }
  if (collaboratorId) {
    if (uuidRe.test(collaboratorId)) assignmentPatch.xieBanRenId = collaboratorId;
    else skipped.push('collaboratorId');
  }

  const rawPhone = String(b.phone || '').replace(/[\s()-]+/g, '');
  if (rawPhone) {
    if (/^\+?\d{5,15}$/.test(rawPhone)) {
      data.whatsapp = rawPhone.startsWith('+')
        ? { primaryPhoneNumber: rawPhone }
        : { primaryPhoneNumber: rawPhone, primaryPhoneCallingCode: '+86', primaryPhoneCountryCode: 'CN' };
    } else skipped.push('phone');
  }
  const email = String(b.email || '').trim();
  if (email) {
    const emails = normalizeEmailList(email);
    if (emails.length > 0 && emails.every((item) => EMAIL_RE.test(item))) {
      data[OPPORTUNITY_EMAIL_FIELD] = { primaryEmail: emails[0] };
    }
    else skipped.push('email');
  }
  if (data.stage) data.stage = normalizeOpportunityStage(data.stage);
  if (!isWebsiteFormSource && (rawPhone || email) && (!data.stage || data.stage === 'XIANSUO')) data.stage = 'YOUXIAO_XIANSUO';
  const country = String(b.country || '').trim();
  if (country) data.guoJiaDiQu = { addressCountry: country };
  await stripUnavailableOpportunityFields(data, skipped);

  // [DEBUG] 临时日志：定位 phone/message/country 字段错误来源
  const invalidFields = Object.keys(data).filter(k => ['phone','message','country'].includes(k));
  if (invalidFields.length > 0) {
    console.error('[convert-to-lead] DEBUG: invalid fields found:', invalidFields, JSON.stringify(data).substring(0, 500));
  }

  const writeOpp = (d) => (isUpdate
    ? twentyGraphQL('mutation($id: UUID!, $data: OpportunityUpdateInput!){ updateOpportunity(id: $id, data: $data){ id name } }', { id: oppId, data: d }, TWENTY_API_KEY).then((r) => r?.updateOpportunity)
    : twentyGraphQL('mutation($data: OpportunityCreateInput!){ createOpportunity(data: $data){ id name } }', { data: d }, TWENTY_API_KEY).then((r) => r?.createOpportunity));

  try {
    let opp;
    try {
      opp = await writeOpp(data);
    } catch (e) {
      // 兜底：若 Twenty 仍因电话/邮箱格式拒绝，剥离该字段重试一次。
      const msg = (e.message || '').toLowerCase();
      if (msg.includes('phone') || msg.includes('email')) {
        if (msg.includes('phone')) { delete data.whatsapp; skipped.push('phone'); }
        if (msg.includes('email')) { delete data[OPPORTUNITY_EMAIL_FIELD]; skipped.push('email'); }
        opp = await writeOpp(data);
      } else throw e;
    }
    if (!opp?.id) return res.status(502).json({ error: isUpdate ? 'updateOpportunity failed' : 'createOpportunity failed' });
    await applyRecordAudit('opportunity', opp.id, auditActor, isUpdate ? 'update' : 'create');
    if (Object.keys(assignmentPatch).length > 0) {
      try {
        const schema = await getWorkspaceSchema();
        await pool.query(
          `UPDATE ${schema}.opportunity
              SET "ownerId" = COALESCE($2::uuid, "ownerId"),
                  "xieBanRenId" = COALESCE($3::uuid, "xieBanRenId"),
                  "updatedAt" = now()
            WHERE id = $1`,
          [opp.id, assignmentPatch.ownerId || null, assignmentPatch.xieBanRenId || null],
        );
      } catch (err) {
        console.error('[convert-to-lead] write owner/collaborator failed:', err.message);
        skipped.push('assignment');
      }
    }
    // 把对话工作台填写的联系人姓名收口到 opportunity「联系人姓名」暂存列（转客户时生成 Person 主数据）
    if (name) {
      try {
        const schema = await getWorkspaceSchema();
        await pool.query(`UPDATE ${schema}.opportunity SET "lianXiRenXingMing" = $2, "updatedAt" = now() WHERE id = $1`, [opp.id, name]);
      } catch (err) { console.error('[convert-to-lead] write contact name failed:', err.message); }
    }
    // 新转线索时显式生成线索ID（与表单/自动建线索路径一致），并作为三表关联键；
    // 即便 DB 触发器已兜底，也写入 JS 生成值，使审计日志可携带稳定线索ID。
    let leadNo = null;
    if (!isUpdate) {
      leadNo = generateLeadId();
      const schema = await getWorkspaceSchema();
      await pool.query(
        `UPDATE ${schema}.opportunity SET "leadNo" = $2, "customerIdentityKey" = $3, "updatedAt" = now() WHERE id = $1`,
        [opp.id, leadNo, leadNo],
      );
    }
    if (!isUpdate && row.contact_id) {
      await pool.query('UPDATE conv.contacts SET twenty_opportunity_id = $2, updated_at = now() WHERE id = $1', [row.contact_id, opp.id]);
    }
    await recordAuditEvent(isUpdate ? 'conversation.lead_updated' : 'conversation.converted_to_lead', {
      channel: row.channel,
      conversationId: req.params.id,
      actor: { userId: writeAccess.authenticated.userId, workspaceMemberId: writeAccess.authenticated.actor.id, name: writeAccess.authenticated.actor.name },
      requestSummary: auditRequestSummary(req),
      payload: { opportunityId: opp.id, leadNo, skipped: [...new Set(skipped)], updated: isUpdate },
    });
    res.status(isUpdate ? 200 : 201).json({ opportunityId: opp.id, name: opp.name, skipped: [...new Set(skipped)], updated: isUpdate });
  } catch (error) {
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

// 客户主数据去重探测（新模型：客户按 邮箱/手机号 唯一）。
// 返回疑似重复客户 + 每个客户名下的线索/项目，用于转客户弹窗让用户判断「分配 or 新建」。
// 只做提示，不自动复用。
async function findDuplicateCustomers(client, schema, opportunity) {
  const emails = [
    firstValidEmail(opportunity.youXiang),
    firstValidEmail(opportunity.emailPrimaryEmail),
  ].filter(Boolean).map((item) => item.toLowerCase());
  const phone = phoneDigits(opportunity.phonePrimaryPhoneNumber);
  if (emails.length === 0 && !phone) return [];

  const result = await client.query(
    `SELECT
       p.id,
       NULLIF(btrim(concat_ws(' ', p."nameFirstName", p."nameLastName")), '') AS name,
       p."emailsPrimaryEmail" AS email,
       p."phonesPrimaryPhoneNumber" AS phone,
       c.name AS "companyName",
       CASE
         WHEN cardinality($1::text[]) > 0 AND lower(COALESCE(p."emailsPrimaryEmail", '')) = ANY($1::text[]) THEN 'email'
         ELSE 'phone'
       END AS "matchedBy",
       COALESCE((
         SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'stage', o.stage, 'leadNo', o."leadNo") ORDER BY o."createdAt" DESC)
         FROM ${schema}.opportunity o
         WHERE o."deletedAt" IS NULL AND o."pointOfContactId" = p.id AND o.id <> $3
       ), '[]'::json) AS leads,
       COALESCE((
         SELECT json_agg(json_build_object('id', x.id, 'name', x.name, 'stage', x."xiangMuJieDuan") ORDER BY x."createdAt" DESC)
         FROM ${schema}."_xiangMu" x
         WHERE x."deletedAt" IS NULL AND x."pointOfContactId" = p.id
       ), '[]'::json) AS projects
     FROM ${schema}.person p
     LEFT JOIN ${schema}.company c ON c.id = p."companyId"
     WHERE p."deletedAt" IS NULL
       AND (
         (cardinality($1::text[]) > 0 AND lower(COALESCE(p."emailsPrimaryEmail", '')) = ANY($1::text[]))
         OR ($2::text <> '' AND regexp_replace(COALESCE(p."phonesPrimaryPhoneNumber", ''), '\\D', '', 'g') = $2)
       )
     ORDER BY p."createdAt" DESC
     LIMIT 10`,
    [emails, phone, opportunity.id],
  );
  return result.rows;
}

// 新模型：转客户永远新建客户主数据（不再按邮箱/电话/回访客复用）。
// 去重改由 findDuplicateCustomers + 前端弹窗处理（用户判断分配 or 新建）。
async function createPersonFromOpportunity(client, schema, opportunity) {
  // 客户(Person)姓名优先取线索「联系人姓名」暂存列（官网表单/对话工作台收口的联系人姓名），
  // 回退到线索标题（兼容无联系人姓名的旧线索）。
  const name = nonBlankOrNull(opportunity.lianXiRenXingMing) || nonBlankOrNull(opportunity.name);
  const email = firstValidEmail(opportunity.youXiang, opportunity.emailPrimaryEmail);
  const customerType = SHARED_CUSTOMER_TYPES.has(String(opportunity.keHuLeiXing || ''))
    ? String(opportunity.keHuLeiXing)
    : null;

  // 邮箱唯一：若用户在弹窗选择「仍然新建」而该邮箱已被其他客户占用，新客户不写邮箱（归属已有客户），
  // 避免撞唯一索引；电话无唯一约束，可重复。
  let insertEmail = email;
  if (insertEmail) {
    const emailTaken = await client.query(
      `SELECT 1 FROM ${schema}.person WHERE "deletedAt" IS NULL AND lower("emailsPrimaryEmail") = lower($1) LIMIT 1`,
      [insertEmail],
    );
    if (emailTaken.rowCount) insertEmail = null;
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
       "linkedProjectId",
       "leadNo"
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
       $14,
       $15
     )
     RETURNING id`,
    [
      fallbackName,
      opportunity.companyId || null,
      nonBlankOrNull(opportunity.phonePrimaryPhoneNumber),
      nonBlankOrNull(opportunity.phonePrimaryPhoneCountryCode),
      nonBlankOrNull(opportunity.phonePrimaryPhoneCallingCode),
      insertEmail,
      nonBlankOrNull(opportunity.countryAddressCountry),
      nonBlankOrNull(opportunity.keHuXuQiuChanPin),
      opportunity.keHuLaiYuan || null,
      customerType,
      nonBlankOrNull(opportunity.zhiWei),
      opportunity.syncGroupCode,
      opportunity.id,
      opportunity.linkedProjectId || null,
      nonBlankOrNull(opportunity.leadNo),
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
        "lianXiRenXingMing",
        "companyId",
        "pointOfContactId",
        "syncGroupCode",
        "linkedPersonId",
        "linkedProjectId",
        "leadNo",
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

    const convertMode = String(req.body?.mode || '').trim();
    const assignPersonId = String(req.body?.personId || '').trim() || null;

    // 首次调用（未指定 mode）：按邮箱/手机号查重；命中则返回疑似客户+其线索/项目，交前端弹窗判断。
    if (convertMode !== 'assign' && convertMode !== 'create') {
      const duplicates = await findDuplicateCustomers(client, schema, opportunity);
      if (duplicates.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'DUPLICATE_CUSTOMER',
          error: '发现疑似重复客户',
          detail: '系统中已有相同邮箱/手机号的客户，请选择「分配给已有客户」或「仍然新建」。',
          duplicates,
        });
      }
    }

    let person;
    if (convertMode === 'assign') {
      if (!assignPersonId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ code: 'PERSON_REQUIRED', error: '未指定要分配的客户' });
      }
      const chk = await client.query(
        `SELECT id FROM ${schema}.person WHERE id = $1 AND "deletedAt" IS NULL`,
        [assignPersonId],
      );
      if (!chk.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ code: 'PERSON_NOT_FOUND', error: '要分配的客户不存在或已删除' });
      }
      // 分配给已有客户：只挂关系，不改客户主数据。
      person = { id: assignPersonId, created: false };
    } else {
      person = await createPersonFromOpportunity(client, schema, opportunity);
    }
    if (!person?.id) throw new Error('person create failed');

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
         "leadNo" = COALESCE("leadNo", $13),
         name = COALESCE($4, name),
         "guoJiaDiQuAddressCountry" = COALESCE($5, "guoJiaDiQuAddressCountry"),
         "xuQiuChanPin" = COALESCE($6, "xuQiuChanPin"),
         "jinEAmountMicros" = COALESCE($7, "jinEAmountMicros"),
         "jinECurrencyCode" = COALESCE($8, "jinECurrencyCode"),
         "genJinJiLuMarkdown" = COALESCE($9, "genJinJiLuMarkdown"),
         "genJinJiLuBlocknote" = COALESCE($10, "genJinJiLuBlocknote"),
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
        nonBlankOrNull(opportunity.leadNo),
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
       "genJinJiLuMarkdown",
       "genJinJiLuBlocknote",
       "renWuJinDu",
       "syncGroupCode",
       "sourceOpportunityId",
       "linkedPersonId",
       "leadNo"
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
       $14,
       $15
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
      nonBlankOrNull(opportunity.leadNo),
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
         "leadNo",
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
         "genJinJiLuMarkdown" AS "message",
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

    // 项目也挂到客户上：线索已有客户则复用，否则新建（转客户弹窗已覆盖去重判断，此处不再弹窗）。
    let person;
    if (nonBlankOrNull(opportunity.pointOfContactId)) {
      person = { id: opportunity.pointOfContactId, created: false };
    } else {
      person = await createPersonFromOpportunity(client, schema, opportunity);
    }
    if (!person?.id) throw new Error('person create failed');

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
  // 需求二：出站消息落库即带状态。渠道 API 返回成功 = sent；调用失败 = failed（带错误摘要）。
  const deliveryStatus = options.deliveryStatus || 'sent';
  const inserted = await pool.query(`INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, sender_role, content, content_type, media_url, attachments, sent_at, owner_id,
      delivery_status, delivery_status_at, failed_at, status_detail)
    VALUES ($1, $2, 'agent', $3, $4, $5, $6, $7, now(), $8, $9, now(),
      CASE WHEN $9 = 'failed' THEN now() ELSE NULL END, $10) ON CONFLICT(external_msg_id) DO NOTHING RETURNING id`,
    [
      externalId || null,
      conversationId,
      options.senderRole || 'sales',
      content,
      options.contentType || 'text',
      options.mediaUrl || null,
      options.attachments ? JSON.stringify(options.attachments) : null,
      options.ownerId || null,
      deliveryStatus,
      options.statusDetail ? String(options.statusDetail).slice(0, 500) : null,
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

// 销售之间的接管请求：先给原销售 10 秒提示，截止时自动转交发送权。
async function processPendingSalesHandoffs() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schema = await getWorkspaceSchema();
    const pending = await client.query(
      `SELECT r.id, r.conversation_id, r.from_agent_id, r.requested_by_member_id, r.decision,
              wm."userId" AS requested_by_user_id,
              NULLIF(CONCAT_WS(' ', wm."nameFirstName", wm."nameLastName"), '') AS requested_by_name
         FROM conv.conversation_handoff_requests r
         LEFT JOIN ${schema}."workspaceMember" wm
           ON wm.id::text = r.requested_by_member_id AND wm."deletedAt" IS NULL
        WHERE r.status = 'pending' AND r.effective_at <= now()
        ORDER BY r.effective_at
        LIMIT 20
        FOR UPDATE OF r SKIP LOCKED`,
    );
    for (const row of pending.rows) {
      const updated = await client.query(
        `UPDATE conv.conversations
            SET agent_id = $2, taken_over_at = now(), updated_at = now()
          WHERE id = $1 AND channel = 'website' AND status = 'takeover' AND agent_id = $3
          RETURNING id`,
        [row.conversation_id, row.requested_by_member_id, row.from_agent_id],
      );
      if (updated.rowCount) {
        await client.query(
          `INSERT INTO conv.conversation_participants(conversation_id, workspace_member_id, user_id, role, first_joined_at, last_joined_at)
           VALUES ($1, $2, $3, 'takeover', now(), now())
           ON CONFLICT(conversation_id, workspace_member_id)
           DO UPDATE SET last_joined_at = now(), user_id = EXCLUDED.user_id, role = EXCLUDED.role`,
          [row.conversation_id, row.requested_by_member_id, row.requested_by_user_id],
        );
        await client.query(
          `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at, owner_id)
           VALUES ($1, $2, 'system', $3, 'system', now(), $4)`,
          [`system:${row.conversation_id}:${Date.now()}:transfer-complete`, row.conversation_id,
            `销售会话已由 ${row.requested_by_name || '销售主管'} 自动接管`, row.requested_by_user_id],
        );
        await client.query(
          `UPDATE conv.conversation_handoff_requests
              SET status = 'completed', completed_at = now()
            WHERE id = $1`,
          [row.id],
        );
      } else {
        await client.query(
          `UPDATE conv.conversation_handoff_requests
              SET status = 'cancelled', completed_at = now()
            WHERE id = $1`,
          [row.id],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[handoff] process failed:', error.message);
  } finally {
    client.release();
  }
}

// ── 官网接管超时自动释放 ──────────────────────────────────────────────────────
// 场景：销售接管后忘记释放，会话被长期占用（AI 无法接管、他人也不能接）。
// 规则：官网渠道、状态为 takeover、且连续 TAKEOVER_IDLE_MINUTES 分钟无人工(agent)消息，则自动释放。
// 范围仅官网（WhatsApp 为一人一号、对接不同客户，不存在长期占用客户资源问题）。
// 效果：status→open、agent_id→NULL、taken_over_at→NULL，并写入系统消息（不提及恢复 AI 托管，
//       因为官网可能未激活 AI 托管功能）；系统消息输出与审计均可审计，不影响业务数据。
const TAKEOVER_IDLE_MINUTES = Math.max(1, Number(process.env.TAKEOVER_IDLE_MINUTES || 120));

// 离线销售不应继续占用官网人工会话。释放后由官网 AI 继续接待。
async function releaseWebsiteTakeoversForOfflineAgents() {
  try {
    const result = await pool.query(
      `UPDATE conv.conversations c
          SET status = 'open', agent_id = NULL, taken_over_at = NULL, updated_at = now()
        WHERE c.channel = 'website' AND c.status = 'takeover'
          AND NOT EXISTS (
            SELECT 1 FROM conv.agent_presence p
             WHERE p.workspace_member_id = c.agent_id
               AND p.status = 'online'
          )
        RETURNING c.id, c.external_chat_id, c.agent_id AS "releasedAgentId"`,
      [],
    );
    for (const row of result.rows) {
      await pool.query(
        `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at)
         VALUES ($1, $2, 'system', $3, 'system', now())`,
        [`system:${row.id}:${Date.now()}:offline-ai`, row.id, '当前销售已离线，会话已自动切换为 AI 接管'],
      );
      try { await releaseWebsiteAiTakeover(row.external_chat_id); } catch (_error) { /* AI 服务不可用时不阻断状态释放 */ }
      syncConversationToHistory(row.id, { createIfMissing: false }).catch(() => {});
    }
    return result.rows.length;
  } catch (error) {
    console.error('[offline-ai] release failed:', error.message);
    return 0;
  }
}

async function releaseIdleTakeovers() {
  if (!TAKEOVER_IDLE_MINUTES) return;
  try {
    const result = await pool.query(
      `WITH idle AS (
         SELECT c.id, c.agent_id, c.external_chat_id
           FROM conv.conversations c
          WHERE c.channel = 'website'
            AND c.status = 'takeover'
            AND c.taken_over_at IS NOT NULL
            AND c.taken_over_at < now() - ($1::int * INTERVAL '1 minute')
            AND NOT EXISTS (
              SELECT 1 FROM conv.messages m
               WHERE m.conversation_id = c.id AND m.sender_type = 'agent'
                 AND m.sent_at > now() - ($1::int * INTERVAL '1 minute')
            )
          FOR UPDATE
       ), updated AS (
         UPDATE conv.conversations c
            SET status = 'open', agent_id = NULL, taken_over_at = NULL, updated_at = now()
           FROM idle
          WHERE c.id = idle.id
         RETURNING c.id, idle.agent_id AS "releasedAgentId", c.external_chat_id
       )
       SELECT * FROM updated`,
      [TAKEOVER_IDLE_MINUTES],
    );
    for (const row of result.rows) {
      if (row.releasedAgentId) {
        await pool.query(
          `UPDATE conv.agent_presence
              SET status = 'offline', updated_at = now()
            WHERE workspace_member_id = $1 AND status = 'online'
              AND NOT EXISTS (
                SELECT 1 FROM conv.conversations c2
                 WHERE c2.channel = 'website' AND c2.status = 'takeover'
                   AND c2.agent_id = $1 AND c2.taken_over_at IS NOT NULL
                   AND c2.taken_over_at >= now() - ($2::int * INTERVAL '1 minute')
              )`,
          [row.releasedAgentId, TAKEOVER_IDLE_MINUTES],
        );
      }
      // 沟通状态表单：超时自动释放 → 档案「会话状态」回退为进行中。
      syncConversationToHistory(row.id, { createIfMissing: false }).catch(() => {});
      await pool.query(
        `INSERT INTO conv.messages(external_msg_id, conversation_id, sender_type, content, content_type, sent_at)
         VALUES ($1, $2, 'system', $3, 'system', now())`,
        [`system:${row.id}:${Date.now()}:auto-release`, row.id,
         `超过${TAKEOVER_IDLE_MINUTES}分钟无人回复，销售已自动切换为离线，会话已切换为 AI 接管`],
      );
      // 官网若有 AI 服务且已配置，尝试通知释放（未激活/未配置时自动 no-op，不影响本流程）。
      try { await releaseWebsiteAiTakeover(row.external_chat_id); } catch (e) { /* 忽略 */ }
      recordAuditEvent('conversation.auto_released', {
        channel: 'website',
        conversationId: row.id,
        payload: { reason: 'idle_timeout', idleMinutes: TAKEOVER_IDLE_MINUTES, releasedAgentId: row.agent_id },
      });
    }
    if (result.rows.length) {
      console.log(`[auto-release] released ${result.rows.length} idle takeover conversation(s) after ${TAKEOVER_IDLE_MINUTES}min`);
    }
  } catch (error) {
    console.error('[auto-release] scan failed:', error.message);
  }
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
          ownerId: access.viewer.userId,
          senderRole: access.viewer.isSupervisor ? 'supervisor' : 'sales',
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
        // 需求二：附件与文本共用同一状态模型，失败同样落 failed 并留痕。
        const failedId = await recordAgentMessage(req.params.id, displayContent, null, {
          ownerId: access.viewer.userId,
          senderRole: access.viewer.isSupervisor ? 'supervisor' : 'sales',
          contentType: messageType,
          mediaUrl,
          attachments: [attachment],
          deliveryStatus: 'failed',
          statusDetail: `WAHA sendFile: ${error.message}`,
        });
        await recordAuditEvent('message.send_failed', {
          channel: conversation.channel,
          conversationId: req.params.id,
          messageId: failedId,
          actor: access.viewer,
          requestSummary: auditRequestSummary(req),
          payload: { contentType: messageType, hasAttachment: true, attachmentTitle: title, detail: String(error.message).slice(0, 300) },
        });
        return res.status(502).json({ error: 'WhatsApp file send failed', detail: error.message });
      }
    }

    if (conversation.channel === 'website') {
      try {
        const idempotencyKey = `crm-file:${req.params.id}:${Date.now()}`;
        const sent = await sendWebsiteAgentMessage(conversation, displayContent, idempotencyKey, attachment);
        const messageId = await recordAgentMessage(req.params.id, displayContent, `web:agent:${sent?.messageId || idempotencyKey}`, {
          ownerId: access.viewer.userId,
          senderRole: access.viewer.isSupervisor ? 'supervisor' : 'sales',
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
    if (!response.ok) {
      // 需求二：发送失败也要留痕并显示「失败」，绝不能静默丢弃或显示为已发送。
      const detail = await response.text();
      const failedId = await recordAgentMessage(req.params.id, content, null, {
        ownerId: access.viewer.userId,
        senderRole: access.viewer.isSupervisor ? 'supervisor' : 'sales',
        deliveryStatus: 'failed',
        statusDetail: `WAHA sendText ${response.status}: ${detail}`,
      });
      await recordAuditEvent('message.send_failed', {
        channel: conversation.channel,
        conversationId: req.params.id,
        messageId: failedId,
        actor: access.viewer,
        requestSummary: auditRequestSummary(req),
        payload: { contentType: 'text', httpStatus: response.status, detail: String(detail).slice(0, 300) },
      });
      return res.status(502).json({ error: 'WhatsApp send failed', detail });
    }
    const sent = await response.json();
        const messageId = await recordAgentMessage(req.params.id, content, sent?.id?._serialized || sent?._data?.id?._serialized, { ownerId: access.viewer.userId, senderRole: access.viewer.isSupervisor ? 'supervisor' : 'sales' });
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
    const messageId = await recordAgentMessage(req.params.id, content, sent?.message_id, { ownerId: access.viewer.userId, senderRole: access.viewer.isSupervisor ? 'supervisor' : 'sales' });
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
    const messageId = await recordAgentMessage(req.params.id, content, sent?.message_id, { ownerId: access.viewer.userId, senderRole: access.viewer.isSupervisor ? 'supervisor' : 'sales' });
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
    const messageId = await recordAgentMessage(req.params.id, content, `web:agent:${sent?.messageId || idempotencyKey}`, { ownerId: access.viewer.userId, senderRole: access.viewer.isSupervisor ? 'supervisor' : 'sales' });
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

async function sendHealth(_req, res) {
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
}

app.get('/health', sendHealth);
app.get('/api/health', sendHealth);

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

// 把内存中的 buffer（如邮件附件）落盘到本地存储目录，返回可下载 URL（带原始文件名）。
// 与 downloadWahaMediaToLocalFile 同一套存储与下载路由，供 /api/uploads/conversation-files 提供下载。
async function saveBufferToLocalFile(buffer, filenameHint, mimetype) {
  if (!buffer || !buffer.length) return null;
  const ext = extensionFromName(filenameHint || '') || WAHA_MEDIA_MIME_EXT[String(mimetype || '').toLowerCase()] || '';
  const storedName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), buffer);
  const original = filenameHint ? normalizeUploadFilename(filenameHint) : '';
  const suffix = original ? `?filename=${encodeURIComponent(original)}` : '';
  return `/conv-api/uploads/conversation-files/${encodeURIComponent(storedName)}${suffix}`;
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
    const contactResult = await client.query(`INSERT INTO conv.contacts(channel, external_id, display_name, channel_display_name, email)
      VALUES ('email', $1, $2, $2, $1) ON CONFLICT(channel, external_id)
      DO UPDATE SET channel_display_name = COALESCE(EXCLUDED.channel_display_name, conv.contacts.channel_display_name),
        display_name = CASE WHEN conv.contacts.display_name_source = 'manual'
            THEN conv.contacts.display_name
            ELSE COALESCE(EXCLUDED.display_name, conv.contacts.display_name) END,
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
  client.on('error', (error) => {
    console.error('[email] imap connection error:', error.message);
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
          const attachments = [];
          for (const a of (parsed.attachments || [])) {
            const filename = a.filename || '(未命名)';
            const size = a.size || (a.content ? a.content.length : 0);
            let url = null;
            // 落盘附件内容以支持下载；超过上限则只保留元数据（不落盘、不可下载）。
            if (a.content && a.content.length && a.content.length <= MAX_UPLOAD_BYTES) {
              try {
                url = await saveBufferToLocalFile(a.content, filename, a.contentType);
              } catch (err) {
                console.error('[email] save attachment failed:', filename, err.message);
              }
            }
            attachments.push({ filename, size, contentType: a.contentType || '', url });
          }
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

function startWahaStatusPoller() {
  if (!WAHA_API_URL || !WAHA_API_KEY) {
    console.log('[whatsapp-status] WAHA not configured (WAHA_API_URL/WAHA_API_KEY missing); poller disabled');
    return;
  }
  console.log(`[whatsapp-status] poller enabled every ${WAHA_STATUS_POLL_SECONDS}s; autoRestart=${WAHA_AUTO_RESTART_ON_DISCONNECT}`);
  const run = () => pollWahaBindingsOnce().catch(e => console.error('[whatsapp-status] poll cycle failed:', e.message));
  run();
  setInterval(run, WAHA_STATUS_POLL_SECONDS * 1000);
}

async function startServer() {
  await ensureSchema();
  app.listen(PORT, () => console.log(`[middleware] listening on ${PORT}`));
  startEmailPoller();
  startWahaStatusPoller();
  // 官网接管超时自动释放：每分钟扫描一次；启动即先跑一轮，回收历史遗留的占用会话。
  if (TAKEOVER_IDLE_MINUTES > 0) {
    releaseIdleTakeovers();
    setInterval(releaseIdleTakeovers, 60 * 1000);
    console.log(`[auto-release] website idle takeover auto-release enabled (idle > ${TAKEOVER_IDLE_MINUTES}min)`);
  }
  setInterval(() => processPendingSalesHandoffs(), 1000);
  // 启动后及每分钟清理已离线销售仍占用的官网人工会话。
  releaseWebsiteTakeoversForOfflineAgents().catch(() => {});
  setInterval(() => releaseWebsiteTakeoversForOfflineAgents().catch(() => {}), 60 * 1000);
}

if (require.main === module) {
  startServer().catch(error => { console.error(error); process.exit(1); });
}

module.exports = {
  app,
  conversationVisibilityWhere,
  getInitialStartUid,
  normalizeAiSettingPayload,
  serializeAiSettingRow,
  startServer,
};
