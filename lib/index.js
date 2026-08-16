// SPDX-License-Identifier: Apache-2.0
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { apply as applyMcpClient } from '@deepseek-ai/dsh-mcp-client';

export const name = 'ihow-memory';
export const inject = ['tools'];

export const Config = z.object({
  failOnStartupError: z.boolean().default(true),
  toolCallTimeoutMs: z.number().min(1).default(60_000),
});

const launcher = fileURLToPath(new URL('../bin/ihow-memory-mcp.mjs', import.meta.url));

export async function apply(ctx, config = {}) {
  const home = process.env.IHOW_MEMORY_HOME || path.join(os.homedir(), '.ihow-memory');
  await applyMcpClient(ctx, {
    serverName: 'ihow-memory',
    transport: 'stdio',
    command: process.execPath,
    args: [launcher],
    cwd: process.env.IHOW_MEMORY_CWD || process.env.DSH_CWD || process.cwd(),
    env: {
      IHOW_MEMORY_HOME: home,
      IHOW_MEMORY_STATE_ROOT:
        process.env.IHOW_MEMORY_STATE_ROOT || path.join(home, '.state', 'dsh'),
      ...(process.env.MEMORY_ROOT ? { MEMORY_ROOT: process.env.MEMORY_ROOT } : {}),
      ...(process.env.IHOW_MEMORY_ROOT ? { IHOW_MEMORY_ROOT: process.env.IHOW_MEMORY_ROOT } : {}),
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
