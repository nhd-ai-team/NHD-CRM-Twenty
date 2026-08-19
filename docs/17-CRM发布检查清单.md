# CRM 发布检查清单

适用范围：当前 Mac mini 部署的 NHD CRM / 对话工作台 / middleware / twenty-portal。

## 一、发布前代码检查

在仓库根目录执行：

```bash
export PATH=/opt/homebrew/bin:$PATH
cd "/Users/nhdailabcenter/Desktop/some agents/tools-claude/ai crm"
git status --short --branch
git diff --check
```

前端检查：

```bash
cd chat-ui
npm run build
npm run lint
```

middleware 检查：

```bash
cd ../middleware
node --check index.js
npm test
```

Nginx 检查：

```bash
cd ..
/usr/local/bin/docker exec twenty-twenty-portal-1 nginx -t
```

## 二、发布步骤

当前 Docker Hub 拉取基础镜像不稳定时，先采用运行容器热更新：

```bash
cd "/Users/nhdailabcenter/Desktop/some agents/tools-claude/ai crm"
/usr/local/bin/docker exec twenty-chat-ui-1 sh -lc "rm -rf /usr/share/nginx/html/chat/*"
/usr/local/bin/docker cp chat-ui/dist/. twenty-chat-ui-1:/usr/share/nginx/html/chat/
/usr/local/bin/docker exec twenty-middleware-1 sh -lc "rm -rf /app/lib && mkdir -p /app/lib"
/usr/local/bin/docker cp middleware/lib/. twenty-middleware-1:/app/lib/
/usr/local/bin/docker cp middleware/index.js twenty-middleware-1:/app/index.js
/usr/local/bin/docker restart twenty-middleware-1
/usr/local/bin/docker exec twenty-twenty-portal-1 nginx -s reload
```

注意：`nginx/twenty-portal.conf` 通过 bind mount 映射到容器。修改 `chat-nav.js?v=...` 版本号时，尽量保持版本字符串长度不变，避免容器内出现 `pread() returned only ... bytes` 的读取异常。

注入层发布（2026-08-19 起，chat-nav.js 已模块化）：

```bash
cd "/Users/nhdailabcenter/Desktop/some agents/tools-claude/ai crm/nginx/inject"
# ① 改源码：只改 src/*.js（chat-nav.js 是构建产物，勿手改）
# ② 构建 + 语法校验
node build-chat-nav.js && node --check chat-nav.js
# ③ jsdom 回归（本地有副本时）：699 宽侧栏 + 236 窄侧栏均 PASS
# ④ 部署：scp chat-nav.js 到真源 → 升级 conf 版本号 → reload → 4 处 md5 校验
scp chat-nav.js nhdailabcenter@192.168.118.105:"/Users/nhdailabcenter/Desktop/some agents/tools-claude/ai crm/nginx/inject/chat-nav.js"
ssh nhdailabcenter@192.168.118.105 'export PATH=/opt/homebrew/bin:$PATH; docker exec twenty-twenty-portal-1 nginx -s reload'
# ⑤ 校验 4 处 md5（本地 / macmini repo / 容器 / served）+ served 版本串
```

完整流程见 `twenty-inject-layer` 技能与 `docs/21`（2026-08-19 对齐记录）。

## 三、发布后验证

```bash
curl -sS http://127.0.0.1:3000/chat/ | grep -o 'assets/index-[^"]*\.js' | head -1
curl -sS http://127.0.0.1:3000/settings/profile | grep -o 'chat-nav.js?v=[^"]*' | head -1
curl -sS http://127.0.0.1:3000/conv-api/health
/usr/local/bin/docker exec twenty-middleware-1 node -e "const m=require('./lib/ai-settings'); if (typeof m.buildAiSettingResponses !== 'function') process.exit(1); console.log('ai-settings-lib-ok')"
curl -sS -o /tmp/ai-settings-batch-noauth.txt -w "%{http_code}" \
  -X PATCH http://127.0.0.1:3000/conv-api/ai-settings/batch \
  -H "Content-Type: application/json" \
  --data '{"settings":[]}'
cat /tmp/ai-settings-batch-noauth.txt
```

期望结果：

- `/chat/` 返回最新构建后的 `assets/index-*.js`。
- `/settings/profile` 返回当前发布的 `chat-nav.js?v=...`。
- `/conv-api/health` 返回 `{"status":"ok",...}`。
- 容器内 `buildAiSettingResponses` 校验输出 `ai-settings-lib-ok`，确认 middleware 运行态加载的是最新 `lib/ai-settings.js`。
- 未登录调用 `/conv-api/ai-settings/batch` 返回 `401`。

注入层稳定性回归（2026-08-19 起必须手测）：

- 打开 `/objects/opportunities`、`/objects/people`、`/settings/profile`、`/settings/profile#channels`，连续切换 10 次，不出现 Twenty 错误边界「抱歉，出了点问题」。
- 大表格页滚动、打开/关闭右侧抽屉、切换设置页左侧菜单时，左侧主菜单和设置菜单不应消失。
- 如果再次出现错误边界或空白页，先在浏览器控制台执行 `window.__NHD_ERRORS__` 查看最近错误；若有注入层堆栈，优先排查对应 `nginx/inject/src/*.js`，并继续遵守「禁止在 MutationObserver 同步回调里直接改 React DOM」。

## 四、当前工程边界与核心文档同步

- email 当前按公共邮箱处理，暂不做个人渠道权限收紧。
- Instagram / Facebook 当前未配置，暂不纳入本轮接入验收。
- `nginx/inject/chat-nav.js` 是运行态兼容层（2026-08-19 起为构建产物，源码在 `nginx/inject/src/*.js`）；Twenty 前端源码已存在 `/settings/accounts/channels` 原生页面。后续正式发布应优先走 Twenty 原生前端构建，逐步减少 Nginx DOM 注入。
- AI 自动回复配置必须通过弹窗底部保存按钮提交；批量保存接口 `/conv-api/ai-settings/batch` 应保持事务语义，避免部分渠道保存成功、部分失败。
- 每次发布到 main 前，至少同步检查以下核心文档：`README.md`、`DEV_PLAN.md`、`docs/02-当前进度与状态.md`、`docs/07-功能清单.md`、`docs/15-三维度字段统一与映射基线（2026-08-10）.md`、`docs/官网表单字段映射.md`、`docs/端到端业务场景测试用例.md`、`docs/22-当前实现功能与技术方案总览（2026-08-19）.md`。
