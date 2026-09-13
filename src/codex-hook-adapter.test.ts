import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ContinuityService } from './continuity.js';
import { CodexHookServiceAdapter } from './codex-hook-adapter.js';
import type { CodexHookContext } from './codex-hook-service.js';
import { compilationContentHash } from './compilation-model.js';
import { OwnerActivityRuntime } from './owner-activity-runtime.js';
import { OwnerActivityPolicy } from './owner-activity.js';

let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, context: CodexHookContext, current: typeof actor | undefined;
const actor = { accountId: 'operator', modelId: 'test', role: 'agent' as const, agentId: 'worker', capabilities: ['write', 'publish'] as any };
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'codex-hook-adapter-')); fs = new FileSystemService(vault); access = new ScopeAccessPolicy(); current = actor;
  context = { requestId: 'hook-' + 'a'.repeat(64), deadline: Date.now() + 300000, maxChars: 3000, signal: new AbortController().signal,
    assertCurrent: async () => {}, ticket: { accountId: 'operator', paths: ['Source.md'], work: { action: 'candidate', path: 'Source.md', expectedRevision: 'a'.repeat(64) } } as any };
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
const adapter = (extra = {}) => new CodexHookServiceAdapter({ fs, access, authorize: async () => current,
  continuity: new ContinuityService(fs, { access }), ...extra } as any);
async function seed(path: string, content: string) { await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), content); }

test('resume uses current continuity validation and never starts a session or rewrites state', async () => {
  context.ticket.paths = ['_scopes/agents/worker/_continuity/work-state.md'];
  const result = await adapter().execute({ action: 'resume' }, context);
  expect(result).toMatchObject({ status: 'completed', packet: { exists: false } });
  expect(await fs.noteExists(context.ticket.paths[0]!)).toBe(false);
});
test('candidate requires actual immutable bytes and current revision, then coalesces existing compilation invalidation', async () => {
  const body = 'Only when enabled, retain version 2.0.';
  await seed('Source.md', `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${compilationContentHash(body)}\n---\n${body}`);
  const revision = await fs.readNoteRevision('Source.md');
  const work = { action: 'candidate' as const, path: 'Source.md', expectedRevision: revision };
  const notify = vi.fn(async () => {}), a = adapter({ compilation: { notify } });
  expect(await a.execute(work, context)).toEqual({ status: 'completed', revision }); expect(notify).toHaveBeenCalledWith(['Source.md']);
  expect(await a.reconcile(work, context)).toEqual({ status: 'completed', revision }); expect(notify).toHaveBeenCalledTimes(1);
  await seed('Source.md', 'Edited'); expect(await a.reconcile(work, context)).toEqual({ status: 'partial' });
});
test('search URL, source label or incorrect checksum does not prove material was acquired', async () => {
  const notify = vi.fn();
  for (const body of ['https://example.test/paper', '---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: bad\n---\ntext']) {
    await seed('Source.md', body);
    expect(await adapter({ compilation: { notify } }).execute({ action: 'candidate', path: 'Source.md', expectedRevision: await fs.readNoteRevision('Source.md') }, context)).toEqual({ status: 'partial' });
  }
  expect(notify).not.toHaveBeenCalled();
});
test('missing local prepared-checkpoint store never falls back to a NAS save', async () => {
  expect(await adapter().execute({ action: 'checkpoint', checkpointId: 'prepared', expectedRevision: 'a'.repeat(64) }, context)).toEqual({ status: 'partial' });
});
test('revoked actor and grant-excluded paths fail without exposing names', async () => {
  current = undefined;
  await expect(adapter().execute({ action: 'resume' }, context)).rejects.toThrow('Hook operation unavailable');
  current = actor;
  await expect(adapter().execute({ action: 'candidate', path: 'Hidden.md', expectedRevision: 'a'.repeat(64) }, context)).rejects.toThrow('Hook operation unavailable');
});
test('compilation uses one pinned retry, never submits generated prose or repeats on reconciliation', async () => {
  const execute = vi.fn(async () => ({ status: 'completed', jobRevision: 'b'.repeat(64) })), a = adapter({ compilation: { execute } });
  const work = { action: 'compilation' as const, requestId: 'job', expectedJobRevision: 'a'.repeat(64) };
  await a.execute(work, context); expect(execute.mock.calls[0]?.[0]).toMatchObject({ op: 'retry', requestId: 'job', expectedJobRevision: work.expectedJobRevision });
  await a.reconcile(work, context); expect(execute.mock.calls[1]?.[0]).toMatchObject({ op: 'read', requestId: 'job' });
});
test('community requires the existing owner consent in addition to the hook grant', async () => {
  const pulse = vi.fn(async () => ({ state: 'ready' }));
  await expect(adapter({ participation: { pulse } }).execute({ action: 'community' }, context)).rejects.toThrow('Hook operation unavailable');
  expect(pulse).not.toHaveBeenCalled();
});
test('community reuses consent/quota pulse without starting or publishing a participation run', async () => {
  const pulse = vi.fn(async () => ({ state: 'paused', candidates: [] })), record = vi.fn();
  const policy = new OwnerActivityPolicy({ version: 1, owners: { operator: 'owner' }, grants: [{ id: 'consent', ownerId: 'owner',
    accountIds: ['operator'], activities: ['collaboration'], actions: ['read'], dataPrefixes: ['.'], executionTargets: ['host'], expiresAt: '2999-01-01T00:00:00Z' }] });
  const ownerActivity = new OwnerActivityRuntime({ policy: () => policy, execution: () => ({ accountId: 'operator', executionTarget: 'host' }) });
  const result = await adapter({ participation: { pulse, record }, ownerActivity }).execute({ action: 'community' }, context);
  expect(result).toMatchObject({ status: 'completed' }); expect(record).not.toHaveBeenCalled();
  expect(result.packet).toBeUndefined();
});
test('permission changes after reading suppress the packet', async () => {
  const continuity = { read: async () => { current = undefined; return { content: 'SECRET' }; } };
  await expect(adapter({ continuity }).execute({ action: 'resume' }, context)).rejects.toThrow('Hook operation unavailable');
});

