#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


const profileDir = process.env.DSH_PROFILE_DIR;
const dshPackageRoot = process.env.DSH_PACKAGE_ROOT;
const appBootPath = process.env.DSH_APP_BOOT;
if (!profileDir) {
  throw new Error('DSH_PROFILE_DIR is required; point it at an installed DSH profile containing dsh-ihow-memory');
}
if (!appBootPath && !dshPackageRoot) {
  throw new Error('Set DSH_APP_BOOT to @deepseek-ai/dsh-app-boot/lib/index.js or DSH_PACKAGE_ROOT to the installed @deepseek-ai/dsh package');
}

const resolvedAppBootPath = appBootPath || path.join(
  dshPackageRoot,
  'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
);
const { boot } = await import(pathToFileURL(resolvedAppBootPath).href);
const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ihow-host-demo-'));
const memoryHome = path.join(root, 'memory-home');
const stateRoot = path.join(root, 'state');
const workspace = path.join(root, 'workspace');
const configPath = path.join(root, 'cordis.yml');
const marker = `DSH host cross-session marker ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let requestId = 0;
let memoryPath;

await mkdir(workspace, { recursive: true });
await writeFile(configPath, '[]\n');

process.env.IHOW_MEMORY_HOME = memoryHome;
process.env.IHOW_MEMORY_STATE_ROOT = stateRoot;
process.env.IHOW_MEMORY_CWD = workspace;
process.env.IHOW_CAPTURE_FLOOR = '0';

const patches = [{ insert: [
  { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
  { id: 'tools', name: '@deepseek-ai/dsh-tools', config: { mode: 'native' } },
  { id: 'ihow-memory', name: 'dsh-ihow-memory', config: { failOnStartupError: true } },
] }];

async function runHostSession(name, callback) {
  const ctx = await boot(
    `dsh-ihow-host-demo-${name}`,
    configPath,
    patches,
    undefined,
    pathToFileURL(`${profileDir}${path.sep}`).href,
  );
  try {
    const toolSchemas = ctx.tools.schemas().filter((tool) => tool.name.startsWith('mcp__ihow-memory__'));
    assert.ok(toolSchemas.length >= 4, 'DSH did not mount the iHow Memory MCP tools');
    const execute = async (toolName, arguments_) => {
      const logicalName = toolName.replace('.', '_');
      const tool = toolSchemas.find((candidate) => candidate.name.includes(`__${logicalName}_`));
      assert.ok(tool, `missing DSH tool ${toolName}`);
      const result = await ctx.tools.execute({
        callId: `dsh-ihow-host-demo-${++requestId}`,
        name: tool.name,
        arguments: arguments_,
        signal: new AbortController().signal,
      });
      if (result.isError) throw new Error(`${name}: ${result.error?.message || toolName} failed`);
      return result.value.structuredContent;
    };
    return await callback(execute);
  } finally {
    await ctx.fiber.dispose();
  }
}

try {
  await runHostSession('write', async (call) => {
    const status = await call('memory.status', {});
    assert.equal(status.workspace.mode, 'managed-space');
    assert.equal(status.provider.ready, true);
    assert.ok(status.capabilities.lexical, 'DSH demo requires local lexical retrieval');

    const written = await call('memory.write_candidate', {
      text: marker,
      title: 'DSH host cross-session demo marker',
      sourceAgent: 'dsh-ihow-memory-host-demo',
      metadata: { source: 'dsh-ihow-memory-host-demo' },
    });
    assert.equal(written.status, 'promoted');
    memoryPath = written.path;
  });

  await runHostSession('recall', async (call) => {
    const searched = await call('memory.search', { query: marker, limit: 5 });
    assert.equal(searched.results.filter((entry) => entry.snippet.includes(marker)).length, 1);
  });

  await runHostSession('forget', async (call) => {
    const forgotten = await call('memory.forget', {
      needle: memoryPath,
      reason: 'cross-session demo correction',
    });
    assert.equal(forgotten.status, 'forgotten');
  });

  await runHostSession('hidden-recall', async (call) => {
    const searched = await call('memory.search', { query: marker, limit: 5 });
    assert.equal(searched.results.filter((entry) => entry.snippet.includes(marker)).length, 0);
  });

  await runHostSession('remember', async (call) => {
    const remembered = await call('memory.remember', { needle: memoryPath });
    assert.equal(remembered.status, 'remembered');
  });

  await runHostSession('restored-recall', async (call) => {
    const searched = await call('memory.search', { query: marker, limit: 5 });
    assert.equal(searched.results.filter((entry) => entry.snippet.includes(marker)).length, 1);
  });

  const receipt = {
    ok: true,
    host: 'DeepSeek Harness',
    flow: [
      'write through DSH tools in host A',
      'recall after disposing and rebuilding the host',
      'forget through DSH tools in a new host',
      'confirm hidden after another host rebuild',
      'remember in a new host',
      'confirm restored after another host rebuild',
    ],
    marker,
    memoryPath,
  };
  if (process.env.DEMO_RECEIPT_PATH) {
    await writeFile(process.env.DEMO_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
