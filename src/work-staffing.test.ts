import { describe, expect, it } from 'vitest';
import { recommendStaffing, type WorkExecutionProfile, type WorkStaffingInput } from './work-staffing.js';

const profile = (accountId: string, family = 'gpt', extra: Partial<WorkExecutionProfile> = {}): WorkExecutionProfile => ({
  accountId, family, version: 'host-exact-version', tier: 'standard', tools: ['shell'], capabilities: ['code'], hostVerified: true, cost: 1, ...extra,
});
const input = (extra: Partial<WorkStaffingInput> = {}): WorkStaffingInput => ({
  candidates: [profile('owner'), profile('reviewer', 'claude')], eligibleAccountIds: ['owner', 'reviewer'],
  taskType: 'code', workKind: 'general', authorAccountIds: ['owner'], currentAssignments: [],
  workload: { owner: 0, reviewer: 0 }, personalWipLimit: 2, ...extra,
});

const localProfile = (accountId: string, extra: Partial<WorkExecutionProfile> = {}) =>
  profile(accountId, 'local-model', { executionLocality: 'local', bookkeepingSuitable: true, ...extra });

describe('bookkeeping staffing', () => {
  it('signals deterministic bookkeeping without any LLM, cost or automatic action', () => {
    const value = input({ taskType: 'bookkeeping', deterministicAvailable: true, candidates: [], eligibleAccountIds: [], budget: 0 });
    const before = structuredClone(value);
    const result = recommendStaffing(value);
    expect(result).toMatchObject({ advisory: true, execution: { mode: 'deterministic', llmRequired: false },
      rows: [], unfilled: [], summary: { required: 0, recommended: 0, estimatedCost: 0, unknownCost: false } });
    expect(value).toEqual(before);
    expect(result).toEqual(recommendStaffing(value));
    expect(JSON.stringify(result)).not.toMatch(/spawn|command|autoAssign/);
  });

  it('preserves existing ownership on the deterministic path without charging it', () => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping', deterministicAvailable: true,
      currentAssignments: [{ accountId: 'owner', perspective: 'bookkeeping' }], candidates: [], eligibleAccountIds: [] }));
    expect(result.rows).toEqual([expect.objectContaining({ accountId: 'owner', source: 'existing' })]);
    expect(result.summary).toMatchObject({ required: 0, covered: 0, recommended: 0, estimatedCost: 0 });
  });

  it.each(['security', 'permissions', 'shared_policy', 'destructive'] as const)(
    'keeps independent review mandatory for deterministic %s', workKind => {
      const result = recommendStaffing(input({ taskType: 'bookkeeping', deterministicAvailable: true, workKind,
        candidates: [localProfile('owner'), profile('reviewer')] }));
      expect(result.execution).toEqual({ mode: 'deterministic', llmRequired: true });
      expect(result.rows).toEqual([]);
      expect(result.unfilled).toEqual([{ perspective: 'independent_review', reason: 'independent_review_required' }]);
      expect(result.explanations.join(' ')).toMatch(/local.*remote/i);
      const reviewed = recommendStaffing(input({ taskType: 'bookkeeping', deterministicAvailable: true, workKind,
        candidates: [localProfile('owner'), localProfile('reviewer')] }));
      expect(reviewed.rows).toEqual([expect.objectContaining({ accountId: 'reviewer', verification: 'independent_review' })]);
      expect(reviewed.unfilled).toEqual([]);
    });

  it.each([undefined, false])('requires verified local LLM when deterministic availability is %s', deterministicAvailable => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping', deterministicAvailable,
      candidates: [profile('owner', 'remote-model', { cost: 0 }), localProfile('local')], eligibleAccountIds: ['owner', 'local'] }));
    expect(result.execution).toEqual({ mode: 'local_llm', llmRequired: true });
    expect(result.rows.map(r => r.perspective)).toEqual(['bookkeeping']);
    expect(result.rows.every(r => r.accountId === 'local')).toBe(true);
    expect(result.summary).toMatchObject({ required: 1, recommended: 1, estimatedCost: 1 });
    expect(result.unfilled).toEqual([]);
  });

  it.each([
    { executionLocality: undefined }, { executionLocality: 'unknown' as const }, { executionLocality: 'remote' as const },
    { hostVerified: false }, { bookkeepingSuitable: undefined }, { bookkeepingSuitable: false }, { version: 'unknown' },
  ])('never infers local bookkeeping availability from labels: %j', metadata => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping',
      candidates: [localProfile('owner', { provider: 'localhost', family: 'local', ...metadata })], eligibleAccountIds: ['owner'] }));
    expect(result.rows).toEqual([]);
    expect(result.unfilled).toEqual([
      { perspective: 'bookkeeping', reason: 'no_verified_local_candidate' },
    ]);
  });

  it('reports missing local profiles explicitly without exposing ineligible candidates', () => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping', candidates: [localProfile('hidden')], eligibleAccountIds: ['missing'] }));
    expect(result.rows).toEqual([]);
    expect(result.unfilled.every(r => r.reason === 'no_verified_local_candidate')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('selects the cheapest qualified local before owner reuse, family preference and history', () => {
    const value = input({ taskType: 'bookkeeping', workKind: 'security',
      candidates: [localProfile('owner', { cost: 9, family: 'preferred' }), localProfile('cheap', { cost: 1 }),
        localProfile('reviewer', { cost: 2 }), profile('remote', 'gpt', { cost: 0 })],
      eligibleAccountIds: ['owner', 'cheap', 'reviewer', 'remote'], preferences: { bookkeeping: ['preferred'] },
      currentAssignments: [{ accountId: 'owner', perspective: 'bookkeeping', active: false, verified: true }],
    });
    const result = recommendStaffing(value);
    expect(result.rows.map(r => r.accountId)).toEqual(['cheap', 'reviewer']);
    expect(result.summary.estimatedCost).toBe(3);
    expect(result).toEqual(recommendStaffing({ ...value, candidates: [...value.candidates].reverse() }));
  });

  it.each([
    { requiredTools: ['browser'] }, { requiredCapabilities: ['bookkeeping'] }, { minimumTier: 'frontier' as const },
    { budget: 0 }, { workload: { owner: 2 } },
  ])('does not select a cheap local that fails qualifications: %j', constraints => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping', candidates: [localProfile('owner')], eligibleAccountIds: ['owner'], ...constraints }));
    expect(result.rows).toEqual([]);
    expect(result.unfilled.every(r => r.reason === 'no_qualified_candidate')).toBe(true);
  });

  it('preserves affordable independent local review and cumulative budget limits', () => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping', workKind: 'security', authorAccountIds: [],
      requiredPerspectives: ['ledger', 'status'], budget: 3,
      candidates: [localProfile('a-reviewer', { availableBudget: 1 }), localProfile('z-worker', { availableBudget: 2 })],
      eligibleAccountIds: ['a-reviewer', 'z-worker'] }));
    expect(result.rows.map(r => r.accountId)).toEqual(['z-worker', 'z-worker', 'a-reviewer']);
    expect(result.unfilled).toEqual([]);
    expect(result.summary.estimatedCost).toBe(3);
  });

  it('prefers known local cost and does not treat missing cost as free under a budget', () => {
    const value = input({ taskType: 'bookkeeping', authorAccountIds: [], candidates: [localProfile('owner', { cost: undefined }), localProfile('known', { cost: 5 })],
      eligibleAccountIds: ['owner', 'known'] });
    expect(recommendStaffing(value).rows[0]?.accountId).toBe('known');
    expect(recommendStaffing({ ...value, candidates: [localProfile('owner', { cost: undefined })], budget: 10 }).rows).toEqual([]);
  });

  it.each(['bookkeeping', 'independent_review'])('retains disqualified %s history without counting current coverage', perspective => {
    const cases: Partial<WorkStaffingInput>[] = [
      { candidates: [localProfile('old', { executionLocality: 'remote' })] },
      { candidates: [localProfile('old', { executionLocality: 'unknown' })] },
      { candidates: [localProfile('old', { hostVerified: false })] },
      { candidates: [localProfile('old', { bookkeepingSuitable: false })] },
      { candidates: [] },
      { eligibleAccountIds: [] },
      { requiredTools: ['browser'] },
      { requiredCapabilities: ['ledger'] },
      { minimumTier: 'frontier' },
      { budget: 0 },
      { candidates: [localProfile('old', { availableBudget: 0 })] },
    ];
    for (const invalid of cases) {
      const value = input({ taskType: 'bookkeeping', workKind: 'security', requiredPerspectives: [perspective],
        currentAssignments: [{ accountId: 'old', perspective, active: true, verified: true }],
        candidates: [localProfile('old')], eligibleAccountIds: ['old'], ...invalid });
      const result = recommendStaffing(value);
      expect(result.rows.filter(r => r.source === 'existing')).toEqual([expect.objectContaining({ accountId: 'old', perspective })]);
      expect(result.summary.covered, JSON.stringify(invalid)).toBe(0);
      expect(result.unfilled.map(r => r.perspective), JSON.stringify(invalid)).toContain(perspective);
    }
  });

  it('fills bookkeeping after a remote historical owner with a qualified local recommendation', () => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping',
      candidates: [localProfile('old', { executionLocality: 'remote' }), localProfile('local')], eligibleAccountIds: ['old', 'local'],
      currentAssignments: [{ accountId: 'old', perspective: 'bookkeeping', verified: true }] }));
    expect(result.rows.map(r => [r.accountId, r.source])).toEqual([['old', 'existing'], ['local', 'recommendation']]);
    expect(result.summary).toMatchObject({ required: 1, covered: 0, recommended: 1, unfilled: 0, estimatedCost: 1 });
  });

  it('still counts qualified local existing coverage without another charge at the current task WIP limit', () => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping', workKind: 'security',
      candidates: [localProfile('owner'), localProfile('reviewer')], workload: { owner: 2, reviewer: 2 },
      currentAssignments: [{ accountId: 'owner', perspective: 'bookkeeping' }, { accountId: 'reviewer', perspective: 'independent_review' }] }));
    expect(result.summary).toMatchObject({ required: 2, covered: 2, recommended: 0, unfilled: 0, estimatedCost: 0 });
  });

  it('does not reserve the cheapest local for unrequested review in general bookkeeping', () => {
    const value = input({ taskType: 'bookkeeping', authorAccountIds: ['expensive'], budget: 9,
      candidates: [localProfile('expensive', { cost: 8 }), localProfile('cheap', { cost: 1 })], eligibleAccountIds: ['expensive', 'cheap'] });
    const result = recommendStaffing(value);
    expect(result.rows).toEqual([expect.objectContaining({ accountId: 'cheap', perspective: 'bookkeeping' })]);
    expect(result.summary).toMatchObject({ required: 1, recommended: 1, estimatedCost: 1 });
    expect(result.explanations.join(' ')).not.toMatch(/review is preserved|budget is reserved/i);
    expect(result).toEqual(recommendStaffing({ ...value, candidates: [...value.candidates].reverse() }));
  });

  it.each([false, true])('preserves an existing independent reviewer in the general fast path (alternative=%s)', alternative => {
    const value = input({ taskType: 'bookkeeping', authorAccountIds: [],
      candidates: [localProfile('r', { cost: 0 }), ...(alternative ? [localProfile('worker')] : [])],
      eligibleAccountIds: ['r', 'worker'], currentAssignments: [{ accountId: 'r', perspective: 'independent_review' }] });
    const result = recommendStaffing(value);
    expect(result.rows[0]).toMatchObject({ accountId: 'r', source: 'existing', verification: 'independent_review' });
    expect(result.rows.filter(r => r.source === 'recommendation')).toEqual(alternative
      ? [expect.objectContaining({ accountId: 'worker', perspective: 'bookkeeping' })] : []);
    expect(result.unfilled).toEqual(alternative ? [] : [{ perspective: 'bookkeeping', reason: 'no_qualified_candidate' }]);
    expect(result.summary).toMatchObject({ required: 1, recommended: Number(alternative), estimatedCost: Number(alternative) });
    expect(recommendStaffing({ ...value, currentAssignments: [{ accountId: 'r', perspective: 'independent_review', active: false }] }).rows)
      .toEqual([expect.objectContaining({ accountId: 'r', perspective: 'bookkeeping', source: 'recommendation' })]);
  });

  it.each([0, 1])('uses explicit family preference after cost and before workload/account in the fast path (preferred load=%s)', load => {
    const value = input({ taskType: 'bookkeeping', authorAccountIds: [],
      candidates: [localProfile('a', { family: 'other' }), localProfile('z', { family: 'preferred' })],
      eligibleAccountIds: ['a', 'z'], workload: { a: 0, z: load }, preferences: { bookkeeping: ['preferred'] } });
    const result = recommendStaffing(value);
    expect(result.rows).toEqual([expect.objectContaining({ accountId: 'z', perspective: 'bookkeeping' })]);
    expect(result.summary).toMatchObject({ required: 1, recommended: 1, estimatedCost: 1 });
    expect(result).toEqual(recommendStaffing({ ...value, candidates: [...value.candidates].reverse() }));
    expect(recommendStaffing({ ...value, candidates: [value.candidates[0]!, localProfile('z', { family: 'preferred', cost: 2 })] }).rows[0]?.accountId).toBe('a');
    expect(recommendStaffing({ ...value, preferences: {} }).rows[0]?.accountId).toBe('a');
  });

  it('skips remaining-role budget reservation in the general bookkeeping fast path', () => {
    const result = recommendStaffing(input({ taskType: 'bookkeeping', authorAccountIds: [],
      requiredPerspectives: ['ledger', 'status'], budget: 1,
      candidates: [localProfile('unknown', { cost: undefined }), localProfile('known', { cost: 1 })], eligibleAccountIds: ['unknown', 'known'] }));
    expect(result.rows).toEqual([expect.objectContaining({ accountId: 'known', perspective: 'ledger' })]);
    expect(result.unfilled).toEqual([{ perspective: 'status', reason: 'no_qualified_candidate' }]);
  });

  it.each([false, true])('honors explicit independent review in general bookkeeping (deterministic=%s)', deterministicAvailable => {
    const value = input({ taskType: 'bookkeeping', deterministicAvailable,
      requiredPerspectives: ['bookkeeping', 'independent_review'],
      candidates: [localProfile('owner'), localProfile('reviewer')] });
    const result = recommendStaffing(value);
    expect(result.execution?.llmRequired).toBe(true);
    expect(result.rows.find(r => r.perspective === 'independent_review')).toMatchObject({ accountId: 'reviewer', verification: 'independent_review' });
    expect(result.summary.required).toBe(deterministicAvailable ? 1 : 2);
    const missing = recommendStaffing({ ...value, candidates: [localProfile('owner')] });
    expect(missing.rows.some(r => r.verification === 'self_verified')).toBe(false);
    expect(missing.unfilled).toContainEqual({ perspective: 'independent_review', reason: 'independent_review_required' });
  });

  it.each([
    { taskType: 'code', deterministicAvailable: true },
    { taskType: 'bookkeeping', deterministicAvailable: 'yes' },
    { candidates: [localProfile('owner', { executionLocality: 'localhost' as WorkExecutionProfile['executionLocality'] })] },
    { candidates: [localProfile('owner', { bookkeepingSuitable: 'yes' as unknown as boolean })] },
  ])('rejects malformed bookkeeping metadata: %j', invalid => {
    expect(() => recommendStaffing(input(invalid as Partial<WorkStaffingInput>))).toThrow();
  });
});

