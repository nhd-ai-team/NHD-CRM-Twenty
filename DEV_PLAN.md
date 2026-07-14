# CRM 开发计划

> 最后更新：2026-07-14（会话工作台 UI 完成，已嵌入 Twenty 侧边栏）
> 当前分支：main

---

## 渠道选型结论

| 渠道 | 方案 | 费用 | 当前排期 |
|------|------|------|----------|
| WhatsApp 个人号 | **Evolution API**（开源自托管，Baileys 协议） | 免费 | Phase 3 MVP |
| 官网 Chatbot Widget | **自研**（WebSocket + 轻量 JS 组件） | 免费 | Phase 3 MVP |
| Instagram | Meta Graph API（官方，免费，需专业账号） | 免费 | Phase 6 |
| Facebook Messenger | Meta Graph API（官方，免费，需 FB 主页） | 免费 | Phase 6 |
| LinkedIn | 无可用方案 | — | 暂不做 |

**WhatsApp 个人号注意事项**

| 风险 | 说明 | 规避 |
|------|------|------|
| 封号风险 | 新号 2-3 个对话就可能被限制 | 用有历史记录的老号（建议 6 个月以上） |
| 登录方式 | 不是账号密码，是扫码或配对码 | 手机 WhatsApp → 已链接设备 → 扫码 |
| 发送频率 | 大量新建对话无回复触发风控 | 被动接收为主，发送间隔 ≥ 10 秒 |

---

## 当前状态

| 项目 | 状态 | 说明 |
|------|------|------|
| Twenty CRM 本地运行 | ✅ 完成 | OrbStack + Docker Compose，M4 Pro 24GB |
| 邮件归档（IMAP） | ✅ 完成 | 590+ 封，286 联系人 |
| Chatwoot 解耦 | ✅ 完成 | docker-compose / nginx / middleware 均已清理 |
| 公网访问 | ⚠️ 临时 | cloudflared 临时 URL，重启会变，域名待购买 |
| CRM 自定义字段 | 🔲 待做 | 外贸字段、商机阶段、成员权限 |
| Evolution API 接入 | 🔲 待做 | 未开始，等 Phase 1 公网域名 |
| 官网 Chatbot Widget | 🔲 待做 | 由其他同事负责 |
| CRM 会话工作台 UI | ✅ 完成 | React+Vite，mock 数据，嵌入 Twenty 侧边栏，`/chat/` 路径 |

---

## 技术决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| WhatsApp 渠道层 | Evolution API（开源自托管） | 免费，支持个人号，Docker 部署，REST API + Webhook，活跃维护 |
| 官网 Widget | 自研轻量 JS 组件 + WebSocket | 无第三方依赖，完全自控，嵌入供应商官网一行 script 标签 |
| 对话服务位置 | 扩展现有 middleware | 现阶段体量无需独立服务，减少运维复杂度 |
| 对话数据库 | PostgreSQL `conv` schema（复用现有 pg 容器） | 避免引入新容器，后续可独立迁移 |
| CRM 会话 UI | 独立 React 前端页面，nginx `/chat` 路径 | Twenty 无原生插件系统，独立页面最灵活 |
| 账号配置 UI | 独立管理页面 `/admin`，纯 HTML | Evolution API QR 接口直接展示，管理员专用 |
| 实时推送 | SSE（Server-Sent Events） | 比 WebSocket 简单，单向推送够用 |
| 公网方案 | cloudflared + Cloudflare 企业账号 | Mac mini 无公网 IP，Tunnel 稳定，企业账号固定域名 |
| 前端框架 | React + Vite | 会话工作台 UI 有一定交互复杂度 |

---

## 架构概览

