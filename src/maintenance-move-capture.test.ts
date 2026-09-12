import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FileSystemService } from './filesystem.js';
let vault: string, fs: FileSystemService;
const note = '# Topic\nDetails. ^proof\n';
async function seed(path: string, body: string) {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), '---\nllm_wiki_type: knowledge\n---\n' + body);
}
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'maintenance-capture-')); fs = new FileSystemService(vault);
  await seed('Old.md', note); await seed('Ref.md', '[[Old.md#^proof|label]]\n```md\n[[Old.md]]\n```');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function params() { return { oldPath: 'Old.md', newPath: 'New.md', expectedRevision: (await fs.readNote('Old.md')).revision }; }

test('capture records existing planner interpretations and exact bytes before the move', async () => {
  let captured: any;
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  const result = await fs.moveNoteWithRecovery(await params(), () => true, async capture => {
    expect(await fs.noteExists('Old.md')).toBe(true);
    expect(await fs.noteExists('New.md')).toBe(false);
    captured = capture;
  });
  expect(result.success).toBe(true);
  expect(captured.sourceRevision).toBe((await fs.readNote('New.md')).revision);
  expect(captured.references).toHaveLength(1);
  expect(captured.references[0].before).toBe(before);
  expect(captured.references[0].after).toContain('[[./New.md#^proof|label]]');
  expect(captured.references[0].after).toContain('```md\n[[Old.md]]\n```');
  expect(captured.references[0].links[0]).toMatchObject({ link: '[[Old.md#^proof|label]]', direction: 'inbound' });
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test.each(['hidden', 'ambiguous', 'protected', 'oversize'])('incomplete %s reference capture grants no recovery history', async kind => {
  if (kind === 'ambiguous') await seed('Other/Old.md', note);
  if (kind === 'protected') await writeFile(join(vault, 'Ref.md'), '---\nllm_wiki_type: source\n---\n[[Old.md]]');
  if (kind === 'oversize') await seed('Ref.md', 'x'.repeat(256 * 1024) + '\n[[Old.md]]');
  const record = vi.fn();
  const result = await fs.moveNoteWithRecovery(await params(), path => kind !== 'hidden' || path !== 'Ref.md', record);
  expect(result.success).toBe(true); expect(record).not.toHaveBeenCalled();
});

test('occupied destination never becomes a successful capture', async () => {
  await seed('New.md', '# Existing'); const record = vi.fn();
  expect((await fs.moveNoteWithRecovery(await params(), () => true, record)).success).toBe(false);
  expect(record).not.toHaveBeenCalled();
});

test('revision drift during private intent persistence stops the guarded move', async () => {
  const result = await fs.moveNoteWithRecovery(await params(), () => true, async () => { await seed('Old.md', '# New user text'); });
  expect(result.success).toBe(false);
  expect(await fs.noteExists('New.md')).toBe(false);
  expect(await readFile(join(vault, 'Old.md'), 'utf8')).toContain('New user text');
});

test('host storage failure leaves ordinary move behavior without authorizing repairs', async () => {
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  expect((await fs.moveNoteWithRecovery(await params(), () => true, async () => { throw new Error('Host unavailable'); })).success).toBe(true);
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});
