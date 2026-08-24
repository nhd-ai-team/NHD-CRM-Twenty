#!/usr/bin/env node
// 构建脚本：把 manifest 中登记的 src 模块合并成单个 chat-nav.js。
// 设计：src/*.js 是同一 IIFE 作用域内的连续代码片段（非独立模块），按 manifest 拼接即可，
// 拼接结果在语义上与拆分前的单文件完全等价（只多每片的模块头注释）。
//
// 用法：node build-chat-nav.js
// 校验：node build-chat-nav.js --check
// 产物：nginx/inject/chat-nav.js（部署文件不变，nginx 注入点也不变）。

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'chat-nav.js');
const MANIFEST = path.join(SRC, 'manifest.json');
const CHECK = process.argv.includes('--check');

function readManifestFiles() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error('missing manifest: ' + MANIFEST);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  if (!Array.isArray(manifest)) {
    throw new Error('manifest must be an array');
  }
  const files = manifest.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry.file === 'string') return entry.file;
    throw new Error('invalid manifest entry: ' + JSON.stringify(entry));
  });
  const seen = new Set();
  for (const file of files) {
    if (!file.endsWith('.js')) throw new Error('manifest entry must be a .js file: ' + file);
    if (seen.has(file)) throw new Error('duplicate manifest entry: ' + file);
    seen.add(file);
    const fullPath = path.join(SRC, file);
    if (!fs.existsSync(fullPath)) throw new Error('manifest entry not found: ' + fullPath);
  }
  return files;
}

const files = readManifestFiles();

const parts = files.map((f) =>
  fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\s+$/, '')
);

const out = parts.join('\n') + '\n';
if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== out) {
    console.error('chat-nav.js is out of date. Run: node nginx/inject/build-chat-nav.js');
    process.exit(1);
  }
  console.log('chat-nav.js is up to date with manifest modules.');
  process.exit(0);
}

fs.writeFileSync(OUT, out);

console.log('built chat-nav.js from ' + files.length + ' manifest modules:');
files.forEach((f) => console.log('  - ' + f));
console.log('output: ' + OUT + ' (' + out.split('\n').length + ' lines)');
