import { expect, test, vi } from 'vitest';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

test('independent ready work is not projected again as discarded unlock candidates', async () => {
  const count = 3000;
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const inventory = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(Array.from({ length: count }, (_, i) => ({
    path: `Task-${String(count - i).padStart(5, '0')}.md`, revision: 'a'.repeat(64),
    frontmatter: { note_kind: 'task', task_status: 'open', next_action: 'Execute concrete work' },
  })));
  const publicPath = vi.spyOn(access, 'toPublicPath');
  try {
    const result = await new LlmWikiService(fs, access, new ReferenceService(fs, access)).flowHealth(undefined, 3, 7, 14, 1, 16000);
    expect(result.flow.readyToPull).toBe(count);
    expect(result.dependencyPlan.stats).toMatchObject({ stageable: count, stages: 1, longestDependencyDepth: 0 });
    expect(result.dependencyPlan.unlockPoints).toMatchObject({ total: 0, items: [] });
    expect(result.dependencyPlan.recommendedStages[0].items.map((item: any) => item.path)).toEqual([
      'Task-00001.md', 'Task-00002.md', 'Task-00003.md', 'Task-00004.md',
    ]);
    expect(publicPath.mock.calls.length).toBeLessThanOrEqual(count + 20);
  } finally { inventory.mockRestore(); publicPath.mockRestore(); }
});

test('bounded unlock ranking matches a full-sort oracle while keeping all stage totals', async () => {
  const roots = Array.from({ length: 40 }, (_, i) => `Root-${String(40 - i).padStart(3, '0')}`);
  const entries = roots.map(path => ({ path: `${path}.md`, deps: [] as string[] }));
  for (const [i, root] of roots.entries()) {
    for (let j = 0; j < i % 4 + 1; j++) entries.push({ path: `${root}-Child-${j}.md`, deps: [root] });
    entries.push({ path: `${root}-Shared.md`, deps: [root, roots[(i + 1) % roots.length]!] });
  }
  const expected = roots.map(root => ({ path: `${root}.md`,
    directDependents: entries.filter(entry => entry.deps.includes(root)).length,
    immediateUnlocks: entries.filter(entry => entry.deps.length === 1 && entry.deps[0] === root).length,
  })).sort((a, b) => b.immediateUnlocks - a.immediateUnlocks || b.directDependents - a.directDependents || a.path.localeCompare(b.path));
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const inventory = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(entries.map(entry => ({
    path: entry.path, revision: 'a'.repeat(64), frontmatter: { note_kind: 'task', task_status: 'open',
      next_action: 'Execute concrete work', depends_on: entry.deps.map(dep => `[[${dep}]]`),
    },
  })));
  try {
    const result = await new LlmWikiService(fs, access, new ReferenceService(fs, access)).flowHealth(undefined, 3, 7, 14, 3, 16000);
    expect(result.dependencyPlan.unlockPoints.total).toBe(40);
    expect(result.dependencyPlan.unlockPoints.truncated).toBe(true);
    expect(result.dependencyPlan.unlockPoints.items.map((item: any) => ({ path: item.path,
      directDependents: item.directDependents, immediateUnlocks: item.immediateUnlocks,
    }))).toEqual(expected.slice(0, 3));
    expect(result.dependencyPlan.stats).toMatchObject({ stageable: entries.length, stages: 2, longestDependencyDepth: 1 });
    for (const stage of result.dependencyPlan.recommendedStages) {
      const members = entries.filter(entry => (entry.deps.length ? 1 : 0) === stage.stage).map(entry => entry.path).sort();
      expect(stage.total).toBe(members.length);
      expect(stage.items.map((item: any) => item.path)).toEqual(members.slice(0, 4));
      expect(stage.truncated).toBe(members.length > 4);
    }
  } finally { inventory.mockRestore(); }
});
