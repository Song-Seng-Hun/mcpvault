import { expect, test } from 'vitest';
import * as graph from './capability-graph.js';

test('validates reusable advisory prerequisite DAGs and resolves dependency removal', () => {
  const nodes = [{ id: 'base', requires: [], excludes: [], cost: 0 }, { id: 'advanced', requires: ['base'], excludes: [], cost: 2 }];
  expect(graph.validateCapabilityGraph(nodes)).toEqual(nodes);
  expect(graph.capabilityRemoval(nodes, ['base', 'advanced'], ['base'])).toEqual(['base', 'advanced']);
  expect(() => graph.validateCapabilitySelection(nodes, ['advanced'])).toThrow(/prerequisite/);
});
test('rejects cycles, missing references, exclusions, executable fields and unbounded graphs', () => {
  const node = (id: string, requires: string[] = [], excludes: string[] = []) => ({ id, requires, excludes, cost: 1 });
  for (const bad of [[node('a', ['a'])], [node('a', ['b']), node('b', ['a'])], [node('a', ['missing'])], [node('a'), node('a')], [{ ...node('a'), script: 'eval()' }], Array.from({ length: 129 }, (_, i) => node(`n-${i}`))]) expect(() => graph.validateCapabilityGraph(bad)).toThrow();
  const nodes = [node('a', [], ['b']), node('b')];
  expect(() => graph.validateCapabilitySelection(nodes, ['a', 'b'])).toThrow(/exclusion/);
  expect(() => graph.validateCapabilitySelection(nodes, ['constructor'])).toThrow();
});

test('named learning-path and procedural-bundle adapters share graph/selection validation without execution or grants', () => {
  const input = { id: 'onboarding', version: '1.0.0', nodes: [{ id: 'basics', requires: [], excludes: [], cost: 1 }, { id: 'review', requires: ['basics'], excludes: [], cost: 2 }], selected: ['basics', 'review'] };
  const original = structuredClone(input);
  for (const [kind, check] of [['learning-path', graph.validateLearningPathConfiguration], ['procedural-bundle', graph.validateProceduralBundleConfiguration]] as const) {
    const result = check(input);
    expect(result).toMatchObject({ kind, id: 'onboarding', version: '1.0.0', valid: true, nodeCount: 2, selectedCount: 2, totalCost: 3, executable: false, permissionsGranted: false });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(result).length).toBeLessThan(512);
    expect(check({ ...input, selected: ['review', 'basics'], nodes: [...input.nodes].reverse() }).fingerprint).toBe(result.fingerprint);
    expect(() => check({ ...input, selected: ['review'] })).toThrow(/prerequisite/);
    expect(() => check({ ...input, script: 'run process' })).toThrow(/field/);
    expect(() => check({ ...input, permissions: ['shell'] })).toThrow(/field/);
    expect(() => check({ ...input, version: 'latest' })).toThrow(/version/);
    expect(() => check({ ...input, nodes: [{ id: 'loop', requires: ['loop'], excludes: [], cost: 1 }] })).toThrow(/cycle/);
  }
  expect(input).toEqual(original);
});
