// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { compactionCheckpointInput, installDshLifecycle, sessionCwd } from '../lib/lifecycle.js';

function fakeContext() {
  const listeners = new Map();
  const warnings = [];
  const effects = [];
  return {
    listeners,
    warnings,
    effects,
    logger: { warn: (message) => warnings.push(message) },
    agents: { get: () => undefined },
    on(name, listener) { listeners.set(name, listener); },
    effect(install) {
      const dispose = install();
      effects.push(dispose);
      return dispose;
    },
    async drainEffects() {
      await Promise.all(effects.map((dispose) => dispose()));
    },
  };
}

function user(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
}

test('session helpers bind lifecycle and compaction to the DSH session cwd', () => {
  const session = { id: 'session-1', header: { cwd: '/repo' } };
  assert.equal(sessionCwd(session), '/repo');
  assert.deepEqual(compactionCheckpointInput(session, {
    type: 'compaction/summary',
    time: Date.parse('2026-08-25T12:00:00.000Z'),
    data: { shadowedRange: { start: 2, end: 9 } },
  }), {
    cwd: '/repo',
    sessionId: 'session-1',
    observedAt: '2026-08-25T12:00:00.000Z',
    startSeq: 2,
    endSeq: 9,
  });
  assert.equal(compactionCheckpointInput(session, { type: 'turn/end' }), undefined);
});

test('DSH lifecycle prompt recall appends one identified recall message on the first step only', async () => {
  const ctx = fakeContext();
  const calls = [];
  let configured = 0;
  const core = {
    async configure_runtime(runtime, options) {
      assert.equal(runtime, 'dsh');
      assert.equal(options.configurationKey, 'dsh-host-plugin-v1');
      configured += 1;
    },
    async runtime_event(event, options) {
      calls.push({ event, options });
      return event.event === 'runtime.before_prompt'
        ? { event: event.event, context: '<recalled-memory>remember amber</recalled-memory>', citations: ['memory/test.md'], verdict: 'GREEN' }
        : { event: event.event, citations: [], verdict: 'NONE' };
    },
  };
  installDshLifecycle(ctx, { home: '/memory', memoryRoot: '/memory', workspace: '/repo' }, {
    space: 'main',
    openCore: async () => core,
  });
  const agent = { id: 'session-1', session: { header: { cwd: '/repo' } } };
  const next = async () => ({ kind: 'enter', messages: [user('ship the app')] });

  const first = await ctx.listeners.get('agent/pre-step')({ agent, messages: [user('ship the app')], turn: 1 }, next);
  const second = await ctx.listeners.get('agent/pre-step')({ agent, messages: [], turn: 1 }, next);

  assert.equal(first.messages.length, 2);
  assert.equal(first.messages[1].source.kind, 'plugin');
  assert.equal(first.messages[1].source.form, 'recall');
  assert.match(first.messages[1].content[0].text, /remember amber/);
  assert.equal(second.messages.length, 1);
  assert.equal(calls.filter(({ event }) => event.event === 'runtime.before_prompt').length, 1);
  assert.equal(configured, 1);
  assert.equal(calls[0].options.workspace.memoryRoot, '/memory');
  assert.equal(calls[0].options.workspace.root, undefined);
  assert.equal(calls[0].options.workspace.space, 'main');
});

test('DSH prompt recall preserves a downstream rejected pre-step decision', async () => {
  const ctx = fakeContext();
  const core = {
    async configure_runtime() {},
    async runtime_event() {
      return { event: 'runtime.before_prompt', context: '<recalled-memory>do not resurrect</recalled-memory>', citations: [], verdict: 'GREEN' };
    },
  };
  installDshLifecycle(ctx, { home: '/memory', memoryRoot: '/memory', workspace: '/repo' }, {
    openCore: async () => core,
  });
  const agent = { id: 'session-1', session: { header: { cwd: '/repo' } } };
  const result = await ctx.listeners.get('agent/pre-step')(
    { agent, messages: [user('blocked request')], turn: 1 },
    async () => ({ kind: 'reject' }),
  );
  assert.deepEqual(result, { kind: 'reject' });
});

test('DSH prompt recall never replays a downstream pre-step failure', async () => {
  const ctx = fakeContext();
  const core = {
    async configure_runtime() {},
    async runtime_event() {
      return { event: 'runtime.before_prompt', context: '<recalled-memory>remember once</recalled-memory>', citations: [], verdict: 'GREEN' };
    },
  };
  installDshLifecycle(ctx, { home: '/memory', memoryRoot: '/memory', workspace: '/repo' }, {
    openCore: async () => core,
  });
  const agent = { id: 'session-1', session: { header: { cwd: '/repo' } } };
  let calls = 0;
  await assert.rejects(
    ctx.listeners.get('agent/pre-step')(
      { agent, messages: [user('failing request')], turn: 1 },
      async () => {
        calls += 1;
        throw new Error('downstream failed');
      },
    ),
    /downstream failed/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(ctx.warnings, []);
});

test('DSH lifecycle captures one metadata-only checkpoint from compaction summary', async () => {
  const ctx = fakeContext();
  const captured = [];
  const core = { async configure_runtime() {}, async runtime_event() { return { citations: [], verdict: 'NONE' }; } };
  installDshLifecycle(ctx, { home: '/memory', memoryRoot: '/memory', stateRoot: '/state', workspace: '/repo' }, {
    space: 'main',
    openCore: async () => core,
    normalizeDshPreCompactTrigger: (input) => ({ normalized: input }),
    runNativePreCompact: async (contract, workspace) => { captured.push({ contract, workspace }); },
  });
  const session = { id: 'session-1', header: { cwd: '/repo' } };

  ctx.listeners.get('session/event')(session, {
    type: 'compaction/summary',
    time: Date.parse('2026-08-25T12:00:00.000Z'),
    data: { shadowedRange: { start: 2, end: 9 } },
  });
  await ctx.drainEffects();

  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].contract.normalized, {
    cwd: '/repo',
    sessionId: 'session-1',
    observedAt: '2026-08-25T12:00:00.000Z',
    startSeq: 2,
    endSeq: 9,
  });
  assert.deepEqual(captured[0].workspace, { memoryRoot: '/memory', stateRoot: '/state', space: 'main' });
});

test('DSH lifecycle injects session-start handoff and records shutdown events', async () => {
  const ctx = fakeContext();
  const calls = [];
  const injected = [];
  const core = {
    async configure_runtime() {},
    async runtime_event(event) {
      calls.push(event.event);
      return event.event === 'runtime.session_start'
        ? { event: event.event, context: '{"handoff":"ready"}', citations: ['dsh:prior'], verdict: 'GREEN' }
        : { event: event.event, citations: [], verdict: 'NONE' };
    },
  };
  installDshLifecycle(ctx, { home: '/memory', memoryRoot: '/memory', workspace: '/repo' }, {
    openCore: async () => core,
  });
  const agent = {
    id: 'session-1',
    session: { header: { cwd: '/repo' } },
    inject: (message) => injected.push(message),
  };

  await ctx.listeners.get('agent/session-start')({ agent, source: 'startup' });
  assert.equal(injected.length, 1);
  assert.match(injected[0].content[0].text, /handoff/);

  assert.equal(ctx.listeners.get('agent/disposed')({ agent }), undefined, 'the DSH event remains fire-and-forget');
  await ctx.drainEffects();
  assert.deepEqual(calls, ['runtime.session_start', 'runtime.session_finalize', 'runtime.session_end']);
  assert.deepEqual(ctx.warnings, []);
});
