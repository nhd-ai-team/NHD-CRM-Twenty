#!/usr/bin/env node
// 构建脚本：把 src/ 下的模块按文件名序（00/10/20/.../80）合并成单个 chat-nav.js。
// 设计：src/*.js 是同一 IIFE 作用域内的连续代码片段（非独立模块），按序拼接即可，
// 拼接结果在语义上与拆分前的单文件完全等价（只多每片的模块头注释）。
//
// 用法：node build-chat-nav.js
// 产物：nginx/inject/chat-nav.js（部署文件不变，nginx 注入点也不变）。

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'chat-nav.js');

const files = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.js'))
  .sort(); // 文件名前缀 00/10/20... 保证顺序

const parts = files.map((f) =>
  fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\s+$/, '')
);

const out = parts.join('\n') + '\n';
fs.writeFileSync(OUT, out);

console.log('built chat-nav.js from ' + files.length + ' modules:');
files.forEach((f) => console.log('  - ' + f));
console.log('output: ' + OUT + ' (' + out.split('\n').length + ' lines)');
