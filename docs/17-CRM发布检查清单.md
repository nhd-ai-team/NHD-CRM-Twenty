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
/usr/local/bin/docker cp middleware/lib twenty-middleware-1:/app/lib
/usr/local/bin/docker cp middleware/index.js twenty-middleware-1:/app/index.js
/usr/local/bin/docker restart twenty-middleware-1
/usr/local/bin/docker exec twenty-twenty-portal-1 nginx -s reload
```

注意：`nginx/twenty-portal.conf` 通过 bind mount 映射到容器。修改 `chat-nav.js?v=...` 版本号时，尽量保持版本字符串长度不变，避免容器内出现 `pread() returned only ... bytes` 的读取异常。

## 三、发布后验证

```bash
curl -sS http://127.0.0.1:3000/chat/ | grep -o 'assets/index-[^"]*\.js' | head -1
curl -sS http://127.0.0.1:3000/settings/profile | grep -o 'chat-nav.js?v=[^"]*' | head -1
curl -sS http://127.0.0.1:3000/conv-api/health
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
- 未登录调用 `/conv-api/ai-settings/batch` 返回 `401`。

## 四、当前工程边界

- email 当前按公共邮箱处理，暂不做个人渠道权限收紧。
- Instagram / Facebook 当前未配置，暂不纳入本轮接入验收。
- `nginx/inject/chat-nav.js` 是运行态兼容层；Twenty 前端源码已存在 `/settings/accounts/channels` 原生页面。后续正式发布应优先走 Twenty 原生前端构建，逐步减少 Nginx DOM 注入。
- AI 自动回复配置必须通过弹窗底部保存按钮提交；批量保存接口 `/conv-api/ai-settings/batch` 应保持事务语义，避免部分渠道保存成功、部分失败。
