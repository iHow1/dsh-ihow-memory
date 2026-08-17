// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { apply as applyMcpClient } from '@deepseek-ai/dsh-mcp-client';
import { resolveStorageConfig } from './storage-config.js';

export const name = 'ihow-memory';
export const inject = ['tools'];

export const Config = z.object({
  home: z.string().default(''),
  memoryRoot: z.string().default(''),
  stateRoot: z.string().default(''),
  workspace: z.string().default(''),
  failOnStartupError: z.boolean().default(true),
  toolCallTimeoutMs: z.number().min(1).default(60_000),
});

const launcher = fileURLToPath(new URL('../bin/ihow-memory-mcp.mjs', import.meta.url));


export async function apply(ctx, config = {}) {
  const { home, memoryRoot, stateRoot, workspace } = resolveStorageConfig(config);
  await applyMcpClient(ctx, {
    serverName: 'ihow-memory',
    transport: 'stdio',
    command: process.execPath,
    args: [launcher],
    cwd: workspace,
    env: {
      IHOW_MEMORY_HOME: home,
      IHOW_MEMORY_STATE_ROOT: stateRoot,
      IHOW_MEMORY_CWD: workspace,
      ...(memoryRoot ? { MEMORY_ROOT: memoryRoot } : {}),
      ...(process.env.IHOW_CAPTURE_FLOOR ? { IHOW_CAPTURE_FLOOR: process.env.IHOW_CAPTURE_FLOOR } : {}),
    },
    failOnStartupError: config.failOnStartupError ?? true,
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 60_000,
    reconnect: {
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 30_000,
      maxAttempts: 10,
    },
  });
}
