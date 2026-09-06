import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { allocateProposalPaths } from './proposal-paths.js';

test('keeps non-colliding physical paths unchanged', () => {
  const paths = ['Knowledge/Research.md', '_scopes/models/codex/Knowledge/Research.md'];
  expect(allocateProposalPaths(paths.map((path, index) => ({ path, identity: String(index) })))).toEqual(paths);
});

test('allocates unique case-insensitive destinations independent of input order', () => {
  const items = [{ path: 'Maps/Group.md', identity: 'domain:A/B' }, { path: 'maps/group.md', identity: 'domain:A:B' }];
  const forward = allocateProposalPaths(items);
  expect(new Set(forward.map(path => path.toLowerCase())).size).toBe(2);
  expect(forward).toEqual(allocateProposalPaths([...items].reverse()).reverse());
  expect(forward.every(path => / - [a-f0-9]{12}\.md$/.test(path))).toBe(true);
});

test('reserves natural filenames resembling generated suffixes before allocating', () => {
  const identity = 'domain:A/B', digest = createHash('sha256').update(identity).digest('hex').slice(0, 12);
  const natural = `Maps/Group - ${digest}.md`;
  const items = [
    { path: 'Maps/Group.md', identity },
    { path: 'Maps/Group.md', identity: 'domain:A:B' },
    { path: natural, identity: 'natural-name' },
    { path: `Maps/Group - ${digest}-2.md`, identity: 'natural-counter' },
  ];
  const paths = allocateProposalPaths(items);
  expect(new Set(paths.map(path => path.toLowerCase())).size).toBe(4);
  expect(paths[0]).toBe(`Maps/Group - ${digest}-3.md`);
  expect(paths.slice(2)).toEqual(items.slice(2).map(item => item.path));
  expect(paths).toEqual(allocateProposalPaths([...items].reverse()).reverse());
});

test('normalizes Windows separators before collision comparisons', () => {
  const paths = allocateProposalPaths([{ path: 'Maps\\Group.md', identity: 'one' }, { path: 'Maps/Group.md', identity: 'two' }]);
  expect(new Set(paths.map(path => path.toLowerCase())).size).toBe(2);
  expect(paths.every(path => path.startsWith('Maps/') && !path.includes('\\'))).toBe(true);
});