```
浏览器（销售 / 管理员）
  │
  ▼
localhost:3000  ←─ nginx（twenty-portal 容器）
  │
  ├─ /          → Twenty CRM（server 容器，:3000）
  ├─ /ws        → Twenty WebSocket（server 容器）
  ├─ /chat/     → 对话工作台（chat-ui 容器，:3003，Vite 开发服务器）
  │    ├─ /chat/__vite_hmr → HMR WebSocket（开发热重载）
  │    └─ /@vite/@react-refresh → Vite 内部依赖
  ├─ /conv-api/ → 对话服务 API（middleware 容器，:3002）[Phase 3+]
  ├─ /ws/widget → Widget WebSocket（middleware 容器）[Phase 3-B]
  ├─ /widget.js → 官网嵌入脚本（nginx 静态文件）[Phase 3-B]
  ├─ /admin     → 账号配置页面（nginx 静态文件）[Phase 4]
  └─ /api/      → middleware REST API（middleware 容器）[Phase 3+]
         │
         ├─ PostgreSQL（db 容器）
         │    ├─ schema: default（Twenty 数据）
         │    ├─ schema: conv（对话服务数据）[Phase 3 新建]
         │    └─ database: evolution（Evolution API）[Phase 3-A 新建]
         ├─ Redis（redis 容器）
         └─ Evolution API（evolution-api 容器，:8080）[Phase 3-A]
```

### 会话工作台嵌入方案（已完成）

**嵌入方式**：nginx 同源路径（`/chat/`），通过 Twenty 数据库注入导航菜单项。不使用 iframe，不修改 Twenty 源码。

**访问路径**：`http://localhost:3000/chat/`（生产：`https://crm.[域名]/chat/`）

**Twenty 侧边栏导航**：直接写入 `core.navigationMenuItem` 表（`type=LINK`，`icon=IconMessages`，`color=purple`），Twenty 前端自动渲染为侧边栏入口。

**生产切换**（当前开发模式用 Vite 热重载，上线前执行）：
```bash
# 在 chat-ui/ 目录
npm run build          # 产出 dist/
# docker-compose.yml 中改为 nginx:alpine 静态服务，挂载 dist/
# 去掉 /@vite/@react-refresh 的 nginx location 块
```

**主题同步**：`useTheme.js` hook 读取 Twenty 存入 `localStorage` 的颜色方案（尝试 `colorScheme`、`twenty-color-scheme`、`theme` 三个键），写入 `<html data-theme>` 属性，与 Twenty 深色 / 浅色模式同步切换。

---

## 阶段划分

```
Phase 1  Cloudflare 稳定公网          ← 解除公网阻塞【域名待购买，暂缓】
Phase 2  CRM 基础完善                 ← 字段/阶段/权限，当前可做
Phase 3  WhatsApp + 官网 Widget MVP   ← 对话服务核心，两个渠道并行验证
Phase 4  账号配置 UI                  ← 管理员扫码绑定 WhatsApp，查看连接状态
Phase 5  CRM 会话工作台 UI            ← 销售在 CRM 内查看/回复全渠道会话
Phase 6  Instagram / Facebook 扩展    ← Meta Graph API，需专业账号/主页
Phase 7  官网表单接入                  ← 留资自动建联系人/商机
Phase 8  AI 客服能力层                ← RAG + 自动回复（远期）
```

---

## Phase 1 · Cloudflare 稳定公网

**目标**：Mac mini 通过固定域名对外可访问，Evolution API Webhook 和官网 Widget WebSocket 均可达。

> ⚠️ **当前阻塞**：域名未购买，本 Phase 暂缓。Phase 3 的 Webhook 和 Widget 均依赖公网 URL。
> 域名购买并托管到 Cloudflare DNS 后，按以下步骤配置。

**前置条件**：
- [ ] 购买域名并托管到 Cloudflare DNS（如 `chinanhd.com`）
- [ ] 确认对外使用的子域名（如 `crm.chinanhd.com`）

### 任务清单

```bash
# 安装 cloudflared
brew install cloudflare/cloudflare/cloudflared

# 登录（打开浏览器授权）
cloudflared tunnel login

# 创建 Tunnel
cloudflared tunnel create nhd-crm-tunnel

# 注册为系统服务（Mac mini 重启后自动恢复）
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

`~/.cloudflared/config.yml`（所有服务统一走 nginx，单域名多路径）：

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /Users/<username>/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: crm.[域名]
    service: http://localhost:3000   # nginx 统一入口
  - service: http_status:404
```

Cloudflare DNS → 添加 CNAME：`crm` → `<TUNNEL_UUID>.cfargotunnel.com`（Proxied）

更新 `.env`：
```
SERVER_URL=https://crm.[域名]
```

重启容器：`docker compose down && docker compose up -d`

