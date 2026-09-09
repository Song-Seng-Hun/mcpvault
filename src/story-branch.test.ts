import { beforeEach, describe, expect, test } from 'vitest';
import type { StoryBranchGraph, StoryBranchRunInput } from './story-branch.js';

const branch = await import('./story-branch.js').catch(() => ({})) as typeof import('./story-branch.js');
beforeEach(() => {
  expect(branch.validateStoryBranchGraph, 'validateStoryBranchGraph exists').toBeTypeOf('function');
  expect(branch.runStoryBranch, 'runStoryBranch exists').toBeTypeOf('function');
});

const graph = (): StoryBranchGraph => ({
  revision: 'graph-r1', startNodeId: 'start',
  variables: [
    { id: 'key', type: 'boolean', initialValue: false },
    { id: 'score', type: 'number', initialValue: 0 },
    { id: 'name', type: 'string', initialValue: '민수' },
  ],
  nodes: [
    { id: 'start', choices: [
      { id: 'left', label: '왼쪽', targetId: 'merge', effects: [{ variableId: 'key', operation: 'set', value: true }, { variableId: 'score', operation: 'add', value: 2 }] },
      { id: 'right', label: '오른쪽', targetId: 'merge', effects: [{ variableId: 'score', operation: 'add', value: 1 }] },
    ] },
    { id: 'merge', choices: [
      { id: 'open', label: '문 열기', targetId: 'end', conditions: [{ variableId: 'key', operator: 'eq', value: true }] },
      { id: 'back', label: '돌아가기', targetId: 'start' },
    ] },
    { id: 'end', end: true, choices: [] },
  ],
});
const runInput = (choiceIds: string[] = []): StoryBranchRunInput => ({ graph: graph(), expectedRevision: 'graph-r1', initialState: {}, choiceIds });

