import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { ContinuityService } from './continuity.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-learning-prerequisite-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const continuity = new ContinuityService(fs, { access, buildLearningPath: (p, path, depth, limit, chars) => wiki.learningPath(p, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  const write = (path: string, frontmatter: Record<string, unknown> = {}, content = '# Note\n') => fs.writeNote({ path, content, frontmatter: { note_kind: 'atomic', ...frontmatter } });
  await write('MOC.md', { note_kind: 'moc' }, '[[A.md]]\n[[B.md]]');
  await write('A.md', { depends_on: ['[[Foundation]]'] });
  await write('B.md');
  const checkpoint = '_scopes/agents/worker/_continuity/work-state.md';
  const save = (order = 'authored') => continuity.save({ principal, topic: 'Learn', summary: 'Read A', nextAction: 'Continue', learningProgress: { rootPath: 'MOC.md', order, completedThrough: 'A.md' } });
  return { vault, fs, wiki, continuity, principal, write, checkpoint, save };
}

test.each(['revised', 'hidden', 'deleted', 'newly-resolved', 'ambiguous'].flatMap(change => ['authored', 'recommended'].map(order => ({ change, order }))))('external prerequisite $change invalidates $order progress without changing the reading entries', async ({ change, order }) => {
  const { vault, fs, continuity, principal, write, checkpoint, save } = await fixture();
  if (change !== 'newly-resolved') await write('Source.md', { aliases: ['Foundation'] });
  await save(order);
  const before = await fs.readNote(checkpoint);
  if (change === 'deleted') await unlink(join(vault, 'Source.md'));
  else if (change === 'ambiguous') await write('Second.md', { aliases: ['Foundation'] });
  else await write('Source.md', { aliases: ['Foundation'], ...(change === 'hidden' && { moderation_status: 'hidden' }) }, '# Changed source\nPRIVATE-MARKER\n');
  const resumed = await continuity.read({ principal });
  expect(resumed.learningProgress).toMatchObject({ state: 'stale', canResume: false, drift: { sourceSnapshotChanged: true, rootChanged: false, structureChanged: false, changedEntriesTotal: 0 } });
  expect(resumed.learningProgress.next).toBeUndefined();
  expect(JSON.stringify(resumed.learningProgress)).not.toContain('PRIVATE-MARKER');
  expect((await fs.readNote(checkpoint)).revision).toBe(before.revision);
});

test('source snapshot is bounded and ignores unrelated and inaccessible alias edits', async () => {
  const { fs, continuity, principal, write, checkpoint, save } = await fixture();
  await write('Source.md', { aliases: ['Foundation'] });
  await save();
  const saved = await fs.readNote(checkpoint);
  expect(saved.frontmatter.learning_progress.source_revision_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(saved.frontmatter.learning_progress.entries.map((item: { path: string }) => item.path)).toEqual(['A.md', 'B.md']);
  expect(JSON.stringify(saved.frontmatter.learning_progress)).not.toContain('Source.md');
  await write('Unrelated.md', {}, 'Changed unrelated knowledge');
  await write('_scopes/agents/other/Secret.md', { aliases: ['Foundation'] });
  const resumed = await continuity.read({ principal });
  expect(resumed.learningProgress).toMatchObject({ state: 'ready', canResume: true, next: { path: 'B.md' } });
  expect((await fs.readNote(checkpoint)).revision).toBe(saved.revision);
});

test('legacy checkpoints without a source snapshot require recapture without losing history', async () => {
  const { fs, continuity, principal, write, checkpoint, save } = await fixture();
  await write('Source.md', { aliases: ['Foundation'] });
  await save();
  const saved = await fs.readNote(checkpoint);
  delete saved.frontmatter.learning_progress.source_revision_fingerprint;
  await fs.writeNote({ path: checkpoint, content: saved.content, frontmatter: saved.frontmatter, expectedRevision: saved.revision });
  const legacy = await fs.readNote(checkpoint);
  const resumed = await continuity.read({ principal });
  expect(resumed.learningProgress).toMatchObject({ state: 'stale', canResume: false, drift: { sourceSnapshotChanged: true, sourceSnapshotMissing: true }, nextAction: { endpointId: 'wiki.learning_path' } });
  expect((await fs.readNote(checkpoint)).revision).toBe(legacy.revision);
  await save();
  expect((await continuity.read({ principal })).learningProgress?.state).toBe('ready');
});

test.each(['authored', 'recommended'])('shared-source ambiguity still invalidates %s progress', async order => {
  const { fs, continuity, principal, write, checkpoint, save } = await fixture();
  await write('Source.md', { aliases: ['Foundation'] });
  await write('B.md', { depends_on: ['[[Source.md]]'] });
  await save(order);
  const before = await fs.readNote(checkpoint);
  await write('Other.md', { aliases: ['Foundation'] });
  expect((await continuity.read({ principal })).learningProgress).toMatchObject({ state: 'stale', canResume: false, drift: { sourceSnapshotChanged: true } });
  expect((await fs.readNote(checkpoint)).revision).toBe(before.revision);
});

test('a persisted array is not a valid source digest even if it stringifies to the correct hash', async () => {
  const { fs, continuity, principal, checkpoint, save } = await fixture();
  await save();
  const note = await fs.readNote(checkpoint);
  note.frontmatter.learning_progress.source_revision_fingerprint = [note.frontmatter.learning_progress.source_revision_fingerprint];
  await fs.writeNote({ path: checkpoint, content: note.content, frontmatter: note.frontmatter, expectedRevision: note.revision });
  expect((await continuity.read({ principal })).learningProgress).toMatchObject({ state: 'invalid_checkpoint', canResume: false });
});

test.each([undefined, ['a'.repeat(64)], 123, 'invalid'].map(value => ({ value })))('missing or malformed builder digest $value cannot overwrite a checkpoint', async ({ value }) => {
  const { fs, wiki, principal, checkpoint, save } = await fixture();
  await save();
  const before = await fs.readNote(checkpoint);
  const continuity = new ContinuityService(fs, { buildLearningPath: async (...args) => ({ ...await wiki.learningPath(...args, true), sourceRevisionFingerprint: value }) });
  await expect(continuity.save({ principal, topic: 'No overwrite', summary: 'Invalid source snapshot', nextAction: 'Retry', learningProgress: { rootPath: 'MOC.md' }, expectedRevision: before.revision })).rejects.toThrow(/valid source revision fingerprint/);
  expect((await fs.readNote(checkpoint)).revision).toBe(before.revision);
});

test('source snapshot does not depend on metadata enumeration order', async () => {
  const { fs, wiki, principal, write } = await fixture();
  await write('Source.md', { aliases: ['Foundation'] });
  const before = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000, true);
  const query = fs.queryNotes.bind(fs);
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const page = await query(...args);
    return { ...page, notes: [...page.notes].reverse() };
  });
  const after = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000, true);
  expect(after.sourceRevisionFingerprint).toBe(before.sourceRevisionFingerprint);
});