### 验收标准
- [ ] `https://crm.[域名]` 可访问 Twenty，HTTPS 正常
- [ ] `https://crm.[域名]/health` 返回 `{"status":"ok"}`
- [ ] Mac mini 重启后 URL 不变，服务自动恢复

---

## Phase 2 · CRM 基础完善

**目标**：Twenty 配置成外贸业务可用状态。**当前可立即开始，不依赖公网。**

### 2-1 People 自定义字段

**Settings → Data model → People**：

| 字段名 | 类型 | 写入方 |
|--------|------|--------|
| 来源渠道 | Select（WhatsApp / 官网 / Instagram / Facebook / 邮件 / 其他） | 对话服务自动 / 手动 |
| 所属洲 | Select（亚洲 / 欧洲 / 北美 / 南美 / 非洲 / 大洋洲） | 手动 |
| 意向等级 | Select（A 高意向 / B 跟进中 / C 观望 / 无效） | 销售评定 |
| WhatsApp 号码 | Phone | 对话服务同步 |
| 主要沟通语言 | Select（英语 / 西班牙语 / 法语 / 阿拉伯语 / 其他） | 手动 |
| 感兴趣产品 | Text | 对话服务同步（AI 摘要，远期） |
| 最近会话时间 | DateTime | 对话服务写入 |
| 最近会话摘要 | Text | 对话服务写入 |
| 对话服务 Contact ID | Text | 对话服务绑定 |

### 2-2 商机阶段

**Settings → Data model → Opportunities → Stage**：

`线索 → 询价 → 报价 → 寄样 → 谈判 → 已下单 → 已付款 → 已发货 → 已成交 → 丢单`

### 2-3 成员账号 & 权限

- 创建 Sales 角色账号，隐藏报价金额、利润等敏感字段
- 管理员角色全量访问

### 2-4 邮件 Blocklist

**Settings → Accounts → Blocklist**：添加内部域名，过滤无效联系人

### 2-5 Conversation 自定义对象（Phase 3 预建）

**Settings → Data model → + New object**，对象名 `Conversation`：

| 字段 | 类型 |
|------|------|
| 渠道类型 | Select（whatsapp / website / instagram / facebook） |
| 会话状态 | Select（open / takeover / closed） |
| 最后消息摘要 | Text |
| 最后消息时间 | DateTime |
| 对话服务会话 ID | Text |
| 关联联系人 | Relation → People（多对一） |

### 验收标准
- [ ] 可按"来源渠道"、"意向等级"筛选联系人
- [ ] 商机看板显示 10 个阶段
- [ ] 内部邮件不生成无效联系人
- [ ] `Conversation` 自定义对象存在

---

## Phase 3 · WhatsApp + 官网 Widget MVP

**目标**：两个渠道并行跑通完整收发链路，消息同步到 Twenty CRM。

**前置条件**：
- [ ] Phase 1（公网域名）完成
- [ ] Phase 2 中 `Conversation` 自定义对象已建好
- [ ] 准备好测试用 WhatsApp 号（有历史记录的老号）

---

### 3-A · Evolution API（WhatsApp）

#### 架构

```
客户 WhatsApp 消息
  → Evolution API（Docker，本机运行）
  → Webhook → middleware POST /api/whatsapp/webhook
  → 写入 conv DB
  → 同步 Twenty CRM

销售回复（从 /chat 页面）
  → middleware POST /api/conversations/:id/messages
  → Evolution API REST → 发回 WhatsApp
```

#### 3-A-1 添加 Evolution API 容器

`docker-compose.yml` 新增服务：

```yaml
evolution-api:
  image: atendai/evolution-api:v2.3.7
  ports:
    - "8080:8080"
  volumes:
    - evolution-data:/evolution/instances
  environment:
    SERVER_URL: http://evolution-api:8080
    AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY}
    DATABASE_ENABLED: "true"
    DATABASE_PROVIDER: postgresql
    DATABASE_CONNECTION_URI: postgres://${PG_DATABASE_USER:-postgres}:${PG_DATABASE_PASSWORD}@db:5432/evolution
    WEBHOOK_GLOBAL_URL: http://middleware:3002/api/whatsapp/webhook
    WEBHOOK_GLOBAL_ENABLED: "true"
    WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS: "false"
  depends_on:
    db:
      condition: service_healthy
  restart: always
```

