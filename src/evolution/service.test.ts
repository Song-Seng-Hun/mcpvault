import { expect, test, vi } from 'vitest';
import { EvolutionService } from './service.js';
import { hash } from './policy.js';

export function fixture() {
  const values = new Map<string, any>(); let held = false, allowed = true;
  const principal: any = { accountId: 'alice', modelId: 'codex', agentId: 'worker', capabilities: ['write'] };
  const storage: any = { refresh: async () => ({ version: 1, enabled: true }),
    acquire: async () => { if (held) throw Error('busy'); held = true; return { assertHeld: async () => { if (!held) throw Error('lost'); }, close: async () => { held = false; } }; },
    records: { read: async (key: string) => ({ revision: values.has(key) ? hash(values.get(key)) : 'missing', value: structuredClone(values.get(key)) }),
      write: async (key: string, value: any, expected: string) => { if (!held || expected !== (values.has(key) ? hash(values.get(key)) : 'missing')) throw Error('conflict'); values.set(key, structuredClone(value)); return { revision: hash(value) }; } } };
  const options: any = { storage, now: () => Date.parse('2026-09-17T00:00:00Z'),
    authority: async (p: any) => { if (!allowed || p.accountId !== 'alice') throw Error('denied'); return { ownerId: 'owner', revision: 'policy1', sharedOwner: false, assertCurrent: async () => { if (!allowed) throw Error('revoked'); } }; },
    attest: async (token: string, _p: any, raw: any) => token === 'host-event' ? { origin: 'human', eventId: raw.id, taskId: raw.taskId, sessionId: raw.sessionId, observedAt: '2026-09-16T00:00:00Z' } : undefined,
    verifyEvidence: async () => true,
    profile: () => ({ revision: 'profile1', caseIds: ['normal', 'holdout'], targetCaseIds: ['normal'], holdoutCaseIds: ['holdout'] }),
    evaluate: async () => ({ profileRevision: 'profile1', safety: true, targetCaseIds: ['normal'], cases: [
      { id: 'normal', split: 'development', baseline: false, candidate: true },
      { id: 'holdout', split: 'holdout', baseline: true, candidate: true },
    ] }),
    proveUse: async (token: string, cycle: any) => token === 'used-later' ? { taskId: 'later', sessionId: 'next', revision: cycle.outputRevision, success: true } : undefined,
  };
  const service = new EvolutionService(options);
  const raw = { id: 'feedback1', taskId: 'task1', sessionId: 'session1', target: { kind: 'persona', id: 'assistant' },
    scope: { kind: 'project', id: 'wiki' }, kind: 'preference', signal: 'explicit', key: 'verbosity', value: 'brief', summary: 'Brief outcomes first.', basis: [] };
  const call = (endpoint: string, args: any) => service.execute(endpoint, args, principal);
  return { service, options, principal, raw, call, revoke: () => { allowed = false; } };
}

test('shutdown cancels evaluation and rejects new work without persisting a late verdict', async () => {
  const f = fixture(); let signal!: AbortSignal, ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  f.options.evaluate = async (_cycle: unknown, _principal: unknown, s: AbortSignal) => {
    signal = s; ready(); return new Promise(() => {});
  };
  await f.call('feedback', { op: 'record', feedback: f.raw, eventToken: 'host-event', requestId: 'r', expectedRevision: 'missing' });
  let c = await f.call('cycle', { op: 'prepare', cycleId: 'closing', feedbackIds: [f.raw.id], requestId: 'p', expectedRevision: 'missing' });
  c = await f.call('cycle', { op: 'advance', cycleId: c.cycleId, candidate: { key: 'verbosity', value: 'brief' }, requestId: 'a', expectedRevision: c.revision });
  const checking = f.call('cycle', { op: 'check', cycleId: c.cycleId, requestId: 'check', expectedRevision: c.revision });
  const rejected = expect(checking).rejects.toThrow();
  await started; await f.service.close(); await rejected;
  expect(signal.aborted).toBe(true);
  await expect(f.call('context', {})).rejects.toThrow();
});

