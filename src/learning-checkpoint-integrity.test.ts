import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { ContinuityService } from './continuity.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-learning-integrity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const continuity = new ContinuityService(fs, { access, buildLearningPath: (p, path, depth, limit, chars) => wiki.learningPath(p, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  const write = (path: string, frontmatter: Record<string, unknown> = {}, content = '# Entry\n') => fs.writeNote({ path, content, frontmatter: { note_kind: 'atomic', llm_wiki_type: 'knowledge', ...frontmatter } });
  await write('MOC.md', { note_kind: 'moc' }, '# Map\n[[A.md]]\n[[Next]]\n');
  await write('A.md');
  const checkpoint = '_scopes/agents/worker/_continuity/work-state.md';
  const save = (order: string) => continuity.save({ principal, topic: 'Learn', summary: 'Read A', nextAction: 'Read next', learningProgress: { rootPath: 'MOC.md', order, completedThrough: 'A.md' } });
  return { fs, wiki, continuity, principal, write, checkpoint, save };
}

test.each(['authored', 'recommended'])('%s checkpoints reject an unresolved authored route without blocking ordinary work notes', async order => {
  const { fs, continuity, principal, checkpoint, save } = await fixture();
  await expect(save(order)).rejects.toThrow(/unresolved|ambiguous|inaccessible/);
  expect(await fs.exists(checkpoint)).toBe(false);
  const work = await continuity.save({ principal, topic: 'Repair map', summary: 'Next entry is missing.', nextAction: 'Find the intended note.' });
  expect(work.success).toBe(true);
});

test.each(['ambiguous', 'inaccessible'])('%s authored links do not silently vanish from a learning checkpoint', async state => {
  const { fs, wiki, principal, write, checkpoint, save } = await fixture();
  if (state === 'ambiguous') {
    await write('First.md', { aliases: ['Next'] });
    await write('Second.md', { aliases: ['Next'] });
  } else {
    await write('_scopes/agents/other/Private.md', { aliases: ['Next'], title: 'PRIVATE-MARKER' });
  }
  const projection = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000);
  expect(projection.authoredOrder.map(item => item.path)).toEqual(['A.md']);
  expect(projection.navigationComplete).toBe(false);
  await expect(save('authored')).rejects.toThrow(/unresolved|ambiguous|inaccessible/);
  expect(await fs.exists(checkpoint)).toBe(false);
  expect(JSON.stringify(projection)).not.toContain('PRIVATE-MARKER');
});

test('repairing an unresolved route enables a complete current checkpoint', async () => {
  const { wiki, principal, write, save } = await fixture();
  await write('Next.md');
  const projection = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000);
  expect(projection.navigationComplete).toBe(true);
  const result = await save('recommended');
  expect(result.learningProgress).toMatchObject({ state: 'ready', entriesTracked: 2, next: { path: 'Next.md' } });
});

test('nested unresolved routes remain incomplete in compact views and stale resume preserves history', async () => {
  const { fs, wiki, continuity, principal, write, checkpoint, save } = await fixture();
  await write('Next.md');
  await save('authored');
  const before = await fs.readNote(checkpoint);
  await write('Next.md', { note_kind: 'moc' }, '# Nested\n[[Not-yet-written]]\n');
  const compact = await wiki.learningPath(principal, 'MOC.md', 2, 30, 1024);
  expect(compact.navigationComplete).toBe(false);
  expect(JSON.stringify(compact).length).toBeLessThanOrEqual(1024);
  const resumed = await continuity.read({ principal });
  expect(resumed.learningProgress).toMatchObject({ state: 'stale', canResume: false, nextAction: { endpointId: 'wiki.learning_path' } });
  expect(resumed.learningProgress.drift.validationError).toMatch(/unresolved|ambiguous|inaccessible/);
  expect(resumed.learningProgress.next).toBeUndefined();
  expect((await fs.readNote(checkpoint)).revision).toBe(before.revision);
});
