#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const AI_BASE_URL = (process.env.AI_BASE_URL || 'http://127.0.0.1:8790').replace(/\/+$/, '');
const TENANT_ID = process.env.TENANT_ID || 'nhd';
const ORIGIN = process.env.ORIGIN || 'https://chinanhd.com';
const ACCOUNT_COUNT = Number(process.env.LOAD_TEST_ACCOUNTS || 10);
const MESSAGES_PER_ACCOUNT = Number(process.env.MESSAGES_PER_ACCOUNT || 3);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DB_VERIFY_TIMEOUT_MS = Number(process.env.DB_VERIFY_TIMEOUT_MS || 15000);
const AI_SETTLE_MS = Number(process.env.AI_SETTLE_MS || 8000);
const FORCE_WEBSITE_AI = ['1', 'true', 'yes'].includes(String(process.env.FORCE_WEBSITE_AI || '').toLowerCase());
const RUN_ID = process.env.RUN_ID || `loadtest-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

const QUESTIONS = [
  'What does NEW HONGDA do?',
  'Which filtration equipment do you provide?',
  'Can you share project references?',
  'How can I contact your sales team?',
  'Do you support phosphogypsum dewatering projects?',
];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function postJson(path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${AI_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runAccount(index) {
  const accountNo = String(index + 1).padStart(2, '0');
  const sessionId = `${RUN_ID}-session-${accountNo}`;
  const visitorId = `${RUN_ID}-visitor-${accountNo}`;
  const messages = [];
  let conversationId = null;

  for (let i = 0; i < MESSAGES_PER_ACCOUNT; i += 1) {
    const question = QUESTIONS[(index + i) % QUESTIONS.length];
    const clientMessageId = `${RUN_ID}-acct-${accountNo}-msg-${String(i + 1).padStart(2, '0')}`;
    const result = await postJson('/api/website-channel/messages', {
      tenantId: TENANT_ID,
      sessionId,
      visitorId,
      clientMessageId,
      message: `[${RUN_ID} account ${accountNo}] ${question}`,
      pageUrl: `https://www.chinanhd.com/load-test?run=${encodeURIComponent(RUN_ID)}&account=${accountNo}`,
      referrer: 'https://www.google.com/',
      locale: 'auto',
      widgetVersion: 'crm-load-test-1.0',
      displayName: `压测访客 ${accountNo}`,
    });
    if (result.data?.conversationId) conversationId = result.data.conversationId;
    messages.push({
      clientMessageId,
      question,
      ...result,
    });
  }

  return {
    accountNo,
    sessionId,
    visitorId,
    conversationId,
    ok: messages.every((message) => message.ok && message.data?.status === 'sent'),
    messages,
  };
}

function queryCrmDb(conversationIds) {
  if (!conversationIds.length) return { skipped: true, reason: 'no conversation ids returned' };
  const sql = `
WITH target AS (
  SELECT id, channel, external_chat_id, contact_id, last_message_preview
    FROM conv.conversations
   WHERE external_chat_id IN (${conversationIds.map(sqlLiteral).join(',')})
),
message_counts AS (
  SELECT conversation_id, count(*)::int AS message_count,
         count(*) FILTER (WHERE sender_type = 'customer')::int AS customer_count,
         count(*) FILTER (WHERE sender_type = 'ai')::int AS ai_count
    FROM conv.messages
   WHERE conversation_id IN (SELECT id FROM target)
   GROUP BY conversation_id
)
SELECT json_build_object(
  'conversationCount', (SELECT count(*)::int FROM target),
  'messageCount', COALESCE((SELECT sum(message_count)::int FROM message_counts), 0),
  'customerMessageCount', COALESCE((SELECT sum(customer_count)::int FROM message_counts), 0),
  'aiMessageCount', COALESCE((SELECT sum(ai_count)::int FROM message_counts), 0),
  'conversations', COALESCE((
    SELECT json_agg(json_build_object(
      'id', t.id,
      'channel', t.channel,
      'externalChatId', t.external_chat_id,
      'messageCount', COALESCE(m.message_count, 0),
      'customerMessageCount', COALESCE(m.customer_count, 0),
      'aiMessageCount', COALESCE(m.ai_count, 0),
      'lastMessagePreview', t.last_message_preview
    ) ORDER BY t.external_chat_id)
    FROM target t
    LEFT JOIN message_counts m ON m.conversation_id = t.id
  ), '[]'::json)
);`;

  try {
    const raw = execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.PG_DATABASE_USER || 'postgres', '-d', process.env.PG_DATABASE_NAME || 'default', '-tA', '-c', sql],
      { cwd: repoRoot, encoding: 'utf8', timeout: DB_VERIFY_TIMEOUT_MS },
    ).trim();
    return JSON.parse(raw);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.PG_DATABASE_USER || 'postgres', '-d', process.env.PG_DATABASE_NAME || 'default', '-tA', '-c', sql],
    { cwd: repoRoot, encoding: 'utf8', timeout: DB_VERIFY_TIMEOUT_MS },
  ).trim();
}

function getWebsiteAiSettings() {
  const raw = psql("SELECT COALESCE((SELECT row_to_json(t)::text FROM (SELECT * FROM conv.channel_settings WHERE channel = 'website') t), 'null');");
  return raw ? JSON.parse(raw) : null;
}

