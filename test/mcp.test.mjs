// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../bin/ihow-memory-mcp.mjs', import.meta.url));

function createClient(child) {
  let buffer = '';
  const responses = [];
  let wake;
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      responses.push(JSON.parse(line));
      wake?.();
      wake = undefined;
    }
  });
  return {
    async request(payload) {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const index = responses.findIndex((response) => response.id === payload.id);
        if (index >= 0) return responses.splice(index, 1)[0];
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 100);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      throw new Error(`MCP response timed out for ${payload.method}`);
    },
  };
}

test('launcher exposes the iHow Memory MCP contract without a global install', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ihow-memory-'));
  const child = spawn(process.execPath, [launcher], {
    cwd: root,
    env: {
      ...process.env,
      IHOW_MEMORY_HOME: path.join(root, 'memory-home'),
      IHOW_MEMORY_STATE_ROOT: path.join(root, 'state'),
      IHOW_CAPTURE_FLOOR: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const client = createClient(child);
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    const initialized = await client.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'dsh-ihow-memory-test', version: '1' },
      },
    });
    assert.equal(initialized.result.serverInfo.name, 'ihow-memory-core');
    assert.equal(initialized.result.serverInfo.version, '0.1.0-alpha.31.2');

    const listed = await client.request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const names = new Set(listed.result.tools.map((tool) => tool.name));
    for (const required of ['memory.status', 'memory.search', 'memory.write_candidate', 'memory.continue']) {
      assert.ok(names.has(required), `missing ${required}`);
    }

    const status = await client.request({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'memory.status', arguments: {} },
    });
    assert.equal(status.result.structuredContent.workspace.mode, 'managed-space');
    assert.equal(status.result.structuredContent.index.status, 'missing');
    assert.equal(status.result.structuredContent.provider.ready, true);

    const marker = `DSH launcher continuity marker ${Date.now()}`;
    const written = await client.request({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'memory.write_candidate',
        arguments: {
          text: marker,
          title: 'DSH launcher continuity test',
          sourceAgent: 'dsh-ihow-memory-test',
          metadata: { source: 'dsh-ihow-memory-test' },
        },
      },
    });
    assert.equal(written.result.structuredContent.status, 'promoted');

    const searched = await client.request({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'memory.search', arguments: { query: marker, limit: 5 } },
    });
    assert.ok(searched.result.structuredContent.results.some((entry) => entry.snippet.includes(marker)));
  } finally {
    child.kill('SIGTERM');
    await exited;
    await rm(root, { recursive: true, force: true });
  }

  assert.equal(stderr, '');
});
