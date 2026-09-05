import { expect, test, vi } from 'vitest';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

test('a deep flow chain does not project every detail row after the response cannot fit', async () => {
  const count = 3000;
  const name = (i: number) => `Task-${String(i).padStart(5, '0')}.md`;
  const notes = Array.from({ length: count }, (_, i) => ({ path: name(i), revision: 'a'.repeat(64), frontmatter: {
    note_kind: 'task', task_status: 'open', next_action: 'Perform concrete work',
    ...(i > 0 && { depends_on: [`[[${name(i - 1)}]]`] }),
  } }));
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const inventory = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(notes);
  const publicPath = vi.spyOn(access, 'toPublicPath');
  try {
    const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
    const result = await wiki.flowHealth(undefined, 3, 7, 14, 20, 16000);
    expect(result.dependencyPlan.stats.longestDependencyDepth).toBe(count - 1);
    expect(result.dependencyPlan.stats.stageable).toBe(count);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(16000);
    // One path per work item for lane classification remains; detailed plan
    // projections must scale with output budget, not with chain length.
    expect(publicPath.mock.calls.length).toBeLessThanOrEqual(count + 150);
  } finally { publicPath.mockRestore(); inventory.mockRestore(); }
}, 20000);

test('a short diamond keeps the full lexical predecessor chain and exact unlock counts', async () => {
  const rows = [
    ['Root.md', []], ['B.md', ['[[Root]]']], ['A.md', ['[[Root]]']],
    ['Tail.md', ['[[B]]', '[[A]]']],
  ] as const;
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const inventory = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(rows.map(([path, depends]) => ({
    path, revision: 'b'.repeat(64), frontmatter: { note_kind: 'task', task_status: 'open', next_action: 'Execute concrete work', depends_on: [...depends] },
  })));
  try {
    const result = await new LlmWikiService(fs, access, new ReferenceService(fs, access)).flowHealth(undefined, 3, 7, 14, 20, 16000);
    expect(result.truncated).not.toBe(true);
    expect(result.dependencyPlan.deepestDependencyChain.map((row: any) => row.path)).toEqual(['Root.md', 'A.md', 'Tail.md']);
    expect(result.dependencyPlan.stats).toMatchObject({ stageable: 4, longestDependencyDepth: 2 });
    expect(result.dependencyPlan.unlockPoints.items[0]).toMatchObject({ path: 'Root.md', immediateUnlocks: 2 });
  } finally { inventory.mockRestore(); }
});

test('an oversized early chain row forces honest compaction without losing totals', async () => {
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const inventory = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({
    path: `Task-${i}.md`, revision: 'c'.repeat(64), frontmatter: {
      note_kind: 'task', task_status: 'open', next_action: 'Execute concrete work',
      ...(i === 0 && { title: 'large😀'.repeat(10000) }),
      ...(i > 0 && { depends_on: [`[[Task-${i - 1}]]`] }),
    },
  })));
  try {
    const result = await new LlmWikiService(fs, access, new ReferenceService(fs, access)).flowHealth(undefined, 3, 7, 14, 20, 16000);
    expect(result.truncated).toBe(true);
    expect(result.dependencyPlan.stats).toMatchObject({ stageable: 10, longestDependencyDepth: 9 });
    expect(result.flow).toMatchObject({ totalWork: 10, blocked: 9, readyToPull: 1 });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(16000);
  } finally { inventory.mockRestore(); }
});