function applyForcedWebsiteAiSettings() {
  psql(`
INSERT INTO conv.channel_settings(channel, ai_enabled, ai_schedule_enabled, ai_timezone, updated_at)
VALUES ('website', true, false, 'Asia/Shanghai', now())
ON CONFLICT(channel) DO UPDATE
   SET ai_enabled = true,
       ai_schedule_enabled = false,
       ai_timezone = COALESCE(conv.channel_settings.ai_timezone, 'Asia/Shanghai'),
       updated_at = now();`);
}

function restoreWebsiteAiSettings(snapshot) {
  if (!snapshot) {
    psql("DELETE FROM conv.channel_settings WHERE channel = 'website';");
    return;
  }
  psql(`
INSERT INTO conv.channel_settings(channel, ai_enabled, ai_schedule_enabled, ai_schedule_start, ai_schedule_end, ai_timezone, updated_at)
VALUES (
  'website',
  ${snapshot.ai_enabled ? 'true' : 'false'},
  ${snapshot.ai_schedule_enabled ? 'true' : 'false'},
  ${snapshot.ai_schedule_start ? `${sqlLiteral(snapshot.ai_schedule_start)}::time` : 'NULL'},
  ${snapshot.ai_schedule_end ? `${sqlLiteral(snapshot.ai_schedule_end)}::time` : 'NULL'},
  ${sqlLiteral(snapshot.ai_timezone || 'Asia/Shanghai')},
  now()
)
ON CONFLICT(channel) DO UPDATE
   SET ai_enabled = EXCLUDED.ai_enabled,
       ai_schedule_enabled = EXCLUDED.ai_schedule_enabled,
       ai_schedule_start = EXCLUDED.ai_schedule_start,
       ai_schedule_end = EXCLUDED.ai_schedule_end,
       ai_timezone = EXCLUDED.ai_timezone,
       updated_at = now();`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

let websiteAiSnapshot = null;
let restoredWebsiteAi = false;

try {
  if (FORCE_WEBSITE_AI) {
    websiteAiSnapshot = getWebsiteAiSettings();
    applyForcedWebsiteAiSettings();
    console.log('[load-test] website AI settings temporarily forced on for this run');
  }

  const startedAt = new Date();
  console.log(`[load-test] runId=${RUN_ID}`);
  console.log(`[load-test] target=${AI_BASE_URL} accounts=${ACCOUNT_COUNT} messagesPerAccount=${MESSAGES_PER_ACCOUNT}`);

  const accountResults = await Promise.all(Array.from({ length: ACCOUNT_COUNT }, (_, index) => runAccount(index)));
  const conversationIds = [...new Set(accountResults.map((account) => account.conversationId).filter(Boolean))];

  if (AI_SETTLE_MS > 0) {
    console.log(`[load-test] waiting ${AI_SETTLE_MS}ms for async CRM/AI writes`);
    await sleep(AI_SETTLE_MS);
  }

  const finishedAt = new Date();
  const requests = accountResults.flatMap((account) => account.messages);
  const latencies = requests.map((request) => request.latencyMs);
  const failures = requests.filter((request) => !request.ok || request.data?.status !== 'sent');
  const dbVerification = queryCrmDb(conversationIds);

  const summary = {
    runId: RUN_ID,
    target: AI_BASE_URL,
    tenantId: TENANT_ID,
    origin: ORIGIN,
    forceWebsiteAi: FORCE_WEBSITE_AI,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    accountCount: ACCOUNT_COUNT,
    messagesPerAccount: MESSAGES_PER_ACCOUNT,
    requestCount: requests.length,
    successCount: requests.length - failures.length,
    failureCount: failures.length,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : 0,
    },
    conversationCount: conversationIds.length,
    dbVerification,
    failures: failures.map((failure) => ({
      clientMessageId: failure.clientMessageId,
      status: failure.status,
      error: failure.error,
      response: failure.data,
    })),
    accounts: accountResults,
  };

  mkdirSync(resolve(repoRoot, '.codex-runtime', 'load-tests'), { recursive: true });
  const reportPath = resolve(repoRoot, '.codex-runtime', 'load-tests', `${RUN_ID}.json`);
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`[load-test] requests ok=${summary.successCount}/${summary.requestCount} failed=${summary.failureCount}`);
  console.log(`[load-test] latency ms min=${summary.latencyMs.min} p50=${summary.latencyMs.p50} p95=${summary.latencyMs.p95} p99=${summary.latencyMs.p99} max=${summary.latencyMs.max}`);
  console.log(`[load-test] conversations returned=${summary.conversationCount}`);
  if (dbVerification?.error) {
    console.log(`[load-test] db verify error=${dbVerification.error}`);
  } else {
    console.log(`[load-test] db conversations=${dbVerification.conversationCount} messages=${dbVerification.messageCount} customerMessages=${dbVerification.customerMessageCount} aiMessages=${dbVerification.aiMessageCount}`);
  }
  console.log(`[load-test] report=${reportPath}`);

  if (summary.failureCount > 0) {
    process.exitCode = 1;
  }
} finally {
  if (FORCE_WEBSITE_AI) {
    restoreWebsiteAiSettings(websiteAiSnapshot);
    restoredWebsiteAi = true;
    console.log('[load-test] website AI settings restored');
  }
}

if (FORCE_WEBSITE_AI && !restoredWebsiteAi) {
  process.exitCode = 1;
}
