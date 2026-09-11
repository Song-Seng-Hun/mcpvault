import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { NoteLinkService } from './note-link.js';
let root: string, fs: FileSystemService;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'wiki-link-resolve-')); fs = new FileSystemService(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function note(path: string, text: string) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
test('new link resolver preserves heading/block locators in exact revision-pinned actions without bodies', async () => {
  await note('Note.md', '---\ntitle: Note\n---\n# Head\nfirst\n## Child\nvalue ^point\n# Other\nlast');
  const service = new NoteLinkService(fs);
  const heading = await service.resolve({ document: '[[Note#Head|display]]' });
  expect(heading).toMatchObject({ status: 'resolved', fragment: { heading: 'Head' }, readAction: { endpointId: 'mcp.read_note_lines', arguments: { path: 'Note.md', startLine: 4, endLine: 7, expectedRevision: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
  const block = await service.resolve({ document: '[[Note#^point]]' });
  expect(block.readAction.arguments).toMatchObject({ startLine: 7, endLine: 7 });
  expect(JSON.stringify(block)).not.toContain('value ^point');
});
test('ambiguity exposes only authorized non-hidden candidates and requires explicit selection', async () => {
  await note('Note.md', '# Root'); await note('deep/Note.md', '# Deep'); await note('hidden/Note.md', '---\nmoderation_status: hidden\n---\nSecret');
  const service = new NoteLinkService(fs);
  const result = await service.resolve({ document: '[[Note]]' });
  expect(result.status).toBe('needs_selection');
  expect(result.candidates.map((row: any) => row.path)).toEqual(['Note.md', 'deep/Note.md']);
  expect(JSON.stringify(result)).not.toContain('hidden');
  expect((await service.resolve({ document: 'Note', path: 'deep/Note.md' })).path).toBe('deep/Note.md');
});
test('legacy first pick and ignored fragment stay bounded with a revision and continuation', async () => {
  await note('Note.md', '# Head\n' + 'longbody '.repeat(7000)); await note('deep/Note.md', '# Deep');
  const result = await new NoteLinkService(fs).legacy({ document: '[[Note#Missing]]', maxChars: 2000 });
  expect(result).toMatchObject({ path: 'Note.md', truncated: true, deprecated: true, revision: expect.any(String), nextAction: { endpointId: 'mcp.read_note_lines' } });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
});
test('hidden matches do not consume the visible candidate window or imply ambiguity', async () => {
  for (let i = 0; i < 33; i++) await note(`a${String(i).padStart(2, '0')}/Note.md`, '---\nmoderation_status: hidden\n---\nSecret');
  await note('z/Note.md', '# Visible');
  const result = await new NoteLinkService(fs).resolve({ document: 'Note' });
  expect(result).toMatchObject({ status: 'resolved', path: 'z/Note.md' });
  expect(JSON.stringify(result)).not.toContain('Secret');
});
test('source drift or revoked access during the last source read rejects the old action', async () => {
  await note('Note.md', '# Head\nvalue');
  let allowed = true;
  const original = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => { const value = await original(...args); allowed = false; return value; });
  await expect(new NoteLinkService(fs, () => allowed).resolve({ document: 'Note#Head' })).rejects.toThrow(/changed|unavailable/i);
});
test('a hidden candidate becoming visible during resolution invalidates single-target certainty', async () => {
  await note('a/Note.md', '---\nmoderation_status: hidden\n---\nHidden'); await note('z/Note.md', '# Visible');
  const read = fs.readNoteMetadata.bind(fs);
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    const value = await read(...args);
    if (args[0][0] === 'z/Note.md') await fs.writeNote({ path: 'a/Note.md', content: '# Now visible' });
    return value;
  });
  await expect(new NoteLinkService(fs).resolve({ document: 'Note' })).rejects.toThrow(/changed|unavailable/i);
});
