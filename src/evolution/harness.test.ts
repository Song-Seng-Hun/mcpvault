import { expect, test } from 'vitest';
import * as harness from './harness.js';
import { RetrievalService } from '../retrieval-service.js';
import { ScopeAccessPolicy } from '../scope-access.js';

const profile = { modelId: 'model-v1', taskKind: 'research', route: 'keyword', optionalSkillBundles: 0, maxChars: 4000,
  expansionLimit: 0, repairLimit: 0, optionalReview: false };

test('harness profiles accept only bounded data, never security or authority changes', () => {
  expect(harness.validateHarness).toBeTypeOf('function');
  expect(harness.validateHarness(profile)).toEqual(profile);
  for (const invalid of [{ ...profile, maxChars: 12001 }, { ...profile, expansionLimit: 3 }, { ...profile, optionalSkillBundles: 2 },
    { ...profile, safety: false }, { ...profile, modelId: '../other' }, { ...profile, permissions: ['write'] }]) {
    expect(() => harness.validateHarness(invalid)).toThrow();
  }
});

test('task context narrows existing retrieval without enabling semantic permission or leaking across tasks', async () => {
  let semantic = 0, lexical = 0;
  const principal: any = { accountId: 'a', modelId: 'model-v1', role: 'model' };
  const service = new RetrievalService({} as any, { searchScopedNotes: async () => { lexical++; return []; } } as any,
    { search: async () => { semantic++; return { available: true, results: [] }; } } as any, new ScopeAccessPolicy(), {} as any);
  await harness.withHarness({ accountId: 'a', taskId: 'task', sessionId: 'session', revision: 'a'.repeat(64), profile: harness.validateHarness(profile) },
    async () => { await service.retrieve({ query: 'hello world', principal, semantic: true }); });
  expect(semantic).toBe(0); expect(lexical).toBe(1);
  await service.retrieve({ query: 'hello world', principal, semantic: true }); expect(semantic).toBe(1);
  await harness.withHarness({ accountId: 'a', taskId: 'task', sessionId: 'session', revision: 'a'.repeat(64), profile: harness.validateHarness({ ...profile, route: 'hybrid' }) },
    async () => { await service.retrieve({ query: 'hello world', principal, semantic: false }); });
  expect(semantic).toBe(1);
  await harness.withHarness({ accountId: 'other', taskId: 'task', sessionId: 'session', revision: 'a'.repeat(64), profile: harness.validateHarness(profile) },
    async () => { await service.retrieve({ query: 'hello world', principal, semantic: true }); });
  expect(semantic).toBe(2);
});

test('a revoked task cannot return a search completed while revocation was in flight', async () => {
  let allowed = true;
  const principal: any = { accountId: 'a', modelId: 'model-v1', role: 'model' };
  const service = new RetrievalService({} as any, { searchScopedNotes: async () => { allowed = false; return []; } } as any,
    { search: async () => { throw Error('not allowed'); } } as any, new ScopeAccessPolicy(), {} as any);
  await expect(harness.withHarness({ accountId: 'a', taskId: 'task', sessionId: 'session', revision: 'a'.repeat(64),
    profile: harness.validateHarness(profile), assertCurrent: async () => { if (!allowed) throw Error('revoked'); } },
    () => service.retrieve({ query: 'hello', principal }))).rejects.toThrow('revoked');
});