async function applyPreference(f: ReturnType<typeof fixture>, key: string, value: string, suffix: string) {
  await f.call('feedback', { op: 'record', feedback: { ...f.raw, id: `f${suffix}`, key, value }, eventToken: 'host-event', requestId: `r${suffix}`, expectedRevision: 'missing' });
  let c = await f.call('cycle', { op: 'prepare', cycleId: `c${suffix}`, feedbackIds: [`f${suffix}`], requestId: `p${suffix}`, expectedRevision: 'missing' });
  c = await f.call('cycle', { op: 'advance', cycleId: c.cycleId, candidate: { key, value }, requestId: `a${suffix}`, expectedRevision: c.revision });
  c = await f.call('cycle', { op: 'check', cycleId: c.cycleId, requestId: `e${suffix}`, expectedRevision: c.revision });
  const preview = await f.call('cycle', { op: 'preview', cycleId: c.cycleId });
  return f.call('cycle', { op: 'apply', cycleId: c.cycleId, fingerprint: preview.fingerprint, requestId: `apply${suffix}`, expectedRevision: c.revision });
}

test('harness changes use native cycle CAS, model/task scope and reversible host records', async () => {
  const f = fixture();
  f.raw = { ...f.raw, target: { kind: 'harness', id: 'research' }, key: 'route', value: 'keyword' } as any;
  await f.call('feedback', { op: 'record', feedback: f.raw, eventToken: 'host-event', requestId: 'record', expectedRevision: 'missing' });
  let c = await f.call('cycle', { op: 'prepare', cycleId: 'harness', feedbackIds: [f.raw.id], requestId: 'prepare', expectedRevision: 'missing' });
  const profile = { modelId: 'codex', taskKind: 'research', route: 'keyword', optionalSkillBundles: 0,
    maxChars: 4000, expansionLimit: 0, repairLimit: 0, optionalReview: false };
  c = await f.call('cycle', { op: 'advance', cycleId: c.cycleId, candidate: profile, requestId: 'advance', expectedRevision: c.revision });
  c = await f.call('cycle', { op: 'check', cycleId: c.cycleId, requestId: 'check', expectedRevision: c.revision });
  const preview = await f.call('cycle', { op: 'preview', cycleId: c.cycleId });
  c = await f.call('cycle', { op: 'apply', cycleId: c.cycleId, fingerprint: preview.fingerprint, requestId: 'apply', expectedRevision: c.revision });
  expect(c.status).toBe('applied');
  expect((await f.call('context', { project: 'wiki', taskKind: 'research' })).harness.profile).toEqual(profile);
  expect((await f.call('context', { project: 'wiki', taskKind: 'coding' })).harness).toBeUndefined();
  expect((await f.service.execute('context', { project: 'wiki', taskKind: 'research' }, { ...f.principal, modelId: 'another' })).harness).toBeUndefined();
  expect((await f.call('cycle', { op: 'revert', cycleId: c.cycleId, requestId: 'undo', expectedRevision: c.revision })).status).toBe('withdrawn');
  expect((await f.call('context', { project: 'wiki', taskKind: 'research' })).harness).toBeUndefined();
});

test('independent expression keys coexist; explicit withdrawal permits a new preference', async () => {
  const f = fixture(); const first = await applyPreference(f, 'verbosity', 'brief', 'one');
  await applyPreference(f, 'tone', 'direct', 'two');
  expect((await f.call('context', { project: 'wiki' })).preferences).toHaveLength(2);
  await f.call('cycle', { op: 'revert', cycleId: first.cycleId, requestId: 'undo', expectedRevision: first.revision });
  await applyPreference(f, 'verbosity', 'detailed', 'three');
  expect((await f.call('context', { project: 'wiki' })).preferences.map((p: any) => p.value).sort()).toEqual(['detailed', 'direct']);
});

test('feedback does not allow raw event credentials in continuation or persisted evidence', async () => {
  const f = fixture();
  await expect(f.call('feedback', { op: 'record', feedback: { ...f.raw, summary: 'password=pretend-secret' }, requestId: 'bad', expectedRevision: 'missing' })).rejects.toThrow();
});