test('confidential inputs require host-attested locality even when the account can read them', async () => {
  access = new ScopeAccessPolicy({ documentRules: () => [{ path: 'Source.md', confidential: true, accountIds: ['operator'] }], localInferenceAllowed: () => true });
  const read = vi.fn(async () => ({ content: 'secret' }));
  await expect(adapter({ continuity: { read } }).execute({ action: 'resume' }, context)).rejects.toThrow('Hook operation unavailable');
  expect(read).not.toHaveBeenCalled();
  context.ticket.runtimeLocal = true;
  expect(await adapter({ continuity: { read } }).execute({ action: 'resume' }, context)).toMatchObject({ status: 'completed' });
});

test('the physical write guard checks cancellation again after an asynchronous compiler step', async () => {
  await seed('Source.md', 'Original user text'); const revision = await fs.readNoteRevision('Source.md');
  const controller = new AbortController(); context.signal = controller.signal;
  const compilation = { execute: async () => {
    controller.abort(); await fs.writeNote({ path: 'Source.md', content: 'Must not be written', expectedRevision: revision });
    return { status: 'completed', jobRevision: 'b'.repeat(64) };
  } };
  await expect(adapter({ compilation }).execute({ action: 'compilation', requestId: 'job', expectedJobRevision: 'a'.repeat(64) }, context)).rejects.toThrow('Hook operation unavailable');
  expect(await fs.readNoteRevision('Source.md')).toBe(revision);
});

test('a service cannot read a same-account note outside the exact hook path grant', async () => {
  await seed('Hidden.md', 'Private excluded text');
  const continuity = { read: async () => ({ content: (await fs.readNote('Hidden.md')).content }) };
  await expect(adapter({ continuity }).execute({ action: 'resume' }, context)).rejects.toThrow('Hook operation unavailable');
});

test('missing continuity outside the hook grant cannot return its identity as an absent record', async () => {
  await expect(adapter().execute({ action: 'resume' }, context)).rejects.toThrow('Hook operation unavailable');
});

test('nested locator identities in returned packets must also be inside the current hook grant', async () => {
  const continuity = { read: async () => ({ nextAction: { arguments: { path: 'Hidden.md', expectedRevision: 'a'.repeat(64) } } }) };
  await expect(adapter({ continuity }).execute({ action: 'resume' }, context)).rejects.toThrow('Hook operation unavailable');
});