在 pg 容器建数据库：
```bash
docker exec -it <pg_container> psql -U postgres -c "CREATE DATABASE evolution;"
```

`.env` 新增：
```
EVOLUTION_API_KEY=<自定义一个随机字符串>
EVOLUTION_API_URL=http://evolution-api:8080
```

#### 3-A-2 创建 WhatsApp 实例并扫码连接

```bash
# 创建实例（instance 名自定义，如 "nhd-whatsapp"）
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: <EVOLUTION_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"instanceName": "nhd-whatsapp", "qrcode": true}'

# 获取 QR 码（base64 图片，在浏览器或 /admin 页面展示）
curl http://localhost:8080/instance/connect/nhd-whatsapp \
  -H "apikey: <EVOLUTION_API_KEY>"
```

手机 WhatsApp → 设置 → 已链接的设备 → 扫码

#### 3-A-3 middleware Webhook 实现

`middleware/routes/whatsapp.js`：

```
POST /api/whatsapp/webhook
  - 解析 Evolution API 推送的事件
  - 事件类型：messages.upsert（新消息）/ connection.update（连接状态）
  - 幂等写入 conv.messages（按 Evolution message.key.id 去重）
  - 查找或创建 conv.contacts（按 remoteJid / 手机号）
  - 查找或创建 conv.conversations
  - 同步到 Twenty：
      · findPersonByPhone → 没有则 createPerson（姓名用 pushName，手机号用 remoteJid 去掉 @s.whatsapp.net）
      · upsert Twenty Conversation 对象
      · 更新 People 最近会话时间 / 摘要
```

发送消息（调 Evolution API）：

```javascript
// middleware 内调用
async function sendWhatsAppMessage(instanceName, to, text) {
  await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: {
      'apikey': EVOLUTION_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ number: to, text }),
  });
}
```

---

### 3-B · 官网 Chatbot Widget（自研）

#### 架构

```
客户访问供应商官网
  → 页面加载 <script src="https://crm.[域名]/widget.js">
  → Widget 展示悬浮按钮，客户点击打开聊天窗口
  → WebSocket 连接 wss://crm.[域名]/ws/widget
  → 客户发消息 → middleware 存入 conv DB（channel=website）
  → SSE 推送到 /chat 页面 → 销售看到消息
  → 销售回复 → middleware → WebSocket → widget 实时更新
```

#### 3-B-1 middleware WebSocket 端点

在 `middleware/index.js` 添加 WebSocket 支持：

```bash
npm install ws
```

```javascript
// WebSocket server（挂在 HTTP server 上）
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true });

// 路径 /ws/widget
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/widget') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

wss.on('connection', (ws, req) => {
  // 1. 分配 visitor session ID（cookie 或 URL param）
  // 2. 查找或创建 conv.contacts（channel=website）
  // 3. 查找或创建 conv.conversations
  // 4. 收到消息 → 写入 conv.messages → SSE 通知 /chat 页面
  // 5. 销售回复时通过 ws.send() 推回 widget
});
```

#### 3-B-2 conv DB 新增 website 支持

`conv.contacts` 表 `channel` 字段已支持 `website`，额外增加 `visitor_id` 字段（本地 localStorage 存储的访客 ID）：

```sql
ALTER TABLE conv.contacts ADD COLUMN visitor_id TEXT;
CREATE UNIQUE INDEX ON conv.contacts (visitor_id) WHERE visitor_id IS NOT NULL;
```

#### 3-B-3 Widget 前端（widget.js）

打包为单文件（Vite library 模式），供应商官网嵌入：

```html
<!-- 供应商官网 HTML 里加这一行 -->
<script src="https://crm.[域名]/widget.js" data-color="#1A5CA8"></script>
```

Widget 功能：
- 悬浮按钮（右下角），点击展开聊天窗
- 消息气泡（区分客户/客服消息）
- 发送输入框
- 支持配置主题色（`data-color`）
- 访客 ID 存 `localStorage`，刷新页面后恢复同一会话
- 连接断开自动重连

#### 3-B-4 nginx 配置更新（Phase 3）

`nginx/twenty-portal.conf` 新增：

