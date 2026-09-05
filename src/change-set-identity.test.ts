import { beforeEach, afterEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
let vault: string;
let fs: FileSystemService;
let changed: string[];
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-change-identity-'));
  changed = [];
  fs = new FileSystemService(vault, undefined, undefined, path => { changed.push(path); });
  await writeFile(join(vault, 'Note.md'), 'Original\n');
  await writeFile(join(vault, 'Other.md'), 'Other\n');
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
test.each(['./Note.md', 'dir/../Note.md', 'absolute'])(
  'duplicate target %s is rejected before preview and apply', async alias => {
    const path = alias === 'absolute' ? `${vault}/./Note.md` : alias;
    const revision = (await fs.readNote('Note.md')).revision!;
    const changes = ['Note.md', path].map((path, index) => ({ path, expectedRevision: revision, patches: [{ oldString: 'Original', newString: `Edit${index}` }] }));
    await expect(fs.patchMultipleNotes({ changes, dryRun: true })).rejects.toThrow(/only once/);
    await expect(fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: '0'.repeat(64) })).rejects.toThrow(/only once/);
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe('Original\n');
    expect(changed).toEqual([]);
  },
);
test('target cannot become its own revision guard through an alias', async () => {
  const revision = (await fs.readNote('Note.md')).revision!;
  await expect(fs.writeNoteWithRevisionGuards({ path: 'Note.md', content: 'Changed\n', expectedRevision: revision }, [
    { path: './Note.md', expectedRevision: revision },
  ])).rejects.toThrow(/cannot repeat the target/);
  expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe('Original\n');
  expect(changed).toEqual([]);
});
test('one related guard cannot be supplied twice under different spellings', async () => {
  const revision = (await fs.readNote('Note.md')).revision!;
  const otherRevision = (await fs.readNote('Other.md')).revision!;
  await expect(fs.writeNoteWithRevisionGuards({ path: 'Note.md', content: 'Changed\n', expectedRevision: revision }, [
    { path: 'Other.md', expectedRevision: otherRevision },
    { path: './Other.md', expectedRevision: otherRevision },
  ])).rejects.toThrow(/only once/);
  expect(changed).toEqual([]);
});
test('distinct targets still preview and apply the exact combined edits', async () => {
  const changes = await Promise.all(['Note.md', './Other.md'].map(async path => ({
    path, expectedRevision: (await fs.readNote(path)).revision!, frontmatter: { set: { reviewed: true } },
  })));
  const preview = await fs.patchMultipleNotes({ changes });
  const applied = await fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint });
  expect(applied.applied).toBe(true);
  expect(applied.changedCount).toBe(2);
  expect((await fs.readNote('Note.md')).frontmatter.reviewed).toBe(true);
  expect((await fs.readNote('Other.md')).frontmatter.reviewed).toBe(true);
  expect(changed).toHaveLength(2);
});
