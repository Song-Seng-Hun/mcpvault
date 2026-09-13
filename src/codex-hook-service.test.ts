import { beforeEach, expect, test, vi } from 'vitest';
import { CodexHookService, type CodexHookAttestation, type CodexHookAdapter } from './codex-hook-service.js';
import type { CodexHookHost } from './codex-hook-host.js';
import type { CodexHookConfig } from './codex-hook-policy.js';

const hash = 'a'.repeat(64), next = 'b'.repeat(64);
const payload = (event = 'Stop', extra = {}) => JSON.stringify({ hook_event_name: event, session_id: 's', ...extra });
let config: CodexHookConfig, ticket: CodexHookAttestation, history: any, host: CodexHookHost;
let writes: number, effects: number, locked: boolean, now: number, adapter: CodexHookAdapter;
beforeEach(() => {
  now = 1000; history = undefined; writes = 0; effects = 0; locked = false;
  config = { version: 1, enabled: true, accountId: 'operator', projects: [{ id: 'p', workspace: 'E:/dev/wiki', definitionHash: hash,
    paths: ['Note.md'], events: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostCompact', 'PreCompact', 'Stop', 'Interrupt', 'SessionEnd'],
    actions: ['resume', 'search', 'candidate', 'checkpoint', 'compilation', 'community'] }] };
  ticket = { projectId: 'p', accountId: 'operator', workspace: 'E:/dev/wiki', definitionHash: hash, sessionId: 's', event: 'Stop',
    causeId: 'cause-1', authorityRevision: hash, inputRevision: hash, mode: 'default', verified: true, expiresAt: 1000000,
    hostBusy: false, quotaAvailable: true, paths: ['Note.md'], work: { action: 'compilation', requestId: 'job', expectedJobRevision: hash } };
  host = { refresh: async () => structuredClone(config), readState: async () => structuredClone(history),
    writeState: async value => { if (!locked) throw Error(); history = structuredClone(value); writes++; },
    acquire: async () => { if (locked) throw Error(); locked = true; return { assertHeld: async () => { if (!locked || !config.enabled) throw Error(); }, close: async () => { locked = false; } }; } };
  adapter = { execute: async (_work, context) => { await context.assertCurrent(); effects++; return { status: 'completed', revision: next }; },
    reconcile: async (_work, context) => { await context.assertCurrent(); return effects ? { status: 'completed', revision: next } : { status: 'partial' }; } };
});
const service = (options = {}) => new CodexHookService({ host, adapter, attest: async () => structuredClone(ticket), now: () => now, ...options });