```nginx
# Widget JS 文件
location /widget.js {
    alias /etc/nginx/html/widget/widget.js;
    add_header Access-Control-Allow-Origin *;  # 供应商官网跨域请求
    add_header Cache-Control "public, max-age=3600";
}

# WebSocket（Widget 实时通信）
location /ws/widget {
    proxy_pass http://middleware:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

#### 3-B-5 conv DB 核心表（WhatsApp + Website 共用）

```sql
CREATE SCHEMA IF NOT EXISTS conv;

CREATE TABLE conv.contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       TEXT NOT NULL,          -- 'whatsapp' | 'website' | 'instagram' | 'facebook'
  external_id   TEXT,                   -- WhatsApp: remoteJid；website: visitor_id
  display_name  TEXT,
  phone         TEXT,
  email         TEXT,
  twenty_person_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (channel, external_id)
);

CREATE TABLE conv.conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel               TEXT NOT NULL,
  external_chat_id      TEXT,           -- WhatsApp: chatId；website: session UUID
  contact_id            UUID REFERENCES conv.contacts(id),
  status                TEXT DEFAULT 'open',  -- 'open' | 'takeover' | 'closed'
  agent_id              TEXT,
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,
  twenty_conv_id        TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (channel, external_chat_id)
);

CREATE TABLE conv.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_msg_id TEXT,                 -- 幂等键（WhatsApp message key；website 自生成）
  conversation_id UUID REFERENCES conv.conversations(id),
  sender_type     TEXT NOT NULL,        -- 'customer' | 'agent' | 'ai'
  sender_id       TEXT,
  content         TEXT,
  content_type    TEXT DEFAULT 'text',  -- 'text' | 'image' | 'file'
  media_url       TEXT,
  sent_at         TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (external_msg_id) WHERE external_msg_id IS NOT NULL
);

CREATE TABLE conv.audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conv.conversations(id),
  action          TEXT NOT NULL,        -- 'takeover'|'release'|'close'|'agent_reply'|'ai_reply'
  actor_id        TEXT,
  detail          JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Phase 3 验收标准

**WhatsApp**：
- [ ] WhatsApp 发来消息 → `conv.messages` 有记录
- [ ] Twenty People 页出现对应 `Conversation` 记录
- [ ] `最近会话时间`、`最近会话摘要` 自动更新
- [ ] 重复 Webhook 事件不产生重复记录
- [ ] 调 API 回复 → WhatsApp 收到消息

**官网 Widget**：
- [ ] 供应商官网嵌入 `widget.js` 后显示聊天按钮
- [ ] 客户发消息 → middleware 收到 → `conv.messages` 有记录
- [ ] 刷新页面后访客恢复同一会话（localStorage visitor_id）
- [ ] 销售回复后 Widget 实时收到消息（WebSocket）

---

## Phase 4 · 账号配置 UI

**目标**：管理员在 `/admin` 页面查看 Evolution API WhatsApp 连接状态，断线后可重新扫码。

### 架构

```
管理员访问 /admin
  → 展示 WhatsApp 实例连接状态（调 Evolution API GET /instance/fetchInstances）
  → 状态=未连接 → 展示 QR 码（调 Evolution API GET /instance/connect/:instance）
  → 管理员扫码 → 状态变为 open（已连接）
  → 页面每 5 秒轮询状态刷新
```

### middleware 新增接口

```
GET  /api/admin/whatsapp/status     → Evolution API 实例列表 + 连接状态
GET  /api/admin/whatsapp/qrcode     → QR 码 base64（仅未连接时返回）
POST /api/admin/whatsapp/disconnect → 断开实例
```

### 前端（/admin，纯 HTML）

- WhatsApp 状态卡片：图标 + 手机号 + 状态颜色标签（绿=已连接，红=已断开）
- 未连接时展示 QR 码图片，5 秒自动刷新
- 已连接时展示"断开连接"按钮

### nginx 更新

```nginx
location /admin {
    alias /etc/nginx/html/admin/;
    try_files $uri /admin/index.html;
}
location /admin-api/ {
    proxy_pass http://middleware:3002/api/admin/;
    proxy_set_header Host $host;
}
```

### 验收标准
- [ ] `/admin` 显示 WhatsApp 连接状态
- [ ] 未连接时显示 QR 码，扫码后状态变绿
- [ ] Evolution API 重启后管理员可在此页面重新连接

---

