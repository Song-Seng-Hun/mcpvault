import { expect, test } from 'vitest';
import { explanationEligibility } from './explanation-eligibility.js';
import { explanationProfileFingerprint } from './explanation-model.js';
import type { WorkExecutionProfile } from './work-staffing.js';
const profiles: WorkExecutionProfile[] = ['author', 'reviewer', 'peer'].map(accountId => ({ accountId, family: accountId === 'reviewer' ? 'gpt' : 'gemini', version: '1', hostVerified: true, tier: 'standard', capabilities: ['task'], tools: [] }));
const record = (status: string) => ({ status, author: 'author', authorProfileFingerprint: explanationProfileFingerprint(profiles, 'author') });
test('eligibility shares state/basis checks without imposing recommendation family or WIP policy', () => {
  expect(explanationEligibility(undefined, false, 'reviewer', profiles)).toMatchObject({ status: 'queued', claim: true, draft: false, review: false });
  expect(explanationEligibility(record('claimed'), false, 'author', profiles)).toMatchObject({ draft: true, continuing: true });
  expect(explanationEligibility(record('draft'), false, 'author', profiles)).toMatchObject({ draft: false, continuing: true, waiting: true });
  expect(explanationEligibility(record('draft'), false, 'reviewer', profiles)).toMatchObject({ review: true, continuing: false });
  expect(explanationEligibility(record('draft'), false, 'peer', profiles).review).toBe(false);
  expect(explanationEligibility(record('approved'), true, 'author', profiles)).toMatchObject({ status: 'approved', claim: false, draft: false, review: false });
});
test('profile drift requires author reapplication and unverified readers gain no work action', () => {
  const stale = { ...record('draft'), authorProfileFingerprint: 'stale' };
  expect(explanationEligibility(stale, false, 'author', profiles).draft).toBe(true);
  expect(explanationEligibility(stale, false, 'reviewer', profiles).review).toBe(false);
  expect(explanationEligibility(record('approved'), false, 'reviewer', profiles)).toMatchObject({ status: 'review_required', review: true });
  expect(explanationEligibility(undefined, false, undefined, profiles).claim).toBe(false);
});
