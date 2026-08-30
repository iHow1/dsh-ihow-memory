// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
assert.equal(manifest.dependencies?.['ihow-memory'], '0.1.0-alpha.33');
assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-mcp-client'], '^0.1.1-rc.2');

const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
}));
const files = new Set(packed[0].files.map((entry) => entry.path));
for (const required of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/lifecycle.js', 'lib/storage-config.js', 'bin/ihow-memory-mcp.mjs', 'CHANGELOG.md', 'README.md', 'README.zh-CN.md', 'DEMO.md', 'LICENSE']) {
  assert.ok(files.has(required), `packed artifact missing ${required}`);
}
for (const forbidden of ['test/mcp.test.mjs', 'scripts/verify-package.mjs']) {
  assert.ok(!files.has(forbidden), `packed artifact unexpectedly includes ${forbidden}`);
}
console.log(`verified ${packed[0].filename}: ${packed[0].entryCount} files, ${packed[0].size} bytes`);
