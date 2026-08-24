const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('injected chat-nav bundle is synchronized with manifest sources', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'nginx', 'inject', 'build-chat-nav.js'), '--check'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
