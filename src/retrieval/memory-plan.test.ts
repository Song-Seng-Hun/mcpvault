import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { planMemory } from './memory-plan.js';

const cases = JSON.parse(readFileSync(new URL('../../tests/fixtures/memory-routing-60.json', import.meta.url), 'utf8'));
test('fixed routing set keeps 60 cases, balanced languages and source-family separation', () => {
  expect(cases).toHaveLength(60);
  for (const language of ['ko', 'en', 'mixed']) expect(cases.filter((c: any) => c.language === language)).toHaveLength(20);
  const dev = new Set(cases.filter((c: any) => c.split === 'development').map((c: any) => c.sourceFamily));
  expect(cases.filter((c: any) => c.split === 'verification')).toHaveLength(30);
  expect(cases.filter((c: any) => c.split === 'verification').some((c: any) => dev.has(c.sourceFamily))).toBe(false);
});
for (const c of cases) test(`explicit routing contract: ${c.id}`, () => {
  const plan = planMemory('brief', { intent: c.intent }, c.explicitRead)!;
  expect(plan.strategy).toBe(c.expectedStrategy);
  expect(plan.mandatoryRules).toBe('unchanged');
  expect(new Set(plan.preferredRoles).size).toBe(5);
  expect(planMemory('recall', { intent: c.intent }, c.explicitRead)?.strategy).toBe('selective');
  expect(planMemory('consolidate', { intent: c.intent }, c.explicitRead)?.strategy).toBe('selective');
});
test('legacy callers remain unchanged and client authority claims are rejected', () => {
  expect(planMemory('brief', undefined, false)).toBeUndefined();
  for (const context of [null, [], 'self_contained', {}, { intent: 'unknown' }, { intent: 'procedure', approved: true }])
    expect(() => planMemory('brief', context, false)).toThrow();
});