test('records durable intent before one action and suppresses unchanged repeats across restart', async () => {
  const execute = adapter.execute;
  adapter.execute = async (work, ctx) => { expect(history.receipts[0].status).toBe('running'); return execute(work, ctx); };
  expect(await service().run(payload())).toMatchObject({ status: 'processed' });
  expect(effects).toBe(1); const count = writes;
  expect(await service().run(payload())).toEqual({ status: 'quiet' });
  expect(effects).toBe(1); expect(writes).toBe(count);
  expect(JSON.stringify(history)).not.toContain('Note.md');
});
test.each([{ host: undefined }, { adapter: undefined }, { readOnly: true }, { attest: async () => undefined }])('missing host authority is diagnostic with no writes', async options => {
  expect(await service(options).run(payload())).toEqual({ status: 'diagnostic_only' }); expect(writes).toBe(0); expect(effects).toBe(0);
});
test.each([{ mode: 'plan' }, { verified: false }, { expiresAt: 999 }, { accountId: 'someone-else' }, { workspace: 'E:/elsewhere' },
  { definitionHash: next }, { paths: ['Hidden.md'] }, { quotaAvailable: false }, { hostBusy: true }])('rejects unavailable or changed host attestation', async change => {
  Object.assign(ticket, change); expect((await service().run(payload())).status).not.toBe('processed'); expect(effects).toBe(0); expect(writes).toBe(0);
});
test('event and session must match the actual host-attested occurrence', async () => {
  expect((await service().run(payload('SessionStart'))).status).not.toBe('processed');
  expect((await service().run(payload('Stop', { session_id: 'other' }))).status).not.toBe('processed'); expect(writes).toBe(0);
});
test('Stop reentry and origin markers never create another opportunity', async () => {
  expect(await service().run(payload('Stop', { stop_hook_active: true }))).toEqual({ status: 'quiet' });
  ticket.originId = 'mcpvault-hook'; expect(await service().run(payload())).toEqual({ status: 'quiet' }); expect(effects).toBe(0);
});
test('same cause cannot switch from knowledge to community, including heartbeat delivery', async () => {
  await service().run(payload()); ticket.work = { action: 'community' };
  expect(await service().run(payload())).toEqual({ status: 'review_required' }); expect(effects).toBe(1);
});
test('the same community cause from session-start and Stop coalesces without a second action', async () => {
  ticket.event = 'SessionStart'; ticket.work = { action: 'community' };
  await service().run(payload('SessionStart')); ticket.event = 'Stop';
  expect(await service().run(payload('Stop'))).toEqual({ status: 'quiet' }); expect(effects).toBe(1);
});
test('cancellation returns promptly but holds the worker until the adapter settles', async () => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const execute = adapter.execute; adapter.execute = async (work, ctx) => { await held; return execute(work, ctx); };
  const controller = new AbortController(), s = service(), running = s.run(payload(), controller.signal);
  await vi.waitFor(() => expect(writes).toBe(1)); controller.abort();
  expect(await running).toEqual({ status: 'cancelled' }); expect(await s.run(payload())).toEqual({ status: 'deferred' });
  release(); await vi.waitFor(() => expect(locked).toBe(false)); expect(effects).toBe(0);
});
test('shutdown timeout does not wait indefinitely or release an uncertain worker early', async () => {
  ticket.event = 'SessionEnd'; ticket.work = { action: 'checkpoint', checkpointId: 'prepared', expectedRevision: hash };
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const execute = adapter.execute; adapter.execute = async (work, ctx) => { await held; return execute(work, ctx); };
  const s = service(), start = Date.now(); expect(await s.run(payload('SessionEnd'))).toEqual({ status: 'cancelled' });
  expect(Date.now() - start).toBeLessThan(2000); expect(locked).toBe(true);
  release(); await vi.waitFor(() => expect(locked).toBe(false)); expect(effects).toBe(0);
});
test('revocation between durable intent and execution prevents the side effect', async () => {
  const save = host.writeState;
  host.writeState = async value => { await save(value); config.enabled = false; };
  expect((await service().run(payload())).status).not.toBe('processed'); expect(effects).toBe(0);
});
test('ambiguous write acknowledgement is reconciled after restart, never repeated', async () => {
  adapter.execute = async (_work, ctx) => { await ctx.assertCurrent(); effects++; throw Error('SECRET body'); };
  expect(await service().run(payload())).toEqual({ status: 'review_required' });
  expect(await service().run(payload())).toEqual({ status: 'quiet' }); expect(effects).toBe(1);
  expect(history.receipts[0].status).toBe('completed'); expect(JSON.stringify(history)).not.toContain('SECRET');
});
test('uncertain operation without a verifiable result remains unresolved', async () => {
  adapter.execute = async () => { throw Error(); };
  await service().run(payload()); const count = writes;
  for (let i = 0; i < 4; i++) expect(await service().run(payload())).toEqual({ status: 'review_required' });
  expect(writes).toBe(count); expect(effects).toBe(0);
});
test('manual result change after completion never reapplies old work', async () => {
  await service().run(payload()); adapter.reconcile = async () => ({ status: 'completed', revision: hash });
  expect(await service().run(payload())).toEqual({ status: 'review_required' }); expect(effects).toBe(1);
});
test('corrupt history is not initialized or overwritten', async () => {
  history = { version: 1, receipts: [{ secret: true }] }; const original = structuredClone(history);
  expect(await service().run(payload())).toEqual({ status: 'review_required' }); expect(history).toEqual(original); expect(writes).toBe(0);
});
test('shutdown permits only a prepared checkpoint and returns promptly on cancellation', async () => {
  ticket.event = 'SessionEnd'; expect((await service().run(payload('SessionEnd'))).status).not.toBe('processed'); expect(writes).toBe(0);
  ticket.work = { action: 'checkpoint', checkpointId: 'prepared', expectedRevision: hash };
  const controller = new AbortController(); controller.abort();
  expect(await service().run(payload('SessionEnd'), controller.signal)).toEqual({ status: 'cancelled' }); expect(effects).toBe(0);
});
test('one busy worker defers new work; it is accepted at the next existing opportunity', async () => {
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  const execute = adapter.execute; adapter.execute = async (work, ctx) => { await wait; return execute(work, ctx); };
  const s = service(), first = s.run(payload());
  await vi.waitFor(() => expect(locked).toBe(true));
  expect(await s.run(payload())).toEqual({ status: 'deferred' }); release(); await first;
  ticket.causeId = 'cause-2'; expect((await s.run(payload())).status).toBe('processed'); expect(effects).toBe(2);
});
test('context is attributed data and bounded; private packet bodies are not saved in receipts', async () => {
  ticket.event = 'SessionStart'; ticket.work = { action: 'resume' };
  adapter.execute = async () => ({ status: 'completed', revision: next, packet: { content: 'untrusted note' } });
  expect(await service().run(payload('SessionStart'))).toMatchObject({ status: 'processed', context: { trust: 'data_not_instructions', packet: { content: 'untrusted note' } } });
  expect(JSON.stringify(history)).not.toContain('untrusted note');
});