test('withdrawing a signal hides its overlay immediately but does not block exact-result rollback', async () => {
  const f = fixture(), c = await applyPreference(f, 'verbosity', 'brief', 'withdraw');
  const signal = await f.call('feedback', { op: 'read', feedbackId: 'fwithdraw' });
  await f.call('feedback', { op: 'withdraw', feedbackId: 'fwithdraw', requestId: 'withdraw', expectedRevision: signal.revision });
  expect((await f.call('context', { project: 'wiki' })).preferences).toHaveLength(0);
  const undo = { op: 'revert', cycleId: c.cycleId, requestId: 'undo', expectedRevision: c.revision };
  expect((await f.call('cycle', undo)).status).toBe('withdrawn');
  expect((await f.call('cycle', undo)).status).toBe('withdrawn');
});

test('TaskGrad accepts one attested concrete task failure, not an inferred personal preference', async () => {
  const f = fixture();
  f.options.attest = async (_token: string, _p: any, raw: any) => ({ origin: 'host_observation', eventId: raw.id, taskId: raw.taskId, sessionId: raw.sessionId, observedAt: '2026-09-16T00:00:00Z' });
  f.options.adapters = { wiki: { read: async () => ({ revision: hash('source'), value: null }) } };
  await f.call('feedback', { op: 'record', feedback: { ...f.raw, target: { kind: 'wiki', id: 'job' }, kind: 'correction', cause: 'knowledge', basis: [{ path: 'source.md', revision: hash('source') }] }, eventToken: 'host', requestId: 'r', expectedRevision: 'missing' });
  expect((await f.call('cycle', { op: 'prepare', cycleId: 'taskgrad', feedbackIds: [f.raw.id], requestId: 'p', expectedRevision: 'missing' })).status).toBe('observed');
  await f.call('feedback', { op: 'record', feedback: { ...f.raw, id: 'preference' }, eventToken: 'host', requestId: 'r2', expectedRevision: 'missing' });
  expect((await f.call('cycle', { op: 'prepare', cycleId: 'humangrad', feedbackIds: ['preference'], requestId: 'p2', expectedRevision: 'missing' })).status).toBe('review_required');
});

test('a non-cooperative evaluator times out without allowing a second evaluator or late writes', async () => {
  const f = fixture(); let started = 0, release!: (value: any) => void;
  const evaluation = await f.options.evaluate();
  f.options.evaluate = async () => { started++; return new Promise(resolve => { release = resolve; }); };
  await f.call('feedback', { op: 'record', feedback: f.raw, eventToken: 'host-event', requestId: 'r', expectedRevision: 'missing' });
  let c = await f.call('cycle', { op: 'prepare', cycleId: 'bounded', feedbackIds: [f.raw.id], requestId: 'p', expectedRevision: 'missing' });
  c = await f.call('cycle', { op: 'advance', cycleId: c.cycleId, candidate: { key: 'verbosity', value: 'brief' }, requestId: 'a', expectedRevision: c.revision });
  vi.useFakeTimers();
  try {
    const checking = f.call('cycle', { op: 'check', cycleId: c.cycleId, requestId: 'check', expectedRevision: c.revision });
    await vi.advanceTimersByTimeAsync(300001);
    c = await checking;
    expect(c).toMatchObject({ status: 'review_required', reason: 'evaluation_interrupted' });
    release(evaluation); await vi.advanceTimersByTimeAsync(0);
    expect((await f.call('cycle', { op: 'read', cycleId: c.cycleId })).status).toBe('review_required');
    expect(started).toBe(1);
  } finally { vi.useRealTimers(); }
});

test('host exceptions never disclose private paths, source text or credentials', async () => {
  const f = fixture();
  f.options.authority = async () => { throw Error('secret-private-title E:/host/credential.json'); };
  await expect(f.call('feedback', { op: 'read', feedbackId: 'f' })).rejects.toThrow(/^Evolution unavailable in the current scope$/);
});

test('repeated identical preferences do not rewrite an existing overlay', async () => {
  const f = fixture(); await applyPreference(f, 'verbosity', 'brief', 'original');
  await expect(applyPreference(f, 'verbosity', 'brief', 'duplicate')).rejects.toThrow();
  expect((await f.call('context', { project: 'wiki' })).preferences).toHaveLength(1);
});

