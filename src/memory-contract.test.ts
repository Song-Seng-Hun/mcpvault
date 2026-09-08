import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { acceptsPlainReference, isReferenceSnapshotPath } from './property-references.js';

let root: string;
let fs: FileSystemService;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'memory-contract-')); fs = new FileSystemService(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('memory basis and correction paths participate in structural reference integrity', () => {
  for (const segments of [['memory_basis', 0, 'path'], ['memory_corrects', 0, 'path'], ['memory_entries', 0, 'basis', 0, 'path']]) {
    expect(acceptsPlainReference(segments)).toBe(true);
    expect(isReferenceSnapshotPath(segments)).toBe(true);
  }
  expect(acceptsPlainReference(['memory_entries', 0, 'use_when'])).toBe(false);
});

test('memory roles and block records are validated by the common note writer', async () => {
  await expect(fs.writeNote({ path: 'Memory.md', content: 'Experience ^one', frontmatter: { memory_role: 'secret' } })).rejects.toThrow(/memory/i);
  await expect(fs.writeNote({ path: 'Memory.md', content: 'Experience ^one', frontmatter: { memory_entries: [{ block_id: 'absent', role: 'episodic' }] } })).rejects.toThrow(/block/i);
  await expect(fs.writeNote({ path: 'Memory.md', content: '```md\nExample ^example\n```', frontmatter: { memory_entries: [{ block_id: 'example', role: 'episodic' }] } })).rejects.toThrow(/block/i);
  await fs.writeNote({ path: 'Memory.md', content: 'Experience ^one', frontmatter: { memory_entries: [{ block_id: 'one', role: 'episodic', observed_at: '2026-09-01' }] } });
});

test('shared memory rejects private references including embedded YAML bypasses', async () => {
  const basis = [{ path: 'scope://agent/alice/Secret.md', revision: 'a'.repeat(64) }];
  await expect(fs.writeNote({ path: 'Shared.md', content: 'Lesson', frontmatter: { memory_role: 'semantic', memory_basis: basis } })).rejects.toThrow(/scope|private/i);
  await expect(fs.writeNote({ path: 'Shared.md', content: '---\nmemory_role: semantic\nmemory_basis:\n  - path: scope://community/local/Secret.md\n    revision: ' + 'a'.repeat(64) + '\n---\nLesson' })).rejects.toThrow(/scope|private/i);
  await expect(fs.writeNote({ path: 'Shared.md', content: '---\n"memory_role": secret\n---\nLesson' })).rejects.toThrow(/memory/i);
});

test('patches, properties and change-set preflight cannot bypass the memory contract', async () => {
  await fs.writeNote({ path: 'Lesson.md', content: 'Lesson ^lesson', frontmatter: { memory_role: 'procedural' } });
  const current = await fs.readNote('Lesson.md');
  await expect(fs.updateFrontmatter({ path: 'Lesson.md', frontmatter: { memory_state: 'secret' }, expectedRevision: current.revision })).rejects.toThrow(/memory/i);
  const patch = await fs.patchNote({ path: 'Lesson.md', oldString: 'memory_role: procedural', newString: 'memory_role: secret', expectedRevision: current.revision });
  expect(patch.success).toBe(false);
  await expect(fs.patchMultipleNotes({ changes: [{ path: 'Lesson.md', expectedRevision: current.revision, frontmatter: { set: { memory_role: 'secret' } } }], dryRun: true })).rejects.toThrow(/memory/i);
  expect((await fs.readNote('Lesson.md')).revision).toBe(current.revision);
});

test('generic file moves cannot publish a private memory basis', async () => {
  const oldPath = '_scopes/agents/alice/Memory.md';
  await fs.writeNote({ path: oldPath, content: 'Private interpretation', frontmatter: {
    memory_role: 'semantic', memory_basis: [{ path: 'scope://agent/alice/Secret.md', revision: 'a'.repeat(64) }],
  } });
  const moved = await fs.moveFile({ oldPath, newPath: 'Memory/Public.md', confirmOldPath: oldPath, confirmNewPath: 'Memory/Public.md' });
  expect(moved.success).toBe(false);
  expect(await fs.noteExists(oldPath)).toBe(true);
  expect(await fs.noteExists('Memory/Public.md')).toBe(false);
});
