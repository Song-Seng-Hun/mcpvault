import { expect, test } from 'vitest';
import { normalizeFeedback, repetitionReady, compareEvaluation, selectPreferences } from './policy.js';

const raw = { id: 'f1', taskId: 'task1', sessionId: 's1', target: { kind: 'persona', id: 'assistant' },
  scope: { kind: 'project', id: 'wiki' }, kind: 'preference', signal: 'explicit', key: 'verbosity', value: 'brief',
  summary: 'Keep the result concise (간결하게).', basis: [] };
const proof = { origin: 'human' as const, eventId: 'event1', taskId: 'task1', sessionId: 's1', observedAt: '2026-09-16T00:00:00.000Z' };

test('client human/safe assertions cannot become feedback authority', () => {
  expect(() => normalizeFeedback({ ...raw, human: true }, undefined)).toThrow();
  expect(normalizeFeedback(raw, undefined).origin).toBe('agent_report');
  expect(normalizeFeedback(raw, proof).origin).toBe('human');
  expect(() => normalizeFeedback(raw, { ...proof, taskId: 'another' })).toThrow();
});
test('repeated implicit feedback requires three independent events in two sessions and 30 days', () => {
  const make = (id: string, taskId: string, sessionId: string, observedAt = proof.observedAt) => normalizeFeedback(
    { ...raw, id, taskId, sessionId, signal: 'implicit' }, { ...proof, eventId: id, taskId, sessionId, observedAt });
  const a = make('a', 'a', 's1'), b = make('b', 'b', 's1'), c = make('c', 'c', 's2');
  const now = Date.parse('2026-09-17T00:00:00Z');
  expect(repetitionReady([a, a, c], now)).toBe(false);
  expect(repetitionReady([a, b, c], now)).toBe(true);
  expect(repetitionReady([a, b, { ...c, withdrawn: true }], now)).toBe(false);
  expect(repetitionReady([a, b, make('d', 'd', 's2', '2026-07-01T00:00:00Z')], now)).toBe(false);
});
test('secrets, speculative traits and generic agreement cannot become preferences', () => {
  expect(() => normalizeFeedback({ ...raw, key: 'mental_health' }, proof)).toThrow();
  expect(() => normalizeFeedback({ ...raw, summary: 'password=pretend-secret' }, proof)).toThrow();
  expect(() => normalizeFeedback({ ...raw, kind: 'agreement' }, proof)).toThrow();
});
test('safety is not traded for quality and a skill must beat or justify skill-free use', () => {
  const base = { profileRevision: 'profile1', cases: [
    { id: 'target', split: 'development', baseline: false, candidate: true, withoutSkill: false },
    { id: 'holdout', split: 'holdout', baseline: true, candidate: true, withoutSkill: true },
  ], safety: true, targetCaseIds: ['target'], baselineTokens: 100, candidateTokens: 90 };
  expect(compareEvaluation('skill', base).status).toBe('passed');
  expect(compareEvaluation('skill', { ...base, safety: false }).status).toBe('failed');
  expect(compareEvaluation('skill', { ...base, cases: base.cases.map(c => ({ ...c, withoutSkill: true })), withoutSkillTokens: 50 }).reason).toBe('skill_unnecessary');
  expect(compareEvaluation('wiki', { ...base, cases: [base.cases[0]] }).status).not.toBe('passed');
});
test('unchanged success needs a real cost improvement; regression cannot hide in averages', () => {
  const e = { profileRevision: 'p', cases: [
    { id: 'a', split: 'development', baseline: true, candidate: true },
    { id: 'b', split: 'holdout', baseline: true, candidate: true },
  ], safety: true, targetCaseIds: ['a'], baselineTokens: 100, candidateTokens: 100 };
  expect(compareEvaluation('persona', e).status).not.toBe('passed');
  expect(compareEvaluation('persona', { ...e, candidateTokens: 80 }).status).toBe('passed');
  expect(compareEvaluation('persona', { ...e, candidateTokens: 10, cases: [e.cases[0], { ...e.cases[1], candidate: false }] }).status).toBe('failed');
});
test('more specific preferences win; same-scope conflicts need review, not latest-wins', () => {
  const common = { key: 'verbosity', value: 'detailed', scope: { kind: 'owner', id: 'owner' }, cycleId: 'a' };
  const specific = { ...common, value: 'brief', scope: { kind: 'project', id: 'wiki' }, cycleId: 'b' };
  expect(selectPreferences([common, specific], { project: 'wiki' }).preferences[0].value).toBe('brief');
  expect(selectPreferences([common, specific, { ...specific, value: 'detailed', cycleId: 'c' }], { project: 'wiki' }).conflicts).toEqual(['verbosity']);
  expect(selectPreferences([specific], { project: 'different' }).preferences).toEqual([]);
});
