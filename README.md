# Twenty CRM 项目 · 总览

> 📌 **打开这个文件夹先看这里。** 本文件是整个项目的入口，快速了解现状后，按需查看 `docs/` 里的详细文档。

最后更新：2026-09-01

---

## 一句话说明

用开源 CRM「**Twenty**」给外贸业务搭一套客户管理系统，本地 Docker 部署（macmini），已接入多渠道会话（WhatsApp / 官网客服 / 官网表单）、网易企业邮箱邮件归档、OpenRouter AI，并与公司官网打通实现自动获客。

---

## 当前状态（一眼看懂）

| 项目 | 状态 |
|---|---|
| 部署方式 | macmini Docker（compose 项目名 `twenty`，OrbStack） |
| 访问地址 | 公网 https://crm.chinanhd.com（Cloudflare 隧道） / 内网 http://localhost:3000 |
| 运行是否稳定 | ✅ 稳定 |
| 多渠道会话 | ✅ WhatsApp 多账号（每销售独立 Session）+ 官网客服 Widget + 官网表单 |
| 官网会话来源信息 | ✅ 官网会话可沉淀并展示访客 IP 推断地域、时区、访问页、referrer、UTM |
| 会话权限 RBAC | ✅ 销售看本人 / 主管看团队 / 管理员看全部 / boss 仅查看 |
| 沟通状态（duiHuaLiShi） | ✅ 会话档案对象 + 详情内联文本弹窗；对话工作台支持按关键词查看消息和附件历史 |
| 注入层 chat-nav.js | ✅ 已模块化（`nginx/inject/src/*.js` + 构建脚本），tick 节流 + 功能注册表 |
| 邮箱同步 | ✅ 已接入 `sales@chinanhd.com`，590+ 封邮件已归档 |
| AI 模型 | ✅ 已接入 OpenRouter（可用 Claude/GPT/Gemini） |
| 数据备份 | ✅ 有备份，存在 `backup/` |
| 是否可对外/公网访问 | ✅ 可（Cloudflare 隧道 `crm.chinanhd.com`） |
| 交还会话稳定性 | ✅ 已修复确认弹窗 `permissions` 作用域错误导致的工作台白屏 |

---

## 这个文件夹里有什么

```
ai crm/
├── README.md              ← 你正在看的总入口
├── docker-compose.yml     ← 系统启动配置（核心文件，勿随意改）
├── .env                   ← 密钥配置（含数据库密码、加密密钥，勿泄露）
├── DEV_PLAN.md            ← 开发计划与阶段划分
├── middleware/            ← 对话服务中间件（index.js + lib/ + sql/）
├── nginx/
│   ├── twenty-portal.conf ← 门户 nginx 配置（含 chat-nav.js 注入）
│   └── inject/            ← 注入层脚本
│       ├── src/           ← chat-nav.js 源码模块（9 个，改这里）
│       ├── build-chat-nav.js ← 构建脚本：src/*.js → chat-nav.js
│       └── chat-nav.js    ← 构建产物（勿手改）
├── chat-ui/               ← 对话工作台 React 前端
├── backup/                ← 数据备份（数据库 + 文件），恢复时用
└── docs/                  ← 详细文档，按主题分（01~23）
```

---

## 我现在想做什么？→ 去哪看

| 你的需求 | 打开这个文档 |
|---|---|
| 想了解这项目是干嘛的、为什么做 | `docs/01-项目背景与目的.md` |
| 想知道现在做到哪一步了 | `docs/02-当前进度与状态.md` |
| **操作前必看**：有哪些坑不能踩 | `docs/03-注意事项与踩过的坑.md` |
| 怎么启动/重启/备份/升级系统 | `docs/04-操作手册.md` |
| 邮箱同步怎么回事、怎么维护 | `docs/05-邮箱同步说明.md` |
| 以后官网 AI 客服怎么对接 | `docs/06-未来规划.md` |
| 全渠道会话与 AI 客服方案 | `08-多渠道会话与AI客服方案.md` |
| WhatsApp 多账号与 RBAC 设计 | `docs/12-WhatsApp多账号绑定与RBAC设计方案.md` |
| 沟通状态表单 + 协办人设计/实施 | `docs/19` / `docs/20` |
| 当前实现功能与技术方案总览 | `docs/22-当前实现功能与技术方案总览（2026-08-19）.md` |
| 代码与文档对齐记录 | `docs/18`（08-18）、`docs/21`（08-19）、`docs/23`（08-24）、`docs/25`（08-31）、`docs/26`（09-01）、`docs/27`（09-01） |

---

## ⚠️ 三条最重要的提醒（务必记住）

1. **不要随便断开/重连邮箱账户** —— 会触发网易限流，导致同步失败。现在正常，别碰它。
2. **改任何配置或数据前先备份** —— 用 `docs/04` 里的备份命令，数据无价。
3. **改注入层脚本只改 `nginx/inject/src/*.js`** —— `chat-nav.js` 是构建产物，改完跑 `node build-chat-nav.js` 再部署（见 `docs/21` 与 `twenty-inject-layer` 技能）。

4. **推送 GitHub 前先同步文档** —— 至少更新 README、`docs/22`、`docs/17`、端到端测试和当次对齐记录，并完成构建与发布验证。