test('a withdrawn host event cannot be resurrected under another feedback ID', async () => {
  const f = fixture();
  f.options.attest = async (_token: string, _p: any, raw: any) => ({ origin: 'human', eventId: 'same-host-event', taskId: raw.taskId, sessionId: raw.sessionId, observedAt: '2026-09-16T00:00:00Z' });
  const first = await f.call('feedback', { op: 'record', feedback: f.raw, eventToken: 'event', requestId: 'one', expectedRevision: 'missing' });
  await f.call('feedback', { op: 'withdraw', feedbackId: f.raw.id, requestId: 'withdraw', expectedRevision: first.revision });
  await expect(f.call('feedback', { op: 'record', feedback: { ...f.raw, id: 'new-id' }, eventToken: 'event', requestId: 'two', expectedRevision: 'missing' })).rejects.toThrow();
});

test('changed evaluation cases invalidate served overlays even if the host forgot to bump the label', async () => {
  const f = fixture(); await applyPreference(f, 'verbosity', 'brief', 'profile');
  f.options.profile = () => ({ revision: 'profile1', caseIds: ['different'], targetCaseIds: ['different'] });
  expect((await f.call('context', { project: 'wiki' })).preferences).toHaveLength(0);
});

test('evaluation profile is pinned before candidate checking; holdout identities cannot be relabeled', async () => {
  const f = fixture(); let evaluated = 0;
  const evaluate = f.options.evaluate;
  f.options.evaluate = async (...args: any[]) => { evaluated++; return evaluate(...args); };
  await f.call('feedback', { op: 'record', feedback: f.raw, eventToken: 'host-event', requestId: 'r', expectedRevision: 'missing' });
  let c = await f.call('cycle', { op: 'prepare', cycleId: 'pinned', feedbackIds: [f.raw.id], requestId: 'p', expectedRevision: 'missing' });
  c = await f.call('cycle', { op: 'advance', cycleId: c.cycleId, candidate: { key: 'verbosity', value: 'brief' }, requestId: 'a', expectedRevision: c.revision });
  f.options.profile = () => ({ revision: 'profile1', caseIds: ['normal', 'holdout'], targetCaseIds: ['normal'], holdoutCaseIds: ['normal'] });
  await expect(f.call('cycle', { op: 'check', cycleId: c.cycleId, requestId: 'check', expectedRevision: c.revision })).rejects.toThrow();
  expect(evaluated).toBe(0);
});

test('application receipt interruption reconciles the one written overlay without repeating the mutation', async () => {
  const f = fixture(), write = f.options.storage.records.write; let interrupted = false, overlayWrites = 0;
  f.options.storage.records.write = async (key: string, value: any, expected: string) => {
    if (value.preference) overlayWrites++;
    if (value.state === 'applied' && !interrupted) { interrupted = true; throw Error('simulated receipt failure'); }
    return write(key, value, expected);
  };
  const c = await applyPreference(f, 'verbosity', 'brief', 'recovery');
  expect(c).toMatchObject({ status: 'applying', partial: true });
  const restarted = new EvolutionService(f.options);
  const recovered = await restarted.execute('cycle', { op: 'reconcile', cycleId: c.cycleId, requestId: 'recover', expectedRevision: c.revision }, f.principal);
  expect(recovered.status).toBe('applied'); expect(overlayWrites).toBe(1);
  expect((await restarted.execute('context', { project: 'wiki' }, f.principal)).preferences[0].value).toBe('brief');
});

test('shared owner identity does not turn an account-only preference into an owner-wide preference', async () => {
  const f = fixture(); f.raw.scope = { kind: 'account', id: 'alice' };
  f.options.authority = async () => ({ ownerId: 'same-human', revision: 'policy1', sharedOwner: true, assertCurrent: async () => {} });
  await applyPreference(f, 'verbosity', 'brief', 'account');
  const bob = { ...f.principal, accountId: 'bob' };
  expect((await f.service.execute('context', {}, bob)).preferences).toHaveLength(0);
  expect((await f.service.execute('cycle', { op: 'list' }, bob)).items).toHaveLength(0);
  await expect(f.service.execute('feedback', { op: 'read', feedbackId: 'faccount' }, bob)).rejects.toThrow();
  await expect(f.service.execute('cycle', { op: 'read', cycleId: 'caccount' }, bob)).rejects.toThrow();
});

