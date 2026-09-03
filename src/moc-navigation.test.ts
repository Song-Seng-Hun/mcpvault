import { expect, test } from 'vitest';
import { buildMocNavigation, navigationOrder } from './moc-navigation.js';

test('MOC traversal keeps descendants beside their parent and distinguishes broken branches', () => {
  const result = buildMocNavigation([
    { path: 'Maps/Other.md', navOrder: 2 },
    { path: 'Maps/Last.md', parent: '[[Maps/Root]]', navOrder: 20 },
    { path: 'Maps/Grandchild.md', parent: '[[Maps/First]]', navOrder: 999 },
    { path: 'Maps/First.md', parent: '[[maps/root]]', navOrder: 10 },
    { path: 'Maps/Root.md', navOrder: 1 },
    { path: 'Maps/CycleA.md', parent: '[[Maps/CycleB]]' },
    { path: 'Maps/CycleB.md', parent: '[[Maps/CycleA]]' },
    { path: 'Maps/CycleChild.md', parent: '[[Maps/CycleB]]' },
    { path: 'Maps/Broken.md', parent: '[[Missing]]' },
    { path: 'One/Shared.md' }, { path: 'Two/Shared.md' },
    { path: 'Maps/Ambiguous.md', parent: '[[Shared]]' },
  ]);
  expect(result.items.slice(0, 5).map(item => item.path)).toEqual([
    'Maps/Root.md', 'Maps/First.md', 'Maps/Grandchild.md', 'Maps/Last.md', 'Maps/Other.md',
  ]);
  expect(result.items.find(item => item.path === 'Maps/CycleChild.md')?.state).toBe('ancestor_problem');
  expect(result.items.find(item => item.path === 'Maps/CycleA.md')?.state).toBe('cycle');
  expect(result.items.find(item => item.path === 'Maps/Ambiguous.md')?.state).toBe('ambiguous_parent');
  expect(result.roots).not.toContain('Maps/Ambiguous.md');
  expect(result.cycles).toHaveLength(1);
  expect(new Set(result.items.map(item => item.path)).size).toBe(12);
  expect(navigationOrder(null)).toBe(Number.MAX_SAFE_INTEGER);
  expect(navigationOrder(false)).toBe(Number.MAX_SAFE_INTEGER);
  expect(navigationOrder('')).toBe(Number.MAX_SAFE_INTEGER);
});

test('deep MOC chains use iterative traversal instead of overflowing the call stack', () => {
  const nodes = Array.from({ length: 15000 }, (_, index) => ({ path: `MOCs/${index}.md`, ...(index > 0 && { parent: `[[MOCs/${index - 1}]]` }) })).reverse();
  const result = buildMocNavigation(nodes);
  expect(result.items).toHaveLength(15000);
  expect(result.items[0]?.path).toBe('MOCs/0.md');
  expect(result.items.at(-1)).toMatchObject({ path: 'MOCs/14999.md', depth: 14999 });
});