## Phase 5 · CRM 会话工作台 UI ✅ UI 已完成（mock 数据），待接真实 API

**目标**：销售在 `/chat` 页面查看所有渠道会话、回复、接管，从 Twenty 联系人记录页一键跳转。

### 已完成（2026-07-14）

**技术栈**：React 18 + Vite 5 + Tailwind CSS v4 + lucide-react + date-fns

**文件结构**（`chat-ui/src/`）：
```
data/mock.js                  ← 6 条 mock 会话（WhatsApp×5 + 官网×1），Phase 3 后替换为 API 调用
hooks/useTheme.js             ← 同步 Twenty localStorage 颜色方案
hooks/useConversations.js     ← 会话状态管理（筛选/发送/接管/关闭）
components/ChannelIcon.jsx    ← WhatsApp / 官网 / Facebook / Instagram SVG 图标
components/ConversationSidebar.jsx ← 左栏：渠道 Tab、搜索、状态筛选、会话卡片
components/ChatPanel.jsx      ← 中栏：消息气泡、输入工具栏、操作栏
components/ContactPanel.jsx   ← 右栏：联系人信息、资料/话术/物料/翻译 Tab
components/ConvertToLeadDrawer.jsx ← 「转为线索」侧滑抽屉（预填联系人信息）
App.jsx                       ← 三栏布局组装
main.jsx                      ← 入口，挂载 useTheme
index.css                     ← Twenty 兼容 CSS 变量（亮/暗双主题）
```

**已实现功能**：
- 三栏布局（左 320px 固定 / 中弹性 / 右 300px 固定）
- 渠道 Tab 过滤（全部 / WhatsApp / 官网）+ 未读数角标
- 状态过滤（全部 / 未读 / 进行中 / 人工接管 / 已关闭）
- 联系人搜索（姓名 / 电话 / 最后消息）
- 消息气泡（客户左、客服右紫、AI 右淡紫、系统居中）
- 输入栏：Enter 发送、Shift+Enter 换行、语言选择器占位
- 操作栏：接管 / 释放接管 / 结束会话 / 转为线索 / AI 回复配置（占位）
- 「转为线索」抽屉：预填姓名/电话/公司，提交后 console.log（Phase 3 接真实 API）
- 右栏：联系人资料、渠道类型、建档状态标签、编辑/查看 CRM/转为线索按钮
- 深色 / 浅色主题自动跟随 Twenty

**当前限制（Phase 3 对接后解除）**：
- 数据来自 `mock.js`，刷新后重置
- 发送的消息不会真正送出到 WhatsApp / 官网
- 「转为线索」不会在 Twenty 创建联系人
- 无 SSE 实时推送（新消息不自动出现）

### Phase 3 后需补充的 API 对接工作

```
useConversations.js 中将 useState(CONVERSATIONS) 替换为：

useEffect(() => {
  fetch('/conv-api/conversations')
    .then(r => r.json()).then(setConversations)
}, [])

// SSE 实时推送
useEffect(() => {
  const es = new EventSource('/conv-api/events')
  es.onmessage = e => {
    const event = JSON.parse(e.data)
    if (event.type === 'new_message') { /* append message */ }
    if (event.type === 'new_conversation') { /* prepend conv */ }
  }
  return () => es.close()
}, [])

// sendMessage 中将 mock 逻辑改为：
await fetch(`/conv-api/conversations/${convId}/messages`, {
  method: 'POST',
  body: JSON.stringify({ content: text }),
  headers: { 'Content-Type': 'application/json' },
})

// ConvertToLeadDrawer 提交改为：
await fetch('/conv-api/leads', {
  method: 'POST',
  body: JSON.stringify({ convId: conv.id, ...form }),
  headers: { 'Content-Type': 'application/json' },
})
```

### 对话服务接口（middleware 实现，Phase 3）

```
GET  /api/conversations                   - 会话列表（channel / status 筛选）
GET  /api/conversations/:id/messages      - 消息历史
POST /api/conversations/:id/messages      - 发送消息（转发至 Evolution API / Widget WS）
POST /api/conversations/:id/takeover      - 接管（action: takeover | release）
POST /api/leads                           - 从会话创建 Twenty 联系人（转为线索）
GET  /api/events                          - SSE 实时推送（新消息 / 状态变化）
```

