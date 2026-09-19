import { test, expect } from 'vitest';
import { skillEvolutionAdapter } from './skill-adapter.js';
import { hash } from './policy.js';
test('promotion alone is not delivery; a stale approved release remains unconfirmed', async () => {
  const content = 'Use a verified outcome, not an assertion.';
  let active = false, release = 'old';
  const native: any = {
    resolve: async () => ({ status: active ? 'active' : 'original', revision: active ? 'new-version' : 'old-version', currentRevision: active ? 'new-pointer' : 'missing', content }),
    candidate: async () => ({ content, revision: 'candidate-version' }),
    promote: async (p: any) => { if (p.op === 'preview') return { fingerprint: 'native-preview', expectedRevision: 'missing' }; active = true; return { revision: 'new-pointer' }; },
  };
  const delivery: any = { read: async () => ({ releaseRevision: release, contentHash: hash(content) }),
    prepare: async () => ({ releaseRevision: 'new', contentHash: hash(content), bindingHash: 'binding' }),
    apply: async () => {} };
  const adapter = skillEvolutionAdapter(native, async () => ({ accessToken: 'host-held-never-persisted' }), delivery);
  const target: any = { kind: 'skill', id: 'review' }, principal: any = { accountId: 'alice' }, current = async () => {};
  const c: any = { id: 'cycle', target, baseline: await adapter.read(target, principal),
    candidate: { candidateId: 'candidate', evaluationId: 'evaluation', candidateRevision: 'candidate-version' } };
  c.intent = await adapter.preview(c, principal, current);
  await expect(adapter.apply(c, principal, current)).rejects.toThrow();
  expect((await adapter.reconcile(c, principal, current)).state).toBe('unknown');
  release = 'new';
  expect(await adapter.reconcile(c, principal, current)).toEqual({ state: 'applied', revision: 'new' });
});
