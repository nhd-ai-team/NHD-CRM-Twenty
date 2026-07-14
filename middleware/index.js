/**
 * 中间层同步服务
 *
 * 当前职责：
 *  - 提供 Twenty CRM GraphQL 调用封装
 *  - 预留 Unipile webhook 接收接口（待接入）
 *  - 预留官网表单接收接口（待接入）
 *
 * 渠道层：Unipile（SaaS，替代原 Chatwoot 渠道接入）
 * 后续社媒对话服务单独部署，本服务只负责 CRM 同步写入
 */

const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

const PORT = process.env.PORT || 3002;
const TWENTY_API_URL = process.env.TWENTY_API_URL || 'http://localhost:3000';
const TWENTY_API_KEY = process.env.TWENTY_API_KEY || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// ── Twenty GraphQL helper ──────────────────────────────────────────────────

async function twentyGraphQL(query, variables = {}) {
  const res = await fetch(`${TWENTY_API_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TWENTY_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error('[twenty] GraphQL error:', JSON.stringify(json.errors));
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

async function findPersonByEmail(email) {
  if (!email) return null;
  const data = await twentyGraphQL(`
    query FindPerson($filter: PersonFilterInput) {
      people(filter: $filter) {
        edges { node { id name { firstName lastName } emails { primaryEmail } } }
      }
    }
  `, { filter: { emails: { primaryEmail: { eq: email } } } });
  const edges = data?.people?.edges || [];
  return edges.length > 0 ? edges[0].node : null;
}

async function createPerson({ firstName, lastName, email, phone }) {
  const data = await twentyGraphQL(`
    mutation CreatePerson($input: PersonCreateInput!) {
      createPerson(data: $input) {
        id name { firstName lastName }
      }
    }
  `, {
    input: {
      name: { firstName: firstName || 'Unknown', lastName: lastName || '' },
      emails: email ? { primaryEmail: email } : undefined,
      phones: phone ? { primaryPhoneNumber: phone } : undefined,
    },
  });
  return data?.createPerson;
}

async function createNote(personId, title, body) {
  await twentyGraphQL(`
    mutation CreateNote($input: NoteCreateInput!) {
      createNote(data: $input) { id }
    }
  `, {
    input: {
      title,
      body,
      noteTargets: { create: [{ personId }] },
    },
  });
}

// ── 官网表单接入（待实现）─────────────────────────────────────────────────
//
// POST /api/leads
// 接收官网询盘表单，写入 Twenty 联系人 / 公司 / 商机
// 字段：name, email, phone, company, country, product_interest, message
//
// TODO: 实现官网表单写入逻辑

app.post('/api/leads', async (req, res) => {
  res.status(501).json({ error: 'not implemented yet' });
});

// ── Unipile Webhook 接入（待实现）────────────────────────────────────────
//
// POST /api/unipile/webhook
// 接收 Unipile 推送的渠道消息事件（WhatsApp、LinkedIn、Instagram 等）
// 由社媒对话服务处理会话主记录，本服务只负责同步联系人和摘要到 CRM
//
// Unipile 文档：https://developer.unipile.com
//
// TODO: 接入 Unipile webhook，替换原 Chatwoot webhook 逻辑

app.post('/api/unipile/webhook', async (req, res) => {
  res.status(501).json({ error: 'not implemented yet' });
});

// ── 健康检查 ───────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    twenty_api_configured: !!TWENTY_API_KEY,
  });
});

app.listen(PORT, () => {
  console.log(`[middleware] listening on port ${PORT}`);
  console.log(`[middleware] Twenty: ${TWENTY_API_URL}`);
});