### Twenty 侧边栏导航（已完成）

已通过 SQL 插入 `core.navigationMenuItem`：
- 名称：对话工作台
- 图标：IconMessages（Twenty 内置图标集）
- 颜色：purple
- 链接：`/chat/`
- 位置：7（在现有菜单项末尾）

### 生产部署切换

```bash
# 当前：Vite 开发服务器（chat-ui 容器）
# 生产：nginx 静态文件

# 1. 本机构建
cd chat-ui && npm run build   # → dist/

# 2. docker-compose.yml 中 chat-ui 服务改为：
chat-ui:
  image: nginx:alpine
  volumes:
    - ./chat-ui/dist:/usr/share/nginx/html/chat:ro
  restart: always

# 3. nginx/twenty-portal.conf 中 /chat/ 块改为：
location /chat/ {
    alias /path/to/chat-ui/dist/;
    try_files $uri /chat/index.html;
}
# 删除 /@vite/@react-refresh 的 location 块
```

### 验收标准
- [x] `/chat/` 显示会话列表（mock 数据）
- [x] 渠道 / 状态 / 搜索筛选正常
- [x] 发送消息显示在气泡列表（mock）
- [x] 接管 / 释放 / 结束 状态切换正常
- [x] 「转为线索」抽屉打开、预填、提交
- [x] Twenty 侧边栏出现「对话工作台」入口
- [x] `localhost:3000/chat/` 通过 nginx 访问正常
- [ ] 接真实 API（Phase 3 完成后）
- [ ] SSE 实时推送（Phase 3 完成后）
- [ ] Twenty 联系人页链接跳转到对应会话（Phase 3 完成后）

---

## Phase 6 · Instagram / Facebook Messenger 扩展

**目标**：接入 Meta 官方 Graph API，实现被动接收 Instagram DM 和 Facebook 主页消息。

