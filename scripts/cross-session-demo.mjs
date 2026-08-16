#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const launcher = fileURLToPath(new URL('../bin/ihow-memory-mcp.mjs', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ihow-cross-session-'));
const memoryHome = path.join(root, 'memory-home');
const stateRoot = path.join(root, 'state');
const workspace = path.join(root, 'workspace');
await (await import('node:fs/promises')).mkdir(workspace, { recursive: true });
const marker = `DSH cross-session memory marker ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const mode = process.env.DEMO_MODE || 'core-mcp';

if (mode !== 'core-mcp') {
  throw new Error('DEMO_MODE currently supports only core-mcp; run against the official DSH host with scripts/dsh-cross-session-demo.mjs');
}

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
          const timer = setTimeout(resolve, 50);
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

let requestId = 0;
async function runSession(name, callback) {
  const child = spawn(process.env.NODE_BINARY || process.execPath, [launcher], {
    cwd: workspace,
    env: {
      ...process.env,
      IHOW_MEMORY_HOME: memoryHome,
      IHOW_MEMORY_STATE_ROOT: stateRoot,
      IHOW_MEMORY_CWD: workspace,
      IHOW_CAPTURE_FLOOR: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let spawnError;
  const spawnFailed = new Promise((_, reject) => {
    child.once('error', (error) => {
      spawnError = error;
      reject(error);
    });
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const client = createClient(child);
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    const initialized = await Promise.race([
      client.request({
        jsonrpc: '2.0',
        id: ++requestId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'dsh-ihow-memory-cross-session-demo', version: '1' },
        },
      }),
      spawnFailed,
    ]);
    if (spawnError) {
      throw new Error(`unable to start Node child process; set NODE_BINARY to a working Node 22+ executable: ${spawnError.message}`);
    }
    assert.equal(initialized.result.serverInfo.name, 'ihow-memory-core');
    return await callback(async (name_, arguments_) => {
      const response = await client.request({
        jsonrpc: '2.0',
        id: ++requestId,
        method: 'tools/call',
        params: { name: name_, arguments: arguments_ },
      });
      if (response.error) throw new Error(`${name}: ${response.error.message}`);
      return response.result.structuredContent;
    });
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    await Promise.race([exited, spawnFailed.catch(() => undefined)]);
    assert.equal(stderr, '', `${name} wrote to stderr: ${stderr}`);
  }
}

let memoryPath;
try {
  await runSession('write session', async (call) => {
    const status = await call('memory.status', {});
    assert.equal(status.workspace.mode, 'managed-space');
    assert.equal(status.provider.ready, true);

    const written = await call('memory.write_candidate', {
      text: marker,
      title: 'DSH cross-session demo marker',
      sourceAgent: 'dsh-ihow-memory-cross-session-demo',
      metadata: { source: 'dsh-ihow-memory-cross-session-demo' },
    });
    assert.equal(written.status, 'promoted');
    memoryPath = written.path;
  });

  await runSession('recall session', async (call) => {
    const searched = await call('memory.search', { query: marker, limit: 5 });
    assert.equal(searched.results.filter((entry) => entry.snippet.includes(marker)).length, 1);
  });

  await runSession('forget session', async (call) => {
    const forgotten = await call('memory.forget', {
      needle: memoryPath,
      reason: 'cross-session demo correction',
    });
    assert.equal(forgotten.status, 'forgotten');
  });

  await runSession('forgotten recall session', async (call) => {
    const searched = await call('memory.search', { query: marker, limit: 5 });
    assert.equal(searched.results.filter((entry) => entry.snippet.includes(marker)).length, 0);
  });

  await runSession('remember session', async (call) => {
    const remembered = await call('memory.remember', { needle: memoryPath });
    assert.equal(remembered.status, 'remembered');
  });

  await runSession('restored recall session', async (call) => {
    const searched = await call('memory.search', { query: marker, limit: 5 });
    assert.equal(searched.results.filter((entry) => entry.snippet.includes(marker)).length, 1);
  });

  console.log(JSON.stringify({
    ok: true,
    flow: [
      'write in session A',
      'recall in a new process',
      'forget in a new process',
      'confirm hidden after another restart',
      'remember in a new process',
      'confirm restored after another restart',
    ],
    marker,
    memoryPath,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
