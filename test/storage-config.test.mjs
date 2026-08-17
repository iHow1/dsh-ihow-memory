// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveStorageConfig } from '../lib/storage-config.js';

const context = { homeDir: '/Users/tester', cwd: '/work/project' };

test('explicit plugin storage paths override ambient DSH environment', () => {
  const resolved = resolveStorageConfig(
    {
      home: '~/memory-home',
      memoryRoot: '/shared/memory',
      stateRoot: './state',
      workspace: '/work/identity',
    },
    {
      IHOW_MEMORY_HOME: '/env/home',
      MEMORY_ROOT: '/env/memory',
      IHOW_MEMORY_STATE_ROOT: '/env/state',
      IHOW_MEMORY_CWD: '/env/workspace',
    },
    context,
  );

  assert.deepEqual(resolved, {
    home: '/Users/tester/memory-home',
    memoryRoot: '/shared/memory',
    stateRoot: '/work/project/state',
    workspace: '/work/identity',
  });
});

test('legacy environment remains compatible when plugin paths are empty', () => {
  const resolved = resolveStorageConfig(
    {},
    {
      IHOW_MEMORY_HOME: '/env/home',
      IHOW_MEMORY_ROOT: '/env/memory',
      IHOW_MEMORY_STATE_ROOT: '/env/state',
      DSH_CWD: '/env/workspace',
    },
    context,
  );

  assert.deepEqual(resolved, {
    home: '/env/home',
    memoryRoot: '/env/memory',
    stateRoot: '/env/state',
    workspace: '/env/workspace',
  });
});

test('default managed storage remains unchanged without overrides', () => {
  const resolved = resolveStorageConfig({}, {}, context);

  assert.deepEqual(resolved, {
    home: '/Users/tester/.ihow-memory',
    memoryRoot: '',
    stateRoot: '/Users/tester/.ihow-memory/.state/dsh',
    workspace: '/work/project',
  });
  assert.equal(path.isAbsolute(resolved.stateRoot), true);
});