**前置条件**：
- [ ] Instagram 账号切换为专业账号（设置 → 账号类型 → 商家/创作者，免费可逆）
- [ ] 公司 Facebook 主页已创建（Messenger 必须通过主页）
- [ ] Meta 开发者账号注册（[developers.facebook.com](https://developers.facebook.com)）
- [ ] 创建 Facebook App，申请 `instagram_manage_messages` + `pages_messaging` 权限

### 架构（Meta Graph API Webhook）

```
Instagram DM / Facebook 主页消息
  → Meta 服务器
  → Webhook POST /api/meta/webhook
  → middleware 解析事件类型（messaging）
  → 同一套 conv DB 写入（channel=instagram / channel=facebook）
  → 回复：POST graph.facebook.com/v19.0/me/messages
```

### middleware 新增接口

```
GET  /api/meta/webhook   - Webhook 订阅验证（Meta 要求 GET 验证 hub.challenge）
POST /api/meta/webhook   - 接收 Instagram / Facebook 消息事件
```

`.env` 新增：
```
META_APP_SECRET=<Facebook App Secret>
META_PAGE_ACCESS_TOKEN=<Page Access Token>
META_VERIFY_TOKEN=<自定义验证 Token>
```

### 验收标准
- [ ] Instagram DM 触发 Webhook，`conv.messages` 有记录（channel=instagram）
- [ ] Facebook 主页消息触发 Webhook，记录正确
- [ ] `/chat` 页面 Tab 新增 Instagram / Facebook 渠道
- [ ] 销售可在 `/chat` 回复 Instagram DM 和 Facebook 消息

---

## Phase 7 · 官网表单接入

**目标**：官网询盘表单留资自动创建 CRM 联系人、公司、商机。

实现 `POST /api/leads`（middleware 已预留占位）：

```
接收字段：name / email / phone / company / country / product_interest / message
处理逻辑：
  1. 按 email 查 Twenty People → 存在则更新，不存在则创建
  2. 按公司名查 Twenty Companies → 存在则关联，不存在则创建
  3. 创建 Opportunity（stage=线索，来源渠道=官网）
  4. 创建 Note（原始留言内容）
安全：官网前端只调用 /api/leads，不持有任何 API Key
```

---

## Phase 8 · AI 客服能力层（远期）

前置：Phase 6 完成，多渠道稳定运行 30 天以上。参见 PRD Section 07。

---

## 待补充信息

| # | 待确认项 | 影响 | 状态 |
|---|----------|------|------|
| 1 | 购买域名 + 托管 Cloudflare DNS | 阻塞 Phase 1，进而阻塞 Phase 3+ | 🔲 |
| 2 | 选定测试用 WhatsApp 号（老号，有历史记录） | Phase 3 扫码绑定 | 🔲 |
| 3 | Facebook 主页是否已有 / 需要新建 | Phase 6 | 🔲 |
| 4 | Instagram 切换专业账号 | Phase 6 | 🔲 |

---

## 技术栈汇总

| 层 | 技术 | 版本/说明 |
|----|------|-----------|
| 公网接入 | Cloudflare Tunnel（cloudflared） | 企业账号，固定域名 |
| 反向代理 | Nginx（Docker） | 统一入口，路径路由 |
| CRM | Twenty（Docker） | 开源自托管 |
| 对话服务 | Node.js Express（middleware 扩展） | 复用现有容器 |
| 对话数据库 | PostgreSQL `conv` schema | 复用现有 pg 容器 |
| WhatsApp 渠道 | Evolution API v2（Docker） | 开源，Baileys，免费 |
| 官网 Widget | 自研（Vite library 模式打包） | 单文件 JS，跨域 CORS |
| Instagram/FB 渠道 | Meta Graph API Webhook | 官方，免费，Phase 6 |
| 实时推送（内部） | SSE | CRM /chat 页面订阅 |
| 实时推送（Widget） | WebSocket（ws 库） | Widget ↔ middleware |
| 会话工作台 UI | React + Vite | `/chat` 路径 |
| 账号配置 UI | 纯 HTML | `/admin` 路径 |
| Mac mini | Apple M4 Pro 24GB / 110GB 可用 | 资源充足 |

---

## 文件结构（当前实际状态）

```
ai crm/
├── docker-compose.yml              ← 当前服务：server/worker/db/redis/twenty-portal/middleware/chat-ui
├── .env                            ← 不提交 git（含 TWENTY_API_KEY 等敏感信息）
├── DEV_PLAN.md                     ← 本文件
├── nginx/
│   ├── twenty-portal.conf          ← 已含 /chat/ 路由
│   └── _archive/                   ← 归档旧 chatwoot 配置
├── middleware/
│   ├── index.js                    ← 已清理 Chatwoot，含 /health + /api/leads 占位
│   └── package.json
├── chat-ui/                        ← ✅ 已完成，React+Vite 会话工作台
│   ├── Dockerfile.dev              ← 开发容器（npm run dev，热重载）
│   ├── vite.config.js              ← base: '/chat/'，host: true，HMR 路径
│   ├── package.json
│   └── src/
│       ├── index.css               ← Twenty CSS 变量（亮/暗）
│       ├── main.jsx                ← 入口 + useTheme
│       ├── App.jsx                 ← 三栏布局
│       ├── data/mock.js            ← 6 条 mock 会话（Phase 3 后替换）
│       ├── hooks/
│       │   ├── useTheme.js
│       │   └── useConversations.js
│       └── components/
│           ├── ChannelIcon.jsx
│           ├── ConversationSidebar.jsx
│           ├── ChatPanel.jsx
│           ├── ContactPanel.jsx
│           └── ConvertToLeadDrawer.jsx
│
│   ── 以下为后续阶段规划 ──────────────────────────────────────────────
│
├── middleware/routes/              ← Phase 3+ 逐步新增
│   ├── whatsapp.js                 ← Phase 3-A（Evolution API Webhook）
│   ├── widget.js                   ← Phase 3-B（WebSocket 处理）
│   ├── conversations.js            ← Phase 5 API（供 /chat 前端调用）
│   ├── admin.js                    ← Phase 4
│   ├── meta.js                     ← Phase 6
│   └── leads.js                    ← Phase 7（现已有占位）
├── middleware/db/migrations/
│   ├── 001_conv_schema.sql         ← Phase 3（contacts/conversations/messages/audit_log）
│   └── 002_website_visitor_id.sql  ← Phase 3-B
├── widget/                         ← Phase 3-B，官网嵌入 JS（其他同事负责）
└── admin-ui/                       ← Phase 4，账号配置页面
    └── index.html
```
