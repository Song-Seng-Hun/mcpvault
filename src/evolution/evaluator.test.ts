import { expect, test } from 'vitest';
import * as runtime from './evaluator.js';
import { compareEvaluation, hash } from './policy.js';

test('server-only savings and static expression checks cannot certify whole-task improvement', () => {
  const cases = [{ id: 'a', split: 'development', baseline: true, candidate: true }, { id: 'b', split: 'holdout', baseline: true, candidate: true }];
  const e: any = { method: 'synthetic', profileRevision: 'v1', safety: true, targetCaseIds: ['a'], cases,
    baselineMs: 100, candidateMs: 1, measurementScope: 'search_server', adoption: 'diagnostic' };
  expect(compareEvaluation('harness', e)).toEqual({ status: 'review_required', reason: 'diagnostic_evaluation_only' });
});

test('three paired trials alternate order and preserve bounded measurement scope', async () => {
  const order: string[] = [];
  const runner = new runtime.EvolutionEvaluator([{ kind: 'harness', revision: 'p', method: 'synthetic', repetitions: 3,
    measurementScope: 'search_server', adoption: 'diagnostic', cases: [
      { id: 'a', split: 'development', target: true, run: async ({ variant }) => { order.push(variant); return { passed: true, safety: true, resultHash: hash(variant), elapsedMs: 1 }; } },
      { id: 'b', split: 'holdout', run: async () => ({ passed: true, safety: true, resultHash: hash('b') }) },
    ] } as any]);
  const result = await runner.evaluate({ target: { kind: 'harness' } } as any, new AbortController().signal);
  expect(order).toEqual(['baseline', 'candidate', 'candidate', 'baseline', 'baseline', 'candidate']);
  expect(result).toMatchObject({ measurementScope: 'search_server', adoption: 'diagnostic' });
  expect(result.trials).toHaveLength(3);
});

test('code-owned runner executes paired cases, preserves provenance and hides case payloads', async () => {
  expect(runtime.EvolutionEvaluator).toBeTypeOf('function');
  const calls: string[] = [];
  const runner = new runtime.EvolutionEvaluator([{
    kind: 'persona', revision: 'renderer1', method: 'synthetic', cases: [
      { id: 'target', split: 'development', target: true, run: async ({ variant }: any) => {
        calls.push(variant); const output = variant === 'candidate' ? ['short'] : ['long', 'extra'];
        return { passed: output.length === 1, safety: true, resultHash: hash(output), tokens: output.length, elapsedMs: 1 };
      } },
      { id: 'private-case', split: 'holdout', run: async () => ({ passed: true, safety: true, resultHash: hash('secret-case-instance') }) },
    ],
  }]);
  const result = await runner.evaluate({ target: { kind: 'persona' }, candidate: { key: 'verbosity', value: 'brief' } } as any, new AbortController().signal);
  expect(calls).toEqual(['baseline', 'candidate']);
  expect(result.method).toBe('synthetic'); expect(compareEvaluation('persona', result).status).toBe('passed');
  expect(JSON.stringify(runner.profile({ kind: 'persona', id: 'a' }))).not.toContain('secret-case-instance');
  expect(result.baselineTokens).toBeUndefined(); // An unmetered case makes total usage unknown.
});

test('behavior comparisons require three trials and reject a single paired regression', () => {
  const cases = [ { id: 'a', split: 'development', baseline: true, candidate: true }, { id: 'b', split: 'holdout', baseline: true, candidate: true } ];
  const e: any = { method: 'agent_behavior', profileRevision: 'v1', safety: true, targetCaseIds: ['a'], cases, baselineTokens: 100, candidateTokens: 80 };
  expect(compareEvaluation('persona', e).reason).toBe('paired_trials_required');
  e.trials = Array.from({ length: 3 }, () => ({ cases, safety: true, baselineTokens: 100, candidateTokens: 80 }));
  expect(compareEvaluation('persona', e).status).toBe('passed');
  e.trials[1] = { ...e.trials[1], cases: [cases[0], { ...cases[1], candidate: false }] };
  expect(compareEvaluation('persona', e).status).toBe('failed');
});

test('tiny or forged aggregate savings are not a reason to adopt', () => {
  const cases = [ { id: 'a', split: 'development', baseline: true, candidate: true }, { id: 'b', split: 'holdout', baseline: true, candidate: true } ];
  const e: any = { profileRevision: 'v1', safety: true, targetCaseIds: ['a'], cases, baselineTokens: 100, candidateTokens: 99 };
  expect(compareEvaluation('persona', e).status).not.toBe('passed');
  expect(compareEvaluation('persona', { ...e, candidateTokens: 90 }).status).toBe('passed');
  e.method = 'agent_behavior'; e.candidateTokens = 1;
  e.trials = Array.from({ length: 3 }, () => ({ cases, safety: true, baselineTokens: 100, candidateTokens: 100 }));
  expect(compareEvaluation('persona', e).status).not.toBe('passed');
});

test('runner aborts between calls and never retries a failing check', async () => {
  const controller = new AbortController(); let calls = 0;
  const runner = new runtime.EvolutionEvaluator([{ kind: 'persona', revision: 'p', method: 'operational', cases: [
    { id: 'a', split: 'development', target: true, run: async () => { calls++; controller.abort(); return { passed: true, safety: true, resultHash: hash('x') }; } },
    { id: 'b', split: 'holdout', run: async () => { throw Error('must not run'); } },
  ] }]);
  await expect(runner.evaluate({ target: { kind: 'persona' } } as any, controller.signal)).rejects.toThrow();
  expect(calls).toBe(1);
});