describe('declarative branch graph', () => {
  test('validates merges and diagnoses cycles without rejecting them', () => {
    const result = branch.validateStoryBranchGraph(graph());
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'cycle', severity: 'warning' }));
    expect(result.diagnostics.some(d => d.code === 'unreachable')).toBe(false);
  });

  test('plays selected choices with typed effects, immutable state, and trace', () => {
    const input = runInput(['left', 'open']);
    const result = branch.runStoryBranch(input);
    expect(result).toMatchObject({ graphRevision: 'graph-r1', currentNodeId: 'end', state: { key: true, score: 2, name: '민수' }, ended: true, availableChoices: [] });
    expect(result.trace.map(step => [step.choiceId, step.fromNodeId, step.toNodeId])).toEqual([['left', 'start', 'merge'], ['open', 'merge', 'end']]);
    expect(result.trace[0]!.state).toEqual({ key: true, score: 2, name: '민수' });
    expect(input).toEqual(runInput(['left', 'open']));
  });

  test('merged nodes preserve state of the chosen route rather than unioning alternatives', () => {
    const left = branch.runStoryBranch(runInput(['left']));
    const right = branch.runStoryBranch(runInput(['right']));
    expect(left.currentNodeId).toBe(right.currentNodeId);
    expect(left.availableChoices.map(choice => choice.id)).toEqual(['open', 'back']);
    expect(right.availableChoices.map(choice => choice.id)).toEqual(['back']);
    expect(right.state).toMatchObject({ key: false, score: 1 });
  });

  test('bounded cycle traversal stops before consuming additional choices', () => {
    const result = branch.runStoryBranch({ ...runInput(['left', 'back', 'left']), maxSteps: 2 });
    expect(result).toMatchObject({ currentNodeId: 'start', stepLimitReached: true, consumedChoices: 2 });
    expect(result.trace).toHaveLength(2);
    expect(result.state.score).toBe(2);
  });

  test('rejects stale revision, wrong-node/disabled/unknown choices and choices after end', () => {
    expect(() => branch.runStoryBranch({ ...runInput(), expectedRevision: 'old' })).toThrow(/stale/i);
    for (const choiceIds of [['open'], ['right', 'open'], ['unknown'], ['left', 'open', 'back']]) {
      expect(() => branch.runStoryBranch(runInput(choiceIds))).toThrow(/choice/i);
    }
  });

  test.each([{ key: 'true' }, { score: Infinity }, { unknown: 1 }, { name: null }])('rejects invalid supplied state %j', state => {
    expect(() => branch.runStoryBranch({ ...runInput(), initialState: state as never })).toThrow(/state/i);
  });

  test('uses supplied typed initial state without mutating it', () => {
    const initialState = { key: true, name: '영희', score: 10 };
    const result = branch.runStoryBranch({ ...runInput(['right', 'open']), initialState });
    expect(result.state).toEqual({ key: true, name: '영희', score: 11 });
    expect(initialState.score).toBe(10);
  });

  test('reports broken target/start references, unreachable nodes and dead ends', () => {
    const input = graph();
    input.nodes[0]!.choices[0]!.targetId = 'missing';
    input.nodes.push({ id: 'orphan', choices: [] });
    const result = branch.validateStoryBranchGraph(input);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['broken_target', 'unreachable', 'dead_end']));
    input.startNodeId = 'missing';
    expect(branch.validateStoryBranchGraph(input).diagnostics.map(d => d.code)).toContain('broken_start');
  });

  test('a structurally valid dead end is playable and explicitly reported', () => {
    const input: StoryBranchGraph = { revision: 'r', startNodeId: 'a', variables: [], nodes: [{ id: 'a', choices: [] }] };
    expect(branch.validateStoryBranchGraph(input).valid).toBe(true);
    expect(branch.runStoryBranch({ graph: input, expectedRevision: 'r', initialState: {}, choiceIds: [] })).toMatchObject({ deadEnd: true, ended: false });
  });

  test('diagnoses unknown variables, type mismatches and prohibited operations', () => {
    const input = graph();
    input.nodes[0]!.choices[0]!.effects = [{ variableId: 'key', operation: 'add', value: 1 }];
    input.nodes[1]!.choices[0]!.conditions = [{ variableId: 'missing', operator: 'eq', value: true }];
    input.variables[2]!.initialValue = 5;
    expect(branch.validateStoryBranchGraph(input).diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['unknown_variable', 'type_mismatch']));
    expect(() => branch.runStoryBranch({ ...runInput(), graph: input })).toThrow(/graph/i);
    input.nodes[0]!.choices[0]!.effects = [{ variableId: 'score', operation: 'eval', value: 'process.exit()' } as never];
    expect(branch.validateStoryBranchGraph(input).valid).toBe(false);
  });

  test('handles all declarative comparisons and ordered effects', () => {
    const input = graph();
    input.nodes[0]!.choices[0]!.conditions = [
      { variableId: 'score', operator: 'gte', value: 0 }, { variableId: 'score', operator: 'lte', value: 0 },
      { variableId: 'score', operator: 'gt', value: -1 }, { variableId: 'score', operator: 'lt', value: 1 },
      { variableId: 'name', operator: 'ne', value: '영희' },
    ];
    input.nodes[0]!.choices[0]!.effects = [{ variableId: 'score', operation: 'set', value: 5 }, { variableId: 'score', operation: 'add', value: -2 }];
    expect(branch.runStoryBranch({ ...runInput(['left']), graph: input }).state.score).toBe(3);
  });

  test('rejects duplicates, outgoing end choices, reserved variable IDs and oversize graphs', () => {
    const input = graph();
    input.nodes.push({ ...input.nodes[0]! });
    expect(branch.validateStoryBranchGraph(input).valid).toBe(false);
    const end = graph();
    end.nodes[0]!.end = true;
    expect(branch.validateStoryBranchGraph(end).valid).toBe(false);
    const reserved = graph();
    reserved.variables[0]!.id = '__proto__';
    expect(branch.validateStoryBranchGraph(reserved).valid).toBe(false);
    expect(branch.validateStoryBranchGraph({ ...graph(), nodes: Array.from({ length: 257 }, (_, i) => ({ id: `n${i}`, choices: [] })) }).valid).toBe(false);
  });

  test('bounds step counts, sequence, state strings, and arithmetic overflow', () => {
    for (const maxSteps of [0, -1, 257, NaN, 1.5]) expect(() => branch.runStoryBranch({ ...runInput(), maxSteps })).toThrow(/bound|steps/i);
    expect(() => branch.runStoryBranch(runInput(Array(4097).fill('left')))).toThrow(/bound/i);
    expect(() => branch.runStoryBranch({ ...runInput(), initialState: { name: 'x'.repeat(4097) } })).toThrow(/state/i);
    const input = graph();
    input.nodes[0]!.choices[0]!.effects = [{ variableId: 'score', operation: 'add', value: Number.MAX_VALUE }];
    expect(() => branch.runStoryBranch({ ...runInput(['left']), graph: input, initialState: { score: Number.MAX_VALUE } })).toThrow(/finite|overflow/i);
  });

  test('rejects null step limit rather than silently defaulting', () => {
    expect(() => branch.runStoryBranch({ ...runInput(), maxSteps: null as never })).toThrow(/steps|bound/i);
  });

  test('does not misdiagnose acyclic reconvergence as a cycle', () => {
    const input = graph();
    input.nodes[1]!.choices.pop();
    expect(branch.validateStoryBranchGraph(input).diagnostics.map(d => d.code)).not.toContain('cycle');
  });

  test('malformed JSON and embedded script fields are rejected without executing', () => {
    for (const input of [null, {}, { ...graph(), nodes: [null] }, { ...graph(), variables: [null] }, { ...graph(), script: 'throw new Error()' }]) {
      expect(branch.validateStoryBranchGraph(input as never).valid).toBe(false);
    }
  });

  test('caps diagnostics and trace expansion', () => {
    const input: StoryBranchGraph = { revision: 'r', startNodeId: 'n0', variables: [], nodes: Array.from({ length: 256 }, (_, i) => ({ id: `n${i}`, choices: [] })) };
    const result = branch.validateStoryBranchGraph(input);
    expect(result).toMatchObject({ valid: true, diagnosticsTruncated: true });
    expect(result.diagnostics).toHaveLength(256);
    const large = graph();
    large.variables = Array.from({ length: 128 }, (_, i) => ({ id: `v${i}`, type: 'string', initialValue: '한'.repeat(4096) }));
    large.nodes = [{ id: 'start', choices: [{ id: 'loop', targetId: 'start', label: '계속' }] }];
    expect(() => branch.runStoryBranch({ ...runInput(['loop', 'loop', 'loop', 'loop']), graph: large })).toThrow(/output bound/i);
  });
});
