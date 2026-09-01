#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
const { agentEvents } = await import(pathToFileURL(path.join(
  profileDir,
  'node_modules/@deepseek-ai/dsh-agent/lib/index.js',
)).href);
const { boot } = await import(pathToFileURL(resolvedAppBootPath).href);
const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ihow-host-demo-'));
const originalHome = process.env.HOME;
const hostHome = path.join(root, 'host-home');
const memoryHome = path.join(root, 'memory-home');
const stateRoot = path.join(root, 'state');
const workspace = path.join(root, 'workspace');
const foreignWorkspace = path.join(root, 'foreign-workspace');
const configPath = path.join(root, 'cordis.yml');
const marker = `DSH host cross-session marker ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const currentHandoffMarker = `CURRENT DSH project handoff ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const foreignHandoffMarker = `FOREIGN DSH project handoff ${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let requestId = 0;
let memoryPath;
let startupSessionId;
let resumedSessionId;
let sessionStartInjected = false;
let sessionEndCheckpointCount = 0;

function runGit(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function makeRepo(dir) {
  await mkdir(dir, { recursive: true });
  runGit(dir, 'init', '-q');
  runGit(dir, 'config', 'user.email', 'host-smoke@example.invalid');
  runGit(dir, 'config', 'user.name', 'DSH Host Smoke');
  runGit(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(dir, 'seed.txt'), 'seed\n');
  runGit(dir, 'add', 'seed.txt');
  runGit(dir, 'commit', '-qm', 'seed host smoke project');
}

function editedTranscript(repo, handoffMarker) {
  const edit = { type: 'tool_use', name: 'Edit', input: { file_path: path.join(repo, 'seed.txt') } };
  return [
    { type: 'user', message: { content: 'continue the scoped host smoke' } },
    { type: 'assistant', message: { content: [edit, { type: 'text', text: 'Edited the scoped smoke seed.' }] } },
    { type: 'assistant', message: { content: [edit, { type: 'text', text: 'Verified the scoped smoke seed.' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: `Handoff: ${handoffMarker}. Continue only this project. `.repeat(4) }] } },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

async function seedTranscript(repo, sessionId, handoffMarker) {
  const encoded = path.resolve(repo).replace(/[^A-Za-z0-9]/g, '-');
  const dir = path.join(hostHome, '.claude', 'projects', encoded);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${sessionId}.jsonl`), editedTranscript(repo, handoffMarker));
}

await makeRepo(workspace);
await makeRepo(foreignWorkspace);
await seedTranscript(workspace, 'current-project', currentHandoffMarker);
await new Promise((resolve) => setTimeout(resolve, 25));
await seedTranscript(foreignWorkspace, 'foreign-project', foreignHandoffMarker);
process.env.HOME = hostHome;
await writeFile(configPath, '[]\n');
process.env.IHOW_CAPTURE_FLOOR = '0';

const patches = [{ insert: [
  { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
  { id: 'tools', name: '@deepseek-ai/dsh-tools', config: { mode: 'native' } },
  {
    id: 'rich-acp-demo',
    name: path.join(profileDir, 'src/rich-acp-demo.js'),
    config: {
      provider: 'smoke',
      model: 'smoke',
      persistenceRoot: path.join(root, 'sessions'),
      workspaceContext: false,
      goals: false,
      toolJobs: false,
    },
  },
  {
    id: 'ihow-memory',
    name: path.join(profileDir, 'src/mcp-ihow.mjs'),
    config: {
      home: memoryHome,
      memoryRoot: path.join(memoryHome, 'memory'),
      stateRoot,
      workspace,
      space: 'main',
      failOnStartupError: true,
    },
  },
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
    return await callback(execute, ctx);
  } finally {
    await ctx.fiber.dispose();
  }
}

try {
  await runHostSession('write', async (call) => {
    const status = await call('memory.status', {});
    assert.equal(status.workspace.mode, 'existing-memory-root');
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

  await runHostSession('lifecycle-startup', async (_call, ctx) => {
    startupSessionId = randomUUID();
    const handle = await ctx.agents.create({
      sessionId: startupSessionId,
      meta: { cwd: workspace },
      agentOptions: { provider: 'smoke', model: 'smoke' },
    });
    await handle.dispose();
  });

  await runHostSession('lifecycle-resume', async (_call, ctx) => {
    resumedSessionId = randomUUID();
    const injected = [];
    const agent = {
      id: resumedSessionId,
      session: { header: { cwd: workspace } },
      inject: (message) => injected.push(message),
    };
    await agentEvents(ctx, agent).serial('agent/session-start', { source: 'resume' });
    const recalled = injected.find((message) => message.source?.form === 'recall');
    const recalledText = recalled?.content
      ?.filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n') ?? '';
    sessionStartInjected = Boolean(recalled);
    assert.equal(sessionStartInjected, true, 'DSH session-start did not inject current-project context');
    assert.match(recalledText, new RegExp(currentHandoffMarker), 'DSH session-start omitted the current-project handoff');
    assert.doesNotMatch(recalledText, new RegExp(foreignHandoffMarker), 'DSH session-start injected a foreign-project handoff');
  });

  const activationPath = path.join(memoryHome, 'memory', '_mcp', 'activation-ledger.ndjson');
  const activationLedger = await readFile(activationPath, 'utf8');
  const activationRows = activationLedger.trim().split('\n').map((line) => JSON.parse(line));
  const dshRows = activationRows.filter((row) => row.runtime === 'dsh');
  assert.ok(dshRows.some((row) => row.event === 'runtime-configured' && row.status === 'configured'));
  assert.ok(dshRows.some((row) => row.event === 'hook-session-start' && row.status === 'observed-live-completed'));
  assert.ok(dshRows.some((row) => row.event === 'hook-session-end' && row.status === 'observed-live-completed'));
  assert.equal(activationLedger.includes(startupSessionId), false, 'activation ledger leaked the DSH startup session id');
  assert.equal(activationLedger.includes(resumedSessionId), false, 'activation ledger leaked the DSH resumed session id');

  const checkpointRoot = path.join(memoryHome, 'memory', '_mcp', 'checkpoints', 'artifacts');
  for (const file of (await readdir(checkpointRoot)).filter((candidate) => candidate.endsWith('.json'))) {
    const checkpoint = JSON.parse(await readFile(path.join(checkpointRoot, file), 'utf8'));
    const sessionHash = checkpoint.session?.sessionIdHash;
    if (typeof sessionHash === 'string' && sessionHash.length > 0 && checkpoint.trigger?.sourceEvent === 'DSH.AgentRegistry.dispose') {
      sessionEndCheckpointCount += 1;
    }
  }
  assert.equal(sessionEndCheckpointCount, 1, 'DSH disposal did not persist one session-end checkpoint');

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
      'create and dispose a real DSH agent with session-start context injection',
      'verify hashed lifecycle activation evidence and one partial session-end checkpoint',
      'recall after disposing and rebuilding the host',
      'forget through DSH tools in a new host',
      'confirm hidden after another host rebuild',
      'remember in a new host',
      'confirm restored after another host rebuild',
    ],
    lifecycle: {
      sessionStartInjected,
      sessionEndCheckpoints: sessionEndCheckpointCount,
      activationEvidence: 'configured + session-start completed + session-end completed',
      projectScope: 'current-project injected; foreign-project excluded',
    },
    marker,
    memoryPath,
  };
  if (process.env.DEMO_RECEIPT_PATH) {
    await writeFile(process.env.DEMO_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (lastError) throw lastError;
}
