// SPDX-License-Identifier: Apache-2.0
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { normalizeDshPreCompactTrigger, runNativePreCompact } from 'ihow-memory/dist/native-precompact.js';
import { openCore } from 'ihow-memory/dist/core.js';

export const DSH_RUNTIME_CONFIGURATION_KEY = 'dsh-host-plugin-v1';
const RUNTIME_SOURCE = Object.freeze({ kind: 'plugin', plugin: 'ihow-memory', form: 'recall' });
const MAX_PROMPT_CHARS = 2_000;
const MAX_INJECT_CHARS = 12_000;

function textContent(messages) {
  const text = [];
  for (const message of messages) {
    for (const block of message?.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') text.push(block.text);
    }
  }
  return text.join('\n').trim();
}

export function sessionCwd(session) {
  return session?.header?.cwd || process.cwd();
}

export function compactionCheckpointInput(session, event) {
  if (event?.type !== 'compaction/summary') return undefined;
  return {
    cwd: sessionCwd(session),
    sessionId: String(session.id),
    observedAt: new Date(event.time).toISOString(),
    startSeq: event.data.shadowedRange.start,
    endSeq: event.data.shadowedRange.end,
  };
}

function eventCwd(agent) {
  return sessionCwd(agent?.session);
}

function runtimeEvent(agent, event, promptDigest) {
  return {
    schemaVersion: 1,
    event,
    runtime: 'dsh',
    cwd: eventCwd(agent),
    sessionId: String(agent.id),
    platform: 'host-plugin',
    observedAt: new Date().toISOString(),
    ...(promptDigest ? { promptDigest: promptDigest.slice(0, MAX_PROMPT_CHARS) } : {}),
  };
}

function recalledMessage(context) {
  return createUserMessage({
    content: [{ type: 'text', text: context.slice(0, MAX_INJECT_CHARS) }],
    source: RUNTIME_SOURCE,
  });
}

async function emit(core, agent, event, promptDigest, workspaceOptions) {
  return core.runtime_event(runtimeEvent(agent, event, promptDigest), {
    source: 'managed-hook',
    configurationKey: DSH_RUNTIME_CONFIGURATION_KEY,
    workspace: workspaceOptions,
  });
}

export function installDshLifecycle(ctx, storage, options = {}) {
  const workspaceOptions = storage.memoryRoot
    ? {
        memoryRoot: storage.memoryRoot,
        stateRoot: storage.stateRoot,
        ...(options.space ? { space: options.space } : {}),
      }
    : {
        root: storage.home,
        ...(options.space ? { space: options.space } : {}),
      };
  const normalizeCompaction = options.normalizeDshPreCompactTrigger ?? normalizeDshPreCompactTrigger;
  const runCompaction = options.runNativePreCompact ?? runNativePreCompact;
  const initialCore = Promise.resolve((options.openCore ?? openCore)({ ...workspaceOptions, cwd: storage.workspace }))
    .then(async (core) => {
      await core.configure_runtime('dsh', {
        source: 'managed-hook',
        configurationKey: DSH_RUNTIME_CONFIGURATION_KEY,
      });
      return core;
    });
  const pending = new Set();
  const lastTurn = new WeakMap();
  const track = (promise, label) => {
    const operation = Promise.resolve(promise)
      .catch((error) => ctx.logger.warn(`${label}: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => pending.delete(operation));
    pending.add(operation);
    return operation;
  };

  const finalizeSession = async (agent) => {
    try {
      const core = await initialCore;
      await emit(core, agent, 'runtime.session_finalize', undefined, workspaceOptions);
      await emit(core, agent, 'runtime.session_end', undefined, workspaceOptions);
    } catch (error) {
      ctx.logger.warn(`iHow Memory DSH session finalization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };


  ctx.on('agent/session-start', async ({ agent, source }) => {
    try {
      const core = await initialCore;
      const result = await emit(
        core,
        agent,
        source === 'clear' ? 'runtime.session_reset' : 'runtime.session_start',
        undefined,
        workspaceOptions,
      );
      if (result.context) agent.inject(recalledMessage(result.context));
    } catch (error) {
      ctx.logger.warn(`iHow Memory DSH session-start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ctx.on('agent/pre-step', async ({ agent, messages, turn }, next) => {
    const firstStepForTurn = lastTurn.get(agent) !== turn;
    lastTurn.set(agent, turn);
    if (!firstStepForTurn) return next();
    let result;
    try {
      const core = await initialCore;
      result = await emit(core, agent, 'runtime.before_prompt', textContent(messages), workspaceOptions);
    } catch (error) {
      ctx.logger.warn(`iHow Memory DSH prompt recall failed: ${error instanceof Error ? error.message : String(error)}`);
      return next();
    }
    const decision = await next();
    if (!result.context || decision.kind !== 'enter') return decision;
    return { kind: 'enter', messages: [...decision.messages, recalledMessage(result.context)] };
  });

  ctx.on('session/event', (session, event) => {
    if (event.type === 'compaction/summary') {
      const input = compactionCheckpointInput(session, event);
      track(runCompaction(normalizeCompaction(input), workspaceOptions), 'iHow Memory DSH compaction checkpoint failed');
      return;
    }
    if (event.type !== 'turn/end') return;
    const agent = ctx.agents.get(session.id);
    if (!agent) return;
    track(initialCore.then((core) => emit(core, agent, 'runtime.after_turn', undefined, workspaceOptions)), 'iHow Memory DSH after-turn failed');
  });

  ctx.on('agent/disposed', ({ agent }) => {
    track(finalizeSession(agent), 'iHow Memory DSH session finalization failed');
  });

  ctx.effect(
    () => async () => {
      await Promise.allSettled([...pending]);
    },
    'ihow-memory.lifecycle-drain',
  );
}
