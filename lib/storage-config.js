// SPDX-License-Identifier: Apache-2.0
import os from 'node:os';
import path from 'node:path';

export function resolveStorageConfig(config = {}, env = process.env, context = {}) {
  const homeDir = context.homeDir || os.homedir();
  const cwd = context.cwd || process.cwd();
  const resolveConfiguredPath = (value) => {
    if (!value) return '';
    if (value === '~') return homeDir;
    if (value.startsWith('~/')) return path.join(homeDir, value.slice(2));
    return path.resolve(cwd, value);
  };

  const home =
    resolveConfiguredPath(config.home) ||
    env.IHOW_MEMORY_HOME ||
    path.join(homeDir, '.ihow-memory');
  const memoryRoot =
    resolveConfiguredPath(config.memoryRoot) ||
    env.MEMORY_ROOT ||
    env.IHOW_MEMORY_ROOT ||
    '';
  const stateRoot =
    resolveConfiguredPath(config.stateRoot) ||
    env.IHOW_MEMORY_STATE_ROOT ||
    path.join(home, '.state', 'dsh');
  const workspace =
    resolveConfiguredPath(config.workspace) ||
    env.IHOW_MEMORY_CWD ||
    env.DSH_CWD ||
    cwd;

  return { home, memoryRoot, stateRoot, workspace };
}
