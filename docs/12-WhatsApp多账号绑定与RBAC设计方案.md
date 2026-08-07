# WhatsApp 多账号绑定与 RBAC 可见性设计方案

> 版本：v2.1（研发评审版）\
> 日期：2026-08-06\
> 范围：同 workspace 内，每销售绑定自己的 WhatsApp 账号

------------------------------------------------------------------------

# 1. 目标与范围

## 1.1 目标

在同一 CRM workspace 内：

-   每个销售可在「设置 → 我的渠道」绑定自己的 WhatsApp 账号；
-   每个 WhatsApp 账号对应独立 WAHA Session；
-   客户私聊自动进入对应销售工作台；
-   销售只能查看和操作自己的客户会话；
-   管理员根据 RBAC 权限查看全部或指定范围会话。

## 1.2 本期不做

-   邮箱多账号绑定；
-   多租户隔离；
-   WhatsApp 群聊；
-   状态广播。

------------------------------------------------------------------------

# 2. 总体架构

    Twenty
     |
     | 用户身份认证
     ↓
    middleware
     |
     | Access Token (8h)
     | Refresh Token (7d)
     ↓
    chat-ui

    middleware
     |
     ├── RBAC权限校验
     ├── WhatsApp绑定管理
     ├── Conversation权限过滤
     └── 消息发送路由

     ↓

    WAHA 多 Session

     ↓

    Postgres
     ├── channel_accounts
     ├── conversations
     ├── messages
     ├── user_roles
     └── audit_events

------------------------------------------------------------------------

# 3. 身份认证设计

## 3.1 Token策略

采用 Access Token + Refresh Token 模式。

  类型            有效期   用途
  --------------- -------- ----------
  Access Token    8小时    API访问
  Refresh Token   7天      自动续期

用户无需频繁重新登录。

## 3.2 Access Token

JWT仅保存身份信息：

``` json
{
  "sub": "workspaceMemberId",
  "iat": 123456,
  "exp": 123456
}
```

不保存：

-   role
-   scope
-   permission

原因：

权限变化不应等待Token过期。

## 3.3 权限计算

请求流程：

    JWT
     |
    workspaceMemberId
     |
    查询 user_roles
     |
    计算 role_scopes
     |
    执行数据过滤

------------------------------------------------------------------------

# 4. RBAC设计

## 4.1 角色

  角色      范围
  --------- ----------
  admin     全部会话
  manager   团队会话
  sales     本人会话

## 4.2 权限矩阵

  功能                 sales   manager   admin
  -------------------- ------- --------- -------
  绑定自己的WhatsApp   √       √         √
  绑定他人账号         ×       ×         ×
  查看本人会话         √       √         √
  查看团队会话         ×       √         √
  查看全部会话         ×       ×         √
  发送消息             本人    团队      全部

------------------------------------------------------------------------

# 5. WhatsApp账号模型

## 5.1 绑定原则

-   一个销售绑定自己的WhatsApp；
-   禁止客户端指定绑定目标；
-   middleware根据当前登录用户自动绑定。

## 5.2 数据模型

``` sql
channel_accounts  （复用既有单号绑定表，多账号按 provider_session 区分）

id
user_id
workspace_member_id
channel
provider
provider_session
external_account_id
display_name
status
metadata
created_at
updated_at
```

一期：

-   一个用户一个有效WhatsApp账号。

预留：

-   一个用户多个WhatsApp账号；
-   多WAHA实例扩展。

------------------------------------------------------------------------

# 6. Conversation归属模型

区分：

## Channel Owner

WhatsApp账号拥有者。

## Conversation Owner

当前客户负责人。

原因：

销售离职时：

    销售A WhatsApp解绑

    客户转交

    Conversation Owner = 销售B

历史聊天继续保留。

------------------------------------------------------------------------

# 7. 消息权限控制

所有Conversation操作必须经过统一鉴权：

    authorizeConversationAction()

覆盖：

-   查看会话；
-   查看历史消息；
-   发送消息；
-   修改状态；
-   转交负责人。

禁止：

通过conversation_id直接访问。

------------------------------------------------------------------------

# 8. WAHA Session管理

每个WhatsApp账号：

    workspaceMember
            |
            ↓
    waha_session
            |
            ↓
    WAHA Session

Webhook：

根据session反查用户。

异常情况：

-   未知session拒绝入库；
-   重复消息幂等处理；
-   session异常进入error状态。

------------------------------------------------------------------------

# 9. 数据库设计

核心表：

## user_roles

用户角色。

## role_scopes

角色对应数据范围。

## channel_accounts

WhatsApp 绑定关系（复用既有 conv.channel_accounts 表，不新建）。

## conversations

增加：

    channel_owner_id
    owner_id
    waha_session

## audit_events

记录：

-   登录；
-   绑定解绑；
-   查看客户；
-   发送消息；
-   权限变更。

------------------------------------------------------------------------

# 10. 安全设计

## 越权防护

-   前端不传权限条件；
-   服务端根据Token身份计算权限；
-   所有数据查询增加权限过滤。

## Token安全

-   Access Token：HS256，8小时；
-   Refresh Token：HttpOnly Cookie，7天；
-   用户禁用后删除Refresh Token。

## 数据安全

-   WhatsApp账号隔离；
-   消息发送绑定Conversation权限；
-   管理操作保留审计。

------------------------------------------------------------------------

# 11. 实施计划

  阶段   内容
  ------ ----------------
  M1     数据库模型升级
  M2     认证和RBAC
  M3     WhatsApp绑定
  M4     消息归属改造
  M5     权限过滤
  M6     前端渠道管理
  M7     安全测试

------------------------------------------------------------------------

# 12. 风险

  风险                   处理
  ---------------------- ----------------------------------
  WAHA Session数量增长   支持多实例扩展
  员工离职               解绑账号，转移Conversation Owner
  权限变化延迟           RBAC实时读取
  历史数据无归属         管理员处理

------------------------------------------------------------------------

# 13. 验收标准

-   销售只能看到自己的WhatsApp会话；
-   管理员可查看授权范围；
-   销售无法绑定他人账号；
-   发送消息无法越权；
-   Token自动续期无感；
-   权限调整即时生效。
