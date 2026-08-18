#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.CRM_BASE_URL || 'http://127.0.0.1:3000';
const expectedChatContainer = 'twenty-chat-ui';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  const text = await response.text();
  return { response, text };
}

async function fetchHead(path) {
  return fetch(`${baseUrl}${path}`, { method: 'HEAD', redirect: 'manual' });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listContainers() {
  const raw = run('docker', ['ps', '--format', '{{.Names}}']);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function networkContainers() {
  const raw = run('docker', ['network', 'inspect', 'twenty_default', '--format', '{{json .Containers}}']);
  return JSON.parse(raw || '{}');
}

function dnsNamesFor(containerName, containers) {
  const entry = Object.values(containers).find((item) => item.Name === containerName);
  if (!entry) return [];
  const raw = run('docker', ['inspect', containerName, '--format', '{{json .NetworkSettings.Networks}}']);
  const networks = JSON.parse(raw);
  return Object.values(networks).flatMap((network) => network.DNSNames || []);
}

async function main() {
  const checks = [];

  const containers = listContainers();
  assert(containers.includes(expectedChatContainer), `缺少 ${expectedChatContainer} 容器`);
  assert(!containers.includes('twenty-chat-ui-local'), '发现旧容器 twenty-chat-ui-local，可能抢占 chat-ui DNS');
  checks.push(`容器：${expectedChatContainer} 存在，旧容器不存在`);

  const network = networkContainers();
  const chatAliasOwners = Object.values(network).filter((item) => {
    const names = dnsNamesFor(item.Name, network);
    return names.includes('chat-ui') || names.includes(expectedChatContainer);
  });
  assert(
    chatAliasOwners.length === 1 && chatAliasOwners[0].Name === expectedChatContainer,
    `chat-ui DNS 不唯一：${chatAliasOwners.map((item) => item.Name).join(', ') || '无'}`,
  );
  checks.push('Docker DNS：chat-ui/twenty-chat-ui 只指向当前工作台容器');

  const settings = await fetchText('/settings/profile');
  assert(settings.response.status === 200, `/settings/profile 状态异常：${settings.response.status}`);
  assert(settings.text.includes('/settings-nav-lite.js'), '设置页没有注入 settings-nav-lite.js');
  assert(!settings.text.includes('/chat-nav.js?v=20260813-stable-settings-v1'), '设置页仍注入旧 chat-nav 设置脚本');
  checks.push('设置页：200，注入轻量设置脚本');

  const chat = await fetchText('/chat/?v=runtime-check');
  assert(chat.response.status === 200, `/chat/ 状态异常：${chat.response.status}`);
  const scriptMatch = chat.text.match(/src="([^"]+index-[^"]+\.js)"/);
  assert(scriptMatch, '工作台入口没有找到 JS 资源');
  const currentScript = scriptMatch[1];
  checks.push(`工作台入口：当前 JS ${currentScript}`);

  const currentScriptHead = await fetchHead(currentScript);
  assert(currentScriptHead.status === 200, `当前工作台 JS 不可访问：${currentScript} -> ${currentScriptHead.status}`);

  const oldScriptHead = await fetchHead('/chat/assets/index-BUFseNyO.js');
  assert(oldScriptHead.status === 404, `旧工作台 JS 不应返回 ${oldScriptHead.status}`);
  checks.push('静态资源：当前 JS 200，旧 JS 404');

  const portalUpstream = run('docker', [
    'compose',
    'exec',
    '-T',
    'twenty-portal',
    'sh',
    '-lc',
    "getent hosts twenty-chat-ui | awk '{print $1}'",
  ]);
  assert(portalUpstream.length > 0, 'portal 无法解析 twenty-chat-ui');
  checks.push(`portal DNS：twenty-chat-ui -> ${portalUpstream.split('\n')[0]}`);

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