test('hostless service diagnoses without creating authority; anonymous and read-only writes fail', async () => {
  expect(await new EvolutionService({}).execute('cycle', { op: 'diagnose' })).toMatchObject({ status: 'diagnostic_only' });
  const f = fixture();
  await expect(f.service.execute('feedback', { op: 'record', feedback: f.raw, requestId: 'r', expectedRevision: 'missing' })).rejects.toThrow();
  await expect(new EvolutionService({ ...f.options, readOnly: true }).execute('feedback', { op: 'record', feedback: f.raw, requestId: 'r', expectedRevision: 'missing' }, f.principal)).rejects.toThrow();
});
test('explicit HumanGrad persona evolves, persists across service restart, requires real next-use proof', async () => {
  const f = fixture();
  await f.call('feedback', { op: 'record', feedback: f.raw, eventToken: 'host-event', requestId: 'r', expectedRevision: 'missing' });
  let c = await f.call('cycle', { op: 'prepare', cycleId: 'c1', feedbackIds: ['feedback1'], requestId: 'p', expectedRevision: 'missing' });
  c = await f.call('cycle', { op: 'advance', cycleId: 'c1', candidate: { key: 'verbosity', value: 'brief' }, requestId: 'a', expectedRevision: c.revision });
  c = await f.call('cycle', { op: 'check', cycleId: 'c1', requestId: 'e', expectedRevision: c.revision });
  expect(c.status).toBe('evaluated');
  const preview = await f.call('cycle', { op: 'preview', cycleId: 'c1' });
  c = await f.call('cycle', { op: 'apply', cycleId: 'c1', fingerprint: preview.fingerprint, requestId: 'apply', expectedRevision: c.revision });
  expect(c.status).toBe('applied');
  const restart = new EvolutionService(f.options);
  expect((await restart.execute('context', { project: 'wiki', sessionId: 'next', taskId: 'later' }, f.principal)).preferences[0].value).toBe('brief');
  expect((await f.call('cycle', { op: 'effect', cycleId: 'c1', useToken: 'fake', requestId: 'bad', expectedRevision: c.revision })).status).toBe('applied');
  c = await f.call('cycle', { op: 'effect', cycleId: 'c1', useToken: 'used-later', requestId: 'proof', expectedRevision: c.revision });
  expect(c.status).toBe('effect_verified');
  const repeated = await f.call('cycle', { op: 'effect', cycleId: 'c1', useToken: 'used-later', requestId: 'proof-duplicate-event', expectedRevision: c.revision });
  expect(repeated.revision).toBe(c.revision);
});
test('agent report cannot self-promote; withdrawn feedback cannot be revived by replay', async () => {
  const f = fixture(); const args = { op: 'record', feedback: f.raw, requestId: 'r', expectedRevision: 'missing' };
  const saved = await f.call('feedback', args);
  const c = await f.call('cycle', { op: 'prepare', cycleId: 'c', feedbackIds: ['feedback1'], requestId: 'c', expectedRevision: 'missing' });
  expect(c.status).toBe('review_required');
  await f.call('feedback', { op: 'withdraw', feedbackId: 'feedback1', requestId: 'withdraw', expectedRevision: saved.revision });
  expect((await f.call('feedback', args)).feedback.withdrawn).toBe(true);
});
test('scope isolation and live revocation also protect context and stored feedback', async () => {
  const f = fixture(); await f.call('feedback', { op: 'record', feedback: f.raw, eventToken: 'host-event', requestId: 'r', expectedRevision: 'missing' });
  await expect(f.service.execute('feedback', { op: 'read', feedbackId: 'feedback1' }, { ...f.principal, accountId: 'other' })).rejects.toThrow();
  f.revoke(); await expect(f.call('context', { project: 'wiki' })).rejects.toThrow();
});
