import { expect, test, vi } from 'vitest';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { classifyDependencyResidual } from './dependency-graph.js';

test('a deep work chain is classified and staged without exhausting the call stack', async () => {
  // Inject only the inventory boundary; run real reference resolution, work
  // classification, cycle detection and stage computation used by public views.
  const count = 12000;
  const name = (i: number) => `Task-${String(i).padStart(5, '0')}.md`;
  const notes = Array.from({ length: count }, (_, i) => ({ path: name(i), revision: 'a'.repeat(64), frontmatter: {
    note_kind: 'task', task_status: 'open', next_action: 'Perform concrete work',
    ...(i + 1 < count && { depends_on: [`[[${name(i + 1)}]]`] }),
  } }));
  const fs = new FileSystemService(process.cwd());
  const spy = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(notes);
  const access = new ScopeAccessPolicy(), wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  try {
    const snapshot = await (wiki as any).workDependencySnapshot();
    expect(snapshot.plan.stageByPath.size).toBe(count);
    expect(snapshot.plan.stageByPath.get(name(0).toLowerCase())).toBe(count - 1);
    expect(snapshot.plan.stageByPath.get(name(count - 1).toLowerCase())).toBe(0);
    expect(snapshot.plan.cycleNodes.size).toBe(0);
  } finally { spy.mockRestore(); }
}, 20000);

test('a 30000-node cycle remains one exact component without recursive frames', () => {
  const nodes = Array.from({ length: 30000 }, (_, i) => `n${i}`);
  const edges = new Map(nodes.map((node, i) => [node, new Set([nodes[(i + 1) % nodes.length]!])]));
  const result = classifyDependencyResidual(nodes, edges);
  expect(result.cycles).toEqual([nodes]);
  expect(result.blocked).toEqual([]);
});

test('small deterministic graphs agree with an independent mutual-reachability oracle', () => {
  let randomState = 92731;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32; };
  for (let run = 0; run < 150; run++) {
    const nodes = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const edges = new Map(nodes.map(node => [node, new Set(nodes.filter(() => random() < 0.17))]));
    edges.get('n0')!.add('outside');
    const reachable = (start: string) => {
      const seen = new Set([start]), queue = [start];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const target of edges.get(queue[cursor]!) || []) {
          if (!nodes.includes(target) || seen.has(target)) continue;
          seen.add(target); queue.push(target);
        }
      }
      return seen;
    };
    const closures = new Map(nodes.map(node => [node, reachable(node)]));
    const seen = new Set<string>(), cycles: string[][] = [];
    for (const node of nodes) {
      if (seen.has(node)) continue;
      const component = nodes.filter(other => closures.get(node)!.has(other) && closures.get(other)!.has(node));
      component.forEach(member => seen.add(member));
      if (component.length > 1 || edges.get(node)!.has(node)) cycles.push(component);
    }
    const result = classifyDependencyResidual(nodes, edges);
    expect(result.cycles).toEqual(cycles);
    expect(result.blocked).toEqual(nodes.filter(node => !cycles.flat().includes(node)));
  }
});

test('input order, self links and edges outside the selected graph retain exact semantics', () => {
  const nodes = ['z', 'b', 'a', 'self', 'tail'];
  const edges = new Map([['z', new Set(['outside'])], ['a', new Set(['b'])], ['b', new Set(['a'])], ['self', new Set(['self'])], ['tail', new Set(['a'])]]);
  expect(classifyDependencyResidual(nodes, edges)).toEqual({
    cycles: [['b', 'a'], ['self']], cycleNodes: new Set(['b', 'a', 'self']), blocked: ['z', 'tail'],
  });
  expect(classifyDependencyResidual([], edges)).toEqual({ cycles: [], cycleNodes: new Set(), blocked: [] });
});

test('wide work frontiers preserve exact stages and immediate unlock counts', async () => {
  const width = 2000;
  const notes = Array.from({ length: width }, (_, i) => ({ path: `Child-${i}.md`, revision: 'a'.repeat(64),
    frontmatter: { note_kind: 'task', task_status: 'open', next_action: 'Execute child', depends_on: ['[[Root]]'] } }));
  notes.push({ path: 'Root.md', revision: 'b'.repeat(64), frontmatter: { note_kind: 'task', task_status: 'open', next_action: 'Execute root', depends_on: [] } });
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const spy = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(notes);
  try {
    const result = await (new LlmWikiService(fs, access, new ReferenceService(fs, access)) as any).workDependencySnapshot();
    expect(result.plan.stageByPath.size).toBe(width + 1);
    expect(result.plan.immediateUnlockByPath.get('root.md')).toBe(width);
    expect([...result.plan.stageByPath.values()].filter(stage => stage === 1)).toHaveLength(width);
  } finally { spy.mockRestore(); }
});
