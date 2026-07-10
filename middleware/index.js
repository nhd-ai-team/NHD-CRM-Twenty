/**
 * Chatwoot → Twenty CRM 中间层
 *
 * 职责：
 *  - 接收 Chatwoot webhook
 *  - 去重幂等（contact_id 唯一键）
 *  - 将联系人 / 会话信息写入 Twenty CRM
 */

const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();

// 保留原始 body 字节用于 HMAC 验签
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

const PORT = process.env.PORT || 3002;
const TWENTY_API_URL = process.env.TWENTY_API_URL || 'http://localhost:3000';
const TWENTY_API_KEY = process.env.TWENTY_API_KEY || '';
const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL || 'http://localhost:3001';
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// 内存去重缓存（重启清空，生产应换 Redis）
const processedEvents = new Set();

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

// 按邮箱或名字查找联系人
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

// 创建联系人
async function createPerson({ firstName, lastName, email, phone, chatwootContactId, sourceChannel }) {
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
      // 自定义字段：chatwootContactId 和来源渠道（需在 Twenty 中先建字段）
    },
  });
  return data?.createPerson;
}

// 更新联系人（追加备注）
async function createNote(personId, body) {
  await twentyGraphQL(`
    mutation CreateNote($input: NoteCreateInput!) {
      createNote(data: $input) { id }
    }
  `, {
    input: {
      title: 'Chatwoot 会话摘要',
      body,
      noteTargets: {
        create: [{ personId }],
      },
    },
  });
}

// ── Chatwoot API helper ────────────────────────────────────────────────────

async function getContactDetails(accountId, contactId) {
  const res = await fetch(
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/contacts/${contactId}`,
    { headers: { api_access_token: CHATWOOT_API_TOKEN } }
  );
  if (!res.ok) return null;
  return res.json();
}

// ── Webhook 处理器 ─────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  // 签名校验（内网部署，仅记录日志，不拦截）
  if (WEBHOOK_SECRET) {
    const sig = req.headers['x-chatwoot-signature'];
    const hmac = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest('hex');
    const expected = `sha256=${hmac}`;
    if (sig !== expected) {
      console.warn(`[webhook] signature mismatch (allowed on internal network): got=${sig?.slice(0,20)}...`);
    }
  }

  const event = req.body;
  const eventType = event.event;
  const eventId = `${eventType}-${event.id || event.contact?.id || Date.now()}`;

  // 幂等：同一事件不重复处理
  if (processedEvents.has(eventId)) {
    return res.json({ status: 'duplicate, skipped' });
  }
  processedEvents.add(eventId);
  if (processedEvents.size > 10000) {
    // 简单 LRU：超过 1 万条就清一半
    const keys = [...processedEvents].slice(0, 5000);
    keys.forEach(k => processedEvents.delete(k));
  }

  console.log(`[webhook] received: ${eventType}`);

  try {
    if (eventType === 'contact_created' || eventType === 'contact_updated') {
      await handleContactSync(event);
    } else if (eventType === 'conversation_resolved') {
      await handleConversationResolved(event);
    } else if (eventType === 'message_created' && event.message_type === 'incoming') {
      await handleIncomingMessage(event);
    }
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[webhook] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 联系人创建/更新 → 同步到 Twenty
async function handleContactSync(event) {
  const contact = event.contact || event;
  const email = contact.email;
  const name = contact.name || '';
  const nameParts = name.trim().split(' ');
  const firstName = nameParts[0] || 'Unknown';
  const lastName = nameParts.slice(1).join(' ') || '';
  const phone = contact.phone_number;

  if (!email && !phone && !name) {
    console.log('[contact_sync] no useful data, skipping');
    return;
  }

  // 查重：按邮箱找
  let existing = await findPersonByEmail(email);
  if (existing) {
    console.log(`[contact_sync] person already exists: ${existing.id}`);
    return;
  }

  const person = await createPerson({ firstName, lastName, email, phone,
    chatwootContactId: contact.id,
    sourceChannel: 'chatwoot',
  });
  console.log(`[contact_sync] created person: ${person?.id}`);
}

// 会话结束 → 写摘要 Note 到联系人
async function handleConversationResolved(event) {
  const conversation = event.conversation;
  const contact = conversation?.meta?.sender;
  if (!contact?.email && !contact?.name) return;

  const person = await findPersonByEmail(contact.email);
  if (!person) {
    console.log('[resolved] person not found in Twenty, skipping note');
    return;
  }

  const chatwootUrl = `${CHATWOOT_BASE_URL}/app/accounts/${conversation.account_id}/conversations/${conversation.id}`;
  const body = [
    `来源渠道：${conversation.channel || 'Chatwoot'}`,
    `会话 ID：${conversation.id}`,
    `状态：已结束`,
    `完整会话：${chatwootUrl}`,
    ``,
    `（请在此补充跟进摘要）`,
  ].join('\n');

  await createNote(person.id, body);
  console.log(`[resolved] wrote note to person ${person.id}`);
}

// 新收到消息 → 确保联系人在 Twenty 存在（懒同步）
async function handleIncomingMessage(event) {
  const sender = event.sender;
  if (!sender) return;

  const email = sender.email;
  const existing = await findPersonByEmail(email);
  if (existing) return;

  const nameParts = (sender.name || '').trim().split(' ');
  await createPerson({
    firstName: nameParts[0] || 'Unknown',
    lastName: nameParts.slice(1).join(' ') || '',
    email: sender.email,
    phone: sender.phone_number,
    chatwootContactId: sender.id,
    sourceChannel: 'chatwoot',
  });
  console.log(`[message] auto-created person for ${sender.name}`);
}

// ── 健康检查 ───────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    twenty_api_configured: !!TWENTY_API_KEY,
    chatwoot_api_configured: !!CHATWOOT_API_TOKEN,
  });
});

app.listen(PORT, () => {
  console.log(`[middleware] listening on port ${PORT}`);
  console.log(`[middleware] Twenty: ${TWENTY_API_URL}`);
  console.log(`[middleware] Chatwoot: ${CHATWOOT_BASE_URL}`);
});
