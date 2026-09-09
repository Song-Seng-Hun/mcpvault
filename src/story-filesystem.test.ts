import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { withStoryWrite } from './story-boundary.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'story-files-')); roots.push(root); return { root, fs: new FileSystemService(root) }; }

test('Fountain is supported only beneath the managed story tree, with ordinary path filtering', () => {
  const filter = new PathFilter();
  expect(filter.isAllowed('Community/Stories/book/Exports/script.fountain')).toBe(true);
  expect(filter.isAllowed('Downloads/script.fountain')).toBe(false);
  expect(filter.isAllowed('Community/Stories/.git/script.fountain')).toBe(false);
});

test('story image revisions hash raw bytes, enforce bounds and do not broaden note APIs', async () => {
  const { root, fs } = await fixture(); await mkdir(join(root, 'Images'));
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]);
  await writeFile(join(root, 'Images/image.png'), bytes);
  expect(typeof (fs as any).readStoryImageRevision).toBe('function');
  expect(await (fs as any).readStoryImageRevision('Images/image.png')).toBe(createHash('sha256').update(bytes).digest('hex'));
  await expect((fs as any).readStoryImageRevision('Images/image.png', 3)).rejects.toThrow(/budget|limit|exceed/i);
  expect(await (fs as any).readStoryImageRevision('Images/missing.png')).toBeUndefined();
  await expect(fs.readNote('Images/image.png')).rejects.toThrow(/restricted|denied/i);
  await expect((fs as any).readStoryImageRevision('../image.png')).rejects.toThrow(/traversal/i);
  await expect((fs as any).readStoryImageRevision('.git/image.png')).rejects.toThrow(/restricted|denied/i);
  await expect((fs as any).readStoryImageRevision('Images/file.exe')).rejects.toThrow(/image|extension/i);
});

test('story asset aliases cannot cross scope or restricted symlink targets', async () => {
  const { root, fs } = await fixture();
  await mkdir(join(root, '_scopes/models/hidden'), { recursive: true });
  await writeFile(join(root, '_scopes/models/hidden/image.png'), Buffer.from([1, 2, 3]));
  await symlink(join(root, '_scopes/models/hidden'), join(root, 'Images'), 'junction');
  expect(typeof (fs as any).readStoryImageRevision).toBe('function');
  await expect((fs as any).readStoryImageRevision('Images/image.png')).rejects.toThrow(/canonical|scope|alias|symbolic/i);
});

test('raw Fountain writes still require the exact scoped story mutation grant', async () => {
  const { fs } = await fixture(); const path = 'Community/Stories/book/Exports/script.fountain';
  await expect(fs.writeNote({ path, content: '@아이리스\n대사\n', expectedRevision: 'missing' })).rejects.toThrow(/story|managed/i);
  await withStoryWrite(path, () => fs.writeNote({ path, content: '@아이리스\n대사\n', expectedRevision: 'missing' }));
  expect((await fs.readNote(path)).originalContent).toBe('@아이리스\n대사\n');
});

test('output fingerprints distinguish invalid UTF-8 bytes from replacement-character text', async () => {
  const { root, fs } = await fixture(); const path = 'Community/Stories/book/Exports/script.output.md';
  await withStoryWrite(path, () => fs.writeNote({ path, content: '�', expectedRevision: 'missing' }));
  expect(typeof (fs as any).readStoryOutputRevision).toBe('function');
  const first = await (fs as any).readStoryOutputRevision(path);
  await writeFile(join(root, path), Buffer.from([0xff]));
  expect((await fs.readNote(path)).originalContent).toBe('�');
  expect(await (fs as any).readStoryOutputRevision(path)).not.toBe(first);
  await expect((fs as any).readStoryOutputRevision('_scopes/models/owner/secret.md')).rejects.toThrow(/story|output|path/i);
});

test('a last-moment host edit during authorization is not overwritten after the first CAS check', async () => {
  const { root, fs } = await fixture(); const path = 'Community/Stories/book/Exports/script.output.md';
  await withStoryWrite(path, () => fs.writeNote({ path, content: 'original', expectedRevision: 'missing' }));
  const prior = (await fs.readNote(path)).revision!; let checks = 0;
  await expect(withStoryWrite(path, () => fs.writeNoteWithReceipt({ path, content: 'generated', expectedRevision: prior }, {
    assertAccess: async () => { if (++checks === 2) await writeFile(join(root, path), 'USER-EDIT'); },
  }))).rejects.toThrow(/revision|changed|conflict/i);
  expect((await fs.readNote(path)).originalContent).toBe('USER-EDIT');
});

test('a related source changed during final authorization invalidates a guarded write', async () => {
  const { root, fs } = await fixture(); const path = 'Community/Stories/book/Exports/script.output.md';
  await fs.writeNote({ path: 'Source.md', content: 'source', expectedRevision: 'missing' });
  const sourceRevision = (await fs.readNote('Source.md')).revision!; let checks = 0;
  await expect(withStoryWrite(path, () => fs.writeNoteWithRevisionGuardsAndReceipt({ path, content: 'generated', expectedRevision: 'missing' },
    [{ path: 'Source.md', expectedRevision: sourceRevision }], { assertAccess: async () => { if (++checks === 2) await writeFile(join(root, 'Source.md'), 'CHANGED'); } })))
    .rejects.toThrow(/revision|changed|conflict/i);
  expect(await fs.noteExists(path)).toBe(false);
});

test('final output CAS rejects raw invalid-byte edits even when decoded text is unchanged', async () => {
  const { root, fs } = await fixture(); const path = 'Community/Stories/book/Exports/script.output.md';
  await withStoryWrite(path, () => fs.writeNote({ path, content: '�', expectedRevision: 'missing' }));
  const prior = (await fs.readNote(path)).revision!; let checks = 0;
  await expect(withStoryWrite(path, () => fs.writeNoteWithReceipt({ path, content: 'generated', expectedRevision: prior }, {
    assertAccess: async () => { if (++checks === 2) await writeFile(join(root, path), Buffer.from([0xff])); },
  }))).rejects.toThrow(/revision|changed|conflict/i);
  expect(await fs.readStoryOutputRevision(path)).toBe(createHash('sha256').update(Buffer.from([0xff])).digest('hex'));
});
