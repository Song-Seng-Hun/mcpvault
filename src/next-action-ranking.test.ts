import { expect, test, vi } from 'vitest';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const task = (path: string, extra: Record<string, unknown> = {}) => ({ path, revision: 'a'.repeat(64),
  frontmatter: { note_kind: 'task', task_status: 'open', next_action: 'Execute concrete work', ...extra },
});

test('full-cohort ranking agrees with a full-sort oracle across input orders and limits', async () => {
  const classes = ['research', 'standard', 'fixed_date', 'expedite'];
  const notes = Array.from({ length: 120 }, (_, i) => task(`Task-${String(i).padStart(3, '0')}.md`, {
    task_status: i % 7 === 0 ? 'next_action' : 'open', task_context: i % 2 ? '@research' : '@computer',
    service_class: classes[i % 4], ...(i % 3 === 0 && { due_at: `200${i % 9}-01-01T00:00:00Z` }),
  }));
  const fm = (note: ReturnType<typeof task>) => note.frontmatter as Record<string, any>;
  const deadline = (note: ReturnType<typeof task>) => fm(note).due_at ? Date.parse(fm(note).due_at) : Number.MAX_SAFE_INTEGER;
  const expected = [...notes].sort((a, b) => deadline(a) - deadline(b)
    || Number(fm(b).task_status === 'next_action') - Number(fm(a).task_status === 'next_action')
    || classes.indexOf(fm(b).service_class) - classes.indexOf(fm(a).service_class)
    || fm(a).task_context.localeCompare(fm(b).task_context) || a.path.localeCompare(b.path));
  for (const input of [notes, [...notes].reverse(), [...notes.slice(60), ...notes.slice(0, 60)]]) {
    await withWiki(input, async wiki => {
      for (const limit of [1, 3, 7]) {
        const result = await wiki.nextActions(undefined, undefined, limit, 16000);
        expect(result.total).toBe(120);
        expect(result.items.map(item => item.path)).toEqual(expected.slice(0, limit).map(note => note.path));
      }
    });
  }
});

test('streamed ranking still excludes unknown capacity, waiting and unfinished dependencies', async () => {
  const common = { task_context: '@computer', time_estimate_minutes: 5, energy: 'low', effort: 'medium', due_at: '1970-01-01T00:00:00Z' };
  await withWiki([
    task('Unknown.md', { ...common, time_estimate_minutes: undefined }),
    task('Waiting.md', { ...common, task_status: 'waiting' }),
    task('Gate.md', { task_context: '@elsewhere' }),
    task('Blocked.md', { ...common, depends_on: ['[[Gate]]'] }),
    task('HighEnergy.md', { ...common, energy: 'high' }),
    task('Eligible.md', { ...common, due_at: '2000-01-01T00:00:00Z' }),
  ], async wiki => {
    const result = await wiki.nextActions(undefined, '@computer', 1, 16000, { maxMinutes: 10, energy: 'low', effort: 'medium' });
    expect(result.total).toBe(1);
    expect(result.items[0].path).toBe('Eligible.md');
    expect(result.filterDiagnostics.unknownDuration).toBe(1);
    expect(result.exclusions).toMatchObject({ workflowBlocked: 1, dependencyBlocked: 1 });
  });
});
async function withWiki(notes: ReturnType<typeof task>[], action: (wiki: LlmWikiService) => Promise<void>) {
  const fs = new FileSystemService(process.cwd()), access = new ScopeAccessPolicy();
  const inventory = vi.spyOn(fs, 'readQueryInventory').mockResolvedValue(notes);
  try { await action(new LlmWikiService(fs, access, new ReferenceService(fs, access))); }
  finally { inventory.mockRestore(); }
}

test('an urgent action after the former four-limit window still wins', async () => {
  const notes = Array.from({ length: 20 }, (_, i) => task(`Early-${i}.md`));
  notes.push(task('Urgent.md', { due_at: '2000-01-01T00:00:00Z' }));
  await withWiki(notes, async wiki => {
    const result = await wiki.nextActions(undefined, undefined, 1, 16000);
    expect(result.total).toBe(21);
    expect(result.items[0].path).toBe('Urgent.md');
  });
});

test('a late prerequisite with real unlock impact outranks independent work', async () => {
  const notes = Array.from({ length: 20 }, (_, i) => task(`Early-${i}.md`));
  notes.push(task('Root.md'));
  for (let i = 0; i < 5; i++) notes.push(task(`Child-${i}.md`, { depends_on: ['[[Root]]'] }));
  await withWiki(notes, async wiki => {
    const result = await wiki.nextActions(undefined, undefined, 1, 16000);
    expect(result.total).toBe(21);
    expect(result.items[0]).toMatchObject({ path: 'Root.md', immediateUnlocks: 5 });
    expect(result.exclusions.dependencyBlocked).toBe(5);
  });
});

test('a valid Unix epoch deadline is not treated as an absent deadline', async () => {
  await withWiki([task('Later.md', { due_at: '2000-01-01T00:00:00Z' }), task('Epoch.md', { due_at: '1970-01-01T00:00:00Z' })], async wiki => {
    expect((await wiki.nextActions(undefined, undefined, 1, 16000)).items[0].path).toBe('Epoch.md');
  });
});

test('equal-ranked actions retain authored order without leaking internal rank fields', async () => {
  await withWiki([task('Work.md', { next_action: 'First action', next_actions: ['Second action', 'Third action', 'Fourth action'] })], async wiki => {
    const result = await wiki.nextActions(undefined, undefined, 3, 16000);
    expect(result.items.map(item => item.action)).toEqual(['First action', 'Second action', 'Third action']);
    expect(result.items.every(item => !('rank' in item))).toBe(true);
    expect(result.total).toBe(4);
  });
});