describe('recommendStaffing', () => {
  it.each(['project', 'account'] as const)('accepts fractional %s budget boundaries without losing an essential hat', boundary => {
    const result = recommendStaffing(input({ candidates: [profile('owner', 'gpt', { cost: 0.1, ...(boundary === 'account' && { availableBudget: 0.3 }) })],
      eligibleAccountIds: ['owner'], ...(boundary === 'project' && { budget: 0.3 }) }));
    expect(result.rows.filter(r => r.perspective !== 'independent_review').map(r => r.perspective)).toEqual(['implementation', 'change-impact', 'test']);
    expect(result.summary.estimatedCost).toBeCloseTo(0.3);
  });

  it.each(['security', 'general'] as const)('preserves affordable independent review after essential coverage for %s', workKind => {
    const result = recommendStaffing(input({ authorAccountIds: [], workKind, requiredPerspectives: ['implementation'], budget: 2,
      candidates: [profile('preferred', 'gpt', { cost: 2 }), profile('cheap', 'claude'), profile('third', 'gemini')],
      eligibleAccountIds: ['preferred', 'cheap', 'third'],
    }));
    expect(result.rows.map(r => r.perspective)).toEqual(['implementation', 'independent_review']);
    expect(result.rows[0]?.accountId).toBe('cheap');
    expect(result.rows[1]).toMatchObject({ accountId: 'third', verification: 'independent_review' });
    expect(result.summary.estimatedCost).toBe(2);
    expect(result.unfilled).toEqual([]);
  });

  it('reserves a reviewer across remaining essential hats without consuming its account capacity', () => {
    const result = recommendStaffing(input({ authorAccountIds: [], workKind: 'security', budget: 4,
      candidates: [profile('preferred', 'gpt', { cost: 2 }), profile('cheap', 'claude', { availableBudget: 3 }), profile('third', 'gemini', { availableBudget: 1 })],
      eligibleAccountIds: ['preferred', 'cheap', 'third'],
    }));
    expect(result.rows.slice(0, 3).every(r => r.accountId === 'cheap')).toBe(true);
    expect(result.rows[3]).toMatchObject({ accountId: 'third', verification: 'independent_review' });
    expect(result.unfilled).toEqual([]);
    expect(result.summary.estimatedCost).toBe(4);
  });

  it.each([
    { workload: { third: 2 } },
    { eligibleAccountIds: ['preferred', 'cheap'] },
    { requiredTools: ['shell'] },
    { requiredCapabilities: ['code'] },
    { minimumTier: 'standard' as const },
    { budget: 2 },
  ])('does not count a disqualified reviewer as feasible: %j', gate => {
    // Only third could review a cost-1 implementation within budget 2. If
    // disqualified, lower preferences must not win imaginary review capacity.
    const third = profile('third', 'gemini', {
      ...(gate.requiredTools && { tools: [] }),
      ...(gate.requiredCapabilities && { capabilities: [] }),
      ...(gate.minimumTier && { tier: 'economical' }),
      ...(Object.hasOwn(gate, 'budget') && { availableBudget: 0 }),
    });
    const result = recommendStaffing(input({ authorAccountIds: [], workKind: 'security', requiredPerspectives: ['implementation'], budget: 2,
      candidates: [profile('preferred', 'gpt', { cost: 2 }), profile('cheap', 'claude'), third],
      eligibleAccountIds: ['preferred', 'cheap', 'third'], preferences: { implementation: ['gpt'] }, ...gate,
    }));
    expect(result.rows[0]?.accountId).toBe('preferred');
    expect(result.rows.some(r => r.verification === 'independent_review')).toBe(false);
  });

  it.each([
    { authorAccountIds: ['preferred', 'cheap', 'third'] },
    { assigneeAccountIds: ['preferred', 'cheap', 'third'] },
    { requesterAccountIds: ['cheap', 'third'] },
  ])('excludes related accounts from reviewer lookahead without relying on budget disqualification: %j', exclusions => {
    const result = recommendStaffing(input({ authorAccountIds: [], workKind: 'security', requiredPerspectives: ['implementation'], budget: 2,
      candidates: [profile('preferred', 'gpt', { cost: 2 }), profile('cheap', 'claude'), profile('third', 'gemini')],
      eligibleAccountIds: ['preferred', 'cheap', 'third'], preferences: { implementation: ['gpt'] }, ...exclusions,
    }));
    expect(result.rows[0]?.accountId).toBe('preferred');
    expect(result.rows.some(r => r.verification === 'independent_review')).toBe(false);
  });

  it('does not mistake the selected account or explicit authors for available independent reviewers', () => {
    const result = recommendStaffing(input({ authorAccountIds: ['cheap', 'third'], workKind: 'security', requiredPerspectives: ['implementation'], budget: 2,
      candidates: [profile('preferred', 'gpt', { cost: 2 }), profile('cheap', 'claude'), profile('third', 'gemini')],
      eligibleAccountIds: ['preferred', 'cheap', 'third'],
    }));
    expect(result.rows.some(r => r.verification === 'independent_review')).toBe(false);
    expect(result.unfilled).toContainEqual({ perspective: 'independent_review', reason: 'independent_review_required' });
  });

  it('allows an inactive unrelated worker to review high-risk work independently', () => {
    const value = input({ requiredPerspectives: [], workKind: 'security',
      currentAssignments: [{ accountId: 'reviewer', perspective: 'language', active: false, verified: false }],
    });
    expect(recommendStaffing(value).rows[0]).toMatchObject({ accountId: 'reviewer', verification: 'independent_review' });
    for (const exclusions of [{ authorAccountIds: ['reviewer', 'owner'] }, { requesterAccountIds: ['reviewer'] }, { assigneeAccountIds: ['reviewer'] }]) {
      expect(recommendStaffing({ ...value, ...exclusions }).unfilled).toContainEqual({ perspective: 'independent_review', reason: 'independent_review_required' });
    }
  });

  it('does not reuse inactive unverified history ahead of role preference', () => {
    const result = recommendStaffing(input({ requiredPerspectives: ['implementation'], authorAccountIds: [],
      preferences: { implementation: ['gpt'] },
      candidates: [profile('old', 'claude'), profile('preferred')], eligibleAccountIds: ['old', 'preferred'],
      currentAssignments: [{ accountId: 'old', perspective: 'language', active: false, verified: false }],
    }));
    expect(result.rows[0]?.accountId).toBe('preferred');
  });

  it('ranks verified inactive role history without granting ownership or unrelated-role preference', () => {
    const value = input({ requiredPerspectives: ['implementation'], authorAccountIds: [],
      candidates: [profile('cheap', 'gpt', { cost: 0 }), profile('proven', 'gpt', { cost: 5 })], eligibleAccountIds: ['cheap', 'proven'],
      currentAssignments: [{ accountId: 'proven', perspective: 'implementation', active: false, verified: true }],
    });
    expect(recommendStaffing(value).rows[0]?.accountId).toBe('proven');
    expect(recommendStaffing({ ...value, requiredPerspectives: ['language'] }).rows[0]?.accountId).toBe('cheap');
    expect(recommendStaffing({ ...value, currentAssignments: [{ accountId: 'proven', perspective: 'implementation', active: false, verified: false }] }).rows[0]?.accountId).toBe('cheap');
  });

  it('preserves affordable essential coverage ahead of preferences and independent review', () => {
    const result = recommendStaffing(input({ budget: 3, authorAccountIds: [], workKind: 'security',
      candidates: [profile('preferred', 'gpt', { cost: 2 }), profile('cheap', 'claude'), profile('third', 'gemini')],
      eligibleAccountIds: ['preferred', 'cheap', 'third'],
    }));
    expect(result.rows.map(r => r.perspective)).toEqual(['implementation', 'change-impact', 'test']);
    expect(result.rows.every(r => r.accountId === 'cheap')).toBe(true);
    expect(result.summary.estimatedCost).toBe(3);
    expect(result.unfilled).toEqual([{ perspective: 'independent_review', reason: 'independent_review_required' }]);
  });

  it('reserves affordable remaining hats across per-account budgets and skips existing coverage', () => {
    const result = recommendStaffing(input({ budget: 3, authorAccountIds: [], workKind: 'security',
      requiredPerspectives: ['implementation', 'language', 'change-impact', 'test'],
      currentAssignments: [{ accountId: 'offline', perspective: 'language', active: true }],
      candidates: [profile('preferred', 'gpt', { cost: 2 }), profile('cheap', 'claude', { availableBudget: 1 }), profile('third', 'gemini', { availableBudget: 2 })],
      eligibleAccountIds: ['preferred', 'cheap', 'third'],
    }));
    expect(result.rows.filter(r => r.source === 'recommendation')).toHaveLength(3);
    expect(result.summary.estimatedCost).toBe(3);
    expect(result.unfilled.map(r => r.perspective)).toEqual(['independent_review']);
  });

  it('uses visible ineligible author metadata for diversity without selecting that author', () => {
    const result = recommendStaffing(input({ requiredPerspectives: [],
      candidates: [profile('owner'), profile('same'), profile('different', 'claude')], eligibleAccountIds: ['same', 'different'],
    }));
    expect(result.rows[0]?.accountId).toBe('different');
    expect(result.rows.some(r => r.accountId === 'owner')).toBe(false);
  });

  it('uses a different known tier as secondary diversity, without preferring bigger models', () => {
    const value = input({ requiredPerspectives: [], candidates: [profile('owner'), profile('a-same'), profile('z-other', 'gpt', { tier: 'economical' })],
      eligibleAccountIds: ['a-same', 'z-other'],
    });
    expect(recommendStaffing(value).rows[0]?.accountId).toBe('z-other');
    expect(recommendStaffing({ ...value, minimumTier: 'standard' }).rows[0]?.accountId).toBe('a-same');
  });

  it('keeps family diversity ahead of tier diversity and gives unknown tier no diversity credit', () => {
    const value = input({ requiredPerspectives: [], candidates: [profile('owner'), profile('a-tier', 'gpt', { tier: 'economical' }), profile('z-family', 'claude')],
      eligibleAccountIds: ['a-tier', 'z-family'],
    });
    expect(recommendStaffing(value).rows[0]?.accountId).toBe('z-family');
    expect(recommendStaffing(input({ requiredPerspectives: [], candidates: [profile('owner'), profile('a-known'), profile('z-unknown', 'gpt', { tier: 'unknown' })],
      eligibleAccountIds: ['a-known', 'z-unknown'],
    })).rows[0]?.accountId).toBe('a-known');
  });

  it('covers code essentials and recommends a different-account, cross-family reviewer', () => {
    const result = recommendStaffing(input());
    expect(result.rows.map(r => r.perspective)).toEqual(['implementation', 'change-impact', 'test', 'independent_review']);
    expect(result.rows.find(r => r.perspective === 'independent_review')).toMatchObject({ accountId: 'reviewer', verification: 'independent_review' });
    expect(result.unfilled).toEqual([]);
  });

  it.each([
    ['research', false, ['source', 'counterpoint']],
    ['writing', false, ['language', 'continuity']],
    ['writing', true, ['language', 'continuity', 'factual-verification']],
    ['planning', false, ['constraints', 'feasibility', 'risk']],
  ] as const)('uses %s essentials (factual=%s), without compulsory marketing', (taskType, factualVerification, perspectives) => {
    const result = recommendStaffing(input({ taskType, factualVerification, candidates: [], eligibleAccountIds: [] }));
    expect(result.unfilled.map(r => r.perspective)).toEqual([...perspectives, 'independent_review']);
  });

  it('uses owner-adjusted perspectives without weakening high-risk independent review', () => {
    const result = recommendStaffing(input({ requiredPerspectives: ['design'], workKind: 'security', candidates: [profile('owner')] }));
    expect(result.rows.map(r => r.perspective)).toEqual(['design']);
    expect(result.unfilled).toContainEqual({ perspective: 'independent_review', reason: 'independent_review_required' });
    expect(result.rows.some(r => r.verification === 'self_verified')).toBe(false);
  });

  it('allows economical cross-family review before a frontier same-family candidate', () => {
    const result = recommendStaffing(input({
      requiredPerspectives: [], candidates: [profile('owner'), profile('same', 'gpt', { tier: 'frontier' }), profile('diverse', 'claude', { tier: 'economical' })],
      eligibleAccountIds: ['owner', 'same', 'diverse'],
    }));
    expect(result.rows[0]?.accountId).toBe('diverse');
  });

  it('accepts single-family independent accounts with an explicit diversity compromise', () => {
    const result = recommendStaffing(input({ candidates: [profile('owner'), profile('reviewer')], requiredPerspectives: [] }));
    expect(result.rows[0]).toMatchObject({ accountId: 'reviewer', verification: 'independent_review' });
    expect(result.explanations.join(' ')).toMatch(/family diversity/i);
  });

  it('does not treat provider, version, or reasoning labels as a second identity', () => {
    const result = recommendStaffing(input({ candidates: [profile('owner', 'claude', { provider: 'other', version: 'gpt-frontier', reasoning: 'maximum' })] }));
    expect(result.rows.filter(r => r.verification === 'independent_review')).toEqual([]);
    expect(result.rows.find(r => r.verification === 'self_verified')?.accountId).toBe('owner');
    expect(result.explanations.join(' ')).toMatch(/not.*approval|does not.*approval/i);
  });

  it.each(['security', 'permissions', 'shared_policy', 'destructive'] as const)('never self-verifies %s', workKind => {
    const result = recommendStaffing(input({ candidates: [profile('owner')], workKind }));
    expect(result.unfilled.some(r => r.reason === 'independent_review_required')).toBe(true);
    expect(result.rows.some(r => r.verification === 'self_verified')).toBe(false);
  });

  it('excludes every author, requester and assignee from independent review', () => {
    const ids = ['author1', 'author2', 'requester', 'assignee', 'active', 'independent'];
    const result = recommendStaffing(input({ requiredPerspectives: [], candidates: ids.map(id => profile(id)), eligibleAccountIds: ids,
      authorAccountIds: ['author1', 'author2'], requesterAccountIds: ['requester'], assigneeAccountIds: ['assignee'],
      currentAssignments: [{ accountId: 'active', perspective: 'implementation', active: true }],
    }));
    expect(result.rows.find(r => r.perspective === 'independent_review')?.accountId).toBe('independent');
  });

  it('keeps unverified identity unknown, without guessing from version labels', () => {
    const result = recommendStaffing(input({ candidates: [profile('owner', 'unknown', { hostVerified: false, version: 'gpt-frontier' })] }));
    expect(result.rows).toEqual([]);
    expect(result.unfilled.every(r => r.reason === 'waiting_host_verification')).toBe(true);
  });

  it('waits when an eligible host profile is missing', () => {
    const result = recommendStaffing(input({ candidates: [], eligibleAccountIds: ['owner'] }));
    expect(result.unfilled[0]?.reason).toBe('waiting_host_verification');
  });

  it('preserves active ownership even when the owner is unavailable or no longer eligible', () => {
    const result = recommendStaffing(input({ currentAssignments: [{ accountId: 'offline', perspective: 'implementation', active: true }],
      candidates: [], eligibleAccountIds: [],
    }));
    expect(result.rows[0]).toMatchObject({ accountId: 'offline', perspective: 'implementation', source: 'existing', family: null, tier: 'unknown', verification: 'declared' });
    expect(result.unfilled.some(r => r.perspective === 'implementation')).toBe(false);
  });

  it('prefers existing coverage and distinguishes declared from verified', () => {
    const result = recommendStaffing(input({ currentAssignments: [
      { accountId: 'owner', perspective: 'implementation', verified: true },
      { accountId: 'owner', perspective: 'test' },
    ] }));
    expect(result.rows.find(r => r.perspective === 'implementation')).toMatchObject({ source: 'existing', verification: 'verified' });
    expect(result.rows.find(r => r.perspective === 'test')).toMatchObject({ source: 'existing', verification: 'declared' });
    expect(result.summary.covered).toBe(2);
  });

  it('honors eligibility before model preference or cost', () => {
    const result = recommendStaffing(input({ requiredPerspectives: ['implementation'], authorAccountIds: [],
      eligibleAccountIds: ['allowed'], candidates: [profile('forbidden', 'gpt', { cost: 0 }), profile('allowed', 'claude')],
    }));
    expect(result.rows[0]?.accountId).toBe('allowed');
    expect(JSON.stringify(result)).not.toContain('forbidden');
  });

  it.each([
    { requiredTools: ['browser'] }, { requiredCapabilities: ['research'] }, { minimumTier: 'frontier' as const },
    { budget: 0 }, { workload: { owner: 2, reviewer: 2 } },
  ])('filters constraints before preferences: %j', constraints => {
    const result = recommendStaffing(input(constraints));
    expect(result.rows).toEqual([]);
    expect(result.unfilled.length).toBe(4);
  });

  it('enforces cumulative total and per-account cost for sequential hats', () => {
    const result = recommendStaffing(input({ candidates: [profile('owner', 'gpt', { availableBudget: 2 })], budget: 2 }));
    expect(result.rows.filter(r => r.source === 'recommendation')).toHaveLength(2);
    expect(result.summary.estimatedCost).toBe(2);
    expect(result.unfilled.length).toBe(2);
  });

  it('does not assume unknown cost is free under a budget', () => {
    const candidate = profile('owner'); delete candidate.cost;
    expect(recommendStaffing(input({ candidates: [candidate], budget: 10 })).rows).toEqual([]);
    expect(recommendStaffing(input({ candidates: [candidate] })).summary.unknownCost).toBe(true);
  });

  it('reuses an active ordinary owner at the WIP limit for sequential hats', () => {
    const result = recommendStaffing(input({ candidates: [profile('owner')], workload: { owner: 2 },
      currentAssignments: [{ accountId: 'owner', perspective: 'implementation', active: true }],
    }));
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every(r => r.accountId === 'owner')).toBe(true);
    expect(result.rows[3]?.verification).toBe('self_verified');
  });

  it('uses configurable preferences and never applies a blanket Fable penalty', () => {
    const result = recommendStaffing(input({ authorAccountIds: [], requiredPerspectives: ['biology'], preferences: { biology: ['claude', 'gpt'] },
      candidates: [profile('g', 'gpt'), profile('c', 'claude', { version: 'fable', capabilities: ['biology', 'ml'] })], eligibleAccountIds: ['g', 'c'],
    }));
    expect(result.rows[0]?.accountId).toBe('c');
    expect(result.explanations.join(' ')).toMatch(/user preferences.*not.*rank/i);
  });

  it.each(['creative', 'planning', 'implementation'])('has no hardcoded model-family preference for %s', perspective => {
    const families = ['claude', 'gpt', 'gemini'];
    const value = input({ requiredPerspectives: [perspective], authorAccountIds: [], candidates: families.map(f => profile(f, f, { cost: f === 'claude' ? 5 : f === 'gpt' ? 2 : 1 })), eligibleAccountIds: families });
    expect(recommendStaffing(value).rows[0]?.family).toBe('gemini');
    expect(recommendStaffing({ ...value, preferences: { [perspective]: ['claude'] } }).rows[0]?.family).toBe('claude');
  });

  it('uses verified role history before cost and cost before load', () => {
    const result = recommendStaffing(input({ requiredPerspectives: ['implementation'], authorAccountIds: [],
      candidates: [profile('cheap', 'gpt', { cost: 0 }), profile('proven', 'gpt', { cost: 5 })], eligibleAccountIds: ['cheap', 'proven'],
      currentAssignments: [{ accountId: 'proven', perspective: 'implementation', active: false, verified: true }],
    }));
    expect(result.rows[0]?.accountId).toBe('proven');
  });

  it('reserves an existing independent reviewer instead of recommending it as an author', () => {
    const result = recommendStaffing(input({ candidates: [profile('reviewer'), profile('maker', 'claude')],
      eligibleAccountIds: ['reviewer', 'maker'], currentAssignments: [{ accountId: 'reviewer', perspective: 'independent_review', active: true }],
    }));
    expect(result.rows.filter(r => r.perspective !== 'independent_review').every(r => r.accountId === 'maker')).toBe(true);
    expect(result.rows.find(r => r.perspective === 'independent_review')).toMatchObject({ source: 'existing', accountId: 'reviewer' });
  });

  it('leaves essential gaps when only the reserved independent reviewer is available', () => {
    const result = recommendStaffing(input({ candidates: [profile('reviewer')], currentAssignments: [{ accountId: 'reviewer', perspective: 'independent_review' }] }));
    expect(result.rows).toHaveLength(1);
    expect(result.unfilled).toHaveLength(3);
  });

  it('treats case variants of unknown family as unknown', () => {
    const result = recommendStaffing(input({ candidates: [profile('owner', 'Unknown')] }));
    expect(result.rows).toEqual([]);
    expect(result.unfilled[0]?.reason).toBe('waiting_host_verification');
  });

  it('uses only own workload entries for opaque account IDs', () => {
    const result = recommendStaffing(input({ requiredPerspectives: ['implementation'], authorAccountIds: [], workload: { aaa: 1 },
      candidates: [profile('constructor'), profile('aaa')], eligibleAccountIds: ['constructor', 'aaa'], preferences: { implementation: [] },
    }));
    expect(result.rows[0]?.accountId).toBe('constructor');
  });

  it('keeps unknown tier unknown despite a frontier-looking version', () => {
    const result = recommendStaffing(input({ candidates: [profile('owner', 'gpt', { tier: 'unknown', version: 'gpt-frontier' })] }));
    expect(result.rows.every(r => r.tier === 'unknown')).toBe(true);
    expect(recommendStaffing(input({ candidates: [profile('owner', 'gpt', { tier: 'unknown' })], minimumTier: 'economical' })).rows).toEqual([]);
  });

  it('does not reuse an author assignment pretending to be independent review', () => {
    const result = recommendStaffing(input({ requiredPerspectives: [], workKind: 'permissions', candidates: [profile('owner')],
      currentAssignments: [{ accountId: 'owner', perspective: 'independent_review', verified: true }],
    }));
    expect(result.rows.some(r => r.verification === 'independent_review')).toBe(false);
    expect(result.unfilled).toContainEqual({ perspective: 'independent_review', reason: 'independent_review_required' });
  });

  it('prefers a third family over either of two author families', () => {
    const result = recommendStaffing(input({ requiredPerspectives: [], authorAccountIds: ['a', 'b'],
      candidates: [profile('a'), profile('b', 'claude'), profile('c', 'gpt'), profile('d', 'claude'), profile('e', 'gemini', { tier: 'economical' })],
      eligibleAccountIds: ['a', 'b', 'c', 'd', 'e'],
    }));
    expect(result.rows[0]?.accountId).toBe('e');
  });

  it('uses cost and load as late tie breakers with input-order independent output', () => {
    const value = input({ requiredPerspectives: ['implementation'], authorAccountIds: [],
      candidates: [profile('z', 'gpt', { cost: 5 }), profile('y'), profile('x')], eligibleAccountIds: ['x', 'y', 'z'], workload: { x: 1, y: 0, z: 0 },
    });
    expect(recommendStaffing(value).rows[0]?.accountId).toBe('y');
    expect(recommendStaffing(value)).toEqual(recommendStaffing({ ...value, candidates: [...value.candidates].reverse() }));
  });

  it('bounds rows and explanations even at maximum accepted input size', () => {
    const result = recommendStaffing(input({ currentAssignments: Array.from({ length: 100 }, (_, i) => ({ accountId: `a${i}`, perspective: `role${i}` })),
      requiredPerspectives: Array.from({ length: 20 }, (_, i) => `essential${i}`), candidates: [], eligibleAccountIds: [],
    }));
    expect(result.rows).toHaveLength(100);
    expect(result.unfilled).toHaveLength(21);
    expect(result.explanations.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(result).length).toBeLessThan(65000);
  });

  it('is deterministic and pure, returns advisory data only, and does not mutate inputs', () => {
    const value = input(); const before = structuredClone(value);
    const result = recommendStaffing(value);
    expect(result).toEqual(recommendStaffing(value));
    expect(value).toEqual(before);
    expect(result.advisory).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['advisory', 'explanations', 'rows', 'summary', 'unfilled']);
    expect(JSON.stringify(result)).not.toMatch(/spawn|execute|command|autoAssign/);
  });

  it.each([
    { personalWipLimit: 0 }, { budget: Number.NaN }, { workload: { owner: -1 } },
    { candidates: [profile('owner'), profile('owner', 'claude')] },
    { candidates: Array.from({ length: 101 }, (_, i) => profile(`a${i}`)) },
    { requiredPerspectives: Array.from({ length: 21 }, (_, i) => `role${i}`) },
    { requiredTools: ['x'.repeat(129)] },
    { candidates: [profile('owner', 'gpt', { hostVerified: 'yes' as unknown as boolean })] },
    { preferences: { code: ['gpt'.repeat(50)] } },
  ])('rejects malformed or unbounded input: %j', invalid => {
    expect(() => recommendStaffing(input(invalid))).toThrow();
  });
});
