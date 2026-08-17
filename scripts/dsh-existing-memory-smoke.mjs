#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const profileDir = process.env.DSH_PROFILE_DIR;
const appBootPath = process.env.DSH_APP_BOOT;
const memoryRoot = process.env.DSH_MEMORY_ROOT;
const query = process.env.DSH_EXISTING_QUERY;
const existingPath = process.env.DSH_EXISTING_PATH;
if (!profileDir || !appBootPath || !memoryRoot || !query || !existingPath) {
  throw new Error('Set DSH_PROFILE_DIR, DSH_APP_BOOT, DSH_MEMORY_ROOT, DSH_EXISTING_QUERY, and DSH_EXISTING_PATH');
}

const { boot } = await import(pathToFileURL(appBootPath).href);
const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ihow-existing-smoke-'));
const stateRoot = process.env.DSH_STATE_ROOT || path.join(root, 'state');
const workspace = process.env.DSH_WORKSPACE || path.join(root, 'workspace');
const configPath = path.join(root, 'cordis.yml');
await mkdir(workspace, { recursive: true });
await writeFile(configPath, '[]\n');
process.env.IHOW_CAPTURE_FLOOR = '0';

const patches = [{ insert: [
  { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
  { id: 'tools', name: '@deepseek-ai/dsh-tools', config: { mode: 'native' } },
  {
    id: 'ihow-memory',
    name: 'dsh-ihow-memory',
    config: { memoryRoot, stateRoot, workspace, failOnStartupError: true },
  },
] }];

try {
  const ctx = await boot(
    'dsh-ihow-existing-memory-smoke',
    configPath,
    patches,
    undefined,
    pathToFileURL(`${profileDir}${path.sep}`).href,
  );
  try {
    const schemas = ctx.tools.schemas().filter((tool) => tool.name.startsWith('mcp__ihow-memory__'));
    const execute = async (logicalName, arguments_) => {
      const toolName = logicalName.replace('.', '_');
      const tool = schemas.find((candidate) => candidate.name.includes(`__${toolName}_`));
      assert.ok(tool, `missing DSH tool ${logicalName}`);
      const result = await ctx.tools.execute({
        callId: `dsh-existing-memory-${logicalName}`,
        name: tool.name,
        arguments: arguments_,
        signal: new AbortController().signal,
      });
      if (result.isError) throw new Error(result.error?.message || `${logicalName} failed`);
      return result.value.structuredContent;
    };

    const status = await execute('memory.status', {});
    assert.equal(status.workspace.mode, 'existing-memory-root');
    assert.equal(status.provider.ready, true);
    const existing = await execute('memory.read', { ref: existingPath });
    assert.ok(existing.content.includes(query), `existing memory did not contain marker: ${query}`);
    console.log(JSON.stringify({
      ok: true,
      host: 'DeepSeek Harness',
      mode: status.workspace.mode,
      query,
      existingPath,
      stateRoot: '<temporary-or-copy>',
    }, null, 2));
  } finally {
    await ctx.fiber.dispose();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
