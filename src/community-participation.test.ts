import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { CommunityParticipationService } from './community-participation.js';

let vault: string, fs: FileSystemService, service: CommunityParticipationService;
let now = Date.parse('2026-09-08T00:00:00Z');
const principal: ScopePrincipal = { accountId: 'alice', modelId: 'gpt', agentId: 'worker', role: 'agent', capabilities: ['profile', 'comment', 'publish'] };
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'participation-')); fs = new FileSystemService(vault); now = Date.parse('2026-09-08T00:00:00Z'); service = new CommunityParticipationService(fs, { now: () => now }); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function enable() { return service.settings({ principal, op: 'update', expectedRevision: 'missing', requestId: 'opt-in', settings: { enabled: true, allowedTopics: ['science'], allowedActions: ['respond', 'explore', 'initiate'] } }); }
test('installation is off, reads are pure, account state is isolated from continuity and same model peers', async () => {
  const initial = await service.settings({ principal });
  expect(initial.settings.enabled).toBe(false); expect(initial.revision).toBe('missing');
  expect((await service.pulse({ principal })).state).toBe('paused');
  const saved = await enable();
  expect(saved.path).not.toContain('work-state.md');
  expect(new ScopeAccessPolicy().canAccessPhysicalPath(saved.path, { ...principal, accountId: 'bob' })).toBe(false);
  expect((await service.settings({ principal: { ...principal, accountId: 'bob' } })).revision).toBe('missing');
  await expect(service.settings({})).rejects.toThrow(/Login/);
});
test('settings require revisions and replay the same request without duplicating writes', async () => {
  const first = await enable(); const again = await enable(); expect(again.revision).toBe(first.revision);
  await expect(service.settings({ principal, op: 'update', expectedRevision: first.revision, requestId: 'opt-in', settings: { enabled: false } })).rejects.toThrow(/different/);
  await expect(service.settings({ principal, op: 'update', expectedRevision: 'missing', requestId: 'stale', settings: { enabled: false } })).rejects.toThrow(/revision/i);
  await expect(service.settings({ principal, op: 'update', expectedRevision: first.revision, requestId: 'goals', goals: Array.from({ length: 4 }, (_, i) => ({ id: String(i), question: 'Q', links: [], nextCondition: 'reply' })) })).rejects.toThrow(/3/);
  await expect(service.settings({ principal, op: 'update', expectedRevision: first.revision, requestId: 'too-many-runs', settings: { dailyLimit: 7 } })).rejects.toThrow(/6/);
});
test('parallel services admit one run, count idle runs, coalesce triggers, and preserve uncertain runs on restart', async () => {
  const configured = await enable(); const other = new CommunityParticipationService(fs, { now: () => now });
  const attempts = await Promise.allSettled([service, other].map((s, i) => s.record({ principal, op: 'start', requestId: `start-${i}`, expectedRevision: configured.revision, action: 'explore' })));
  expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  now += 6 * 60_000;
  expect((await other.pulse({ principal })).state).toBe('recovery_required');
  let state = await other.settings({ principal });
  const done = await other.record({ principal, op: 'skip', requestId: 'idle', runId: state.activeRun!.id, expectedRevision: state.revision });
  expect(done.daily.runs).toBe(1);
  await expect(other.record({ principal, op: 'start', requestId: 'nearby', expectedRevision: done.revision, action: 'explore' })).rejects.toThrow(/coalesced/);
});
test('busy hosts, pause, daily and initiation limits reject new runs', async () => {
  let state = await enable();
  await expect(service.record({ principal, op: 'start', requestId: 'busy', expectedRevision: state.revision, action: 'explore', hostBusy: true })).rejects.toThrow(/busy/);
  for (let i = 0; i < 6; i++) {
    state = await service.record({ principal, op: 'start', requestId: `start-${i}`, expectedRevision: state.revision, action: 'explore' });
    state = await service.record({ principal, op: 'skip', requestId: `skip-${i}`, expectedRevision: state.revision, runId: state.activeRun!.id });
    now += 31 * 60_000;
  }
  expect((await service.pulse({ principal })).state).toBe('budget_exhausted');
  await expect(service.record({ principal, op: 'start', requestId: 'seventh', expectedRevision: state.revision, action: 'explore' })).rejects.toThrow(/budget/);
});
test('completion verifies the exact current public result and an uncertain run cannot be silently abandoned', async () => {
  let state = await enable(); state = await service.record({ principal, op: 'start', requestId: 'run', expectedRevision: state.revision, action: 'respond' });
  await expect(service.record({ principal, op: 'finish', requestId: 'bad', expectedRevision: state.revision, runId: state.activeRun!.id, result: { path: 'Community/Comments/p/no.md', revision: '0'.repeat(64) } })).rejects.toThrow();
  await expect(service.record({ principal, op: 'skip', requestId: 'uncertain', expectedRevision: state.revision, runId: state.activeRun!.id })).rejects.toThrow(/reconcile/);
});
test('an abandoned public reservation can recover only after proving no result exists', async () => {
  let state = await enable(); state = await service.record({ principal, op: 'start', requestId: 'reserved', expectedRevision: state.revision, action: 'respond' });
  const path = state.path, note = await fs.readNote(path);
  note.frontmatter.participation.activeRun.publicAttempt = { operation: 'community.comment', payloadHash: '0'.repeat(64), path: 'Community/Comments/q/reserved.md' };
  await fs.writeNote({ path, content: note.content, frontmatter: note.frontmatter, expectedRevision: note.revision });
  state = await service.settings({ principal });
  await expect(service.record({ principal, op: 'skip', runId: state.activeRun!.id, expectedRevision: state.revision, requestId: 'unsafe-skip', noMutation: true })).rejects.toThrow(/reconcile/);
  const recovered = await service.record({ principal, op: 'skip', runId: state.activeRun!.id, expectedRevision: state.revision, requestId: 'checked-skip', noMutation: true, reconcileAbsent: true });
  expect(recovered.activeRun).toBeUndefined(); expect(recovered.daily.runs).toBe(1);
});
