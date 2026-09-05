import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
let vault: string;
let fs: FileSystemService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-lock-identity-'));
  fs = new FileSystemService(vault);
  await writeFile(join(vault, 'Note.md'), '---\ntags: [base]\n---\nBody\n');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
test.each(['./Note.md', 'dir/../Note.md', 'absolute'])(
  'equivalent path %s queues behind the same note mutation', async alias => {
    let entered!: () => void;
    const firstEntered = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const read = fs.readNote.bind(fs);
    let reads = 0;
    const spy = vi.spyOn(fs, 'readNote').mockImplementation(async path => {
      const note = await read(path);
      if (++reads === 1) { entered(); await gate; }
      return note;
    });
    const first = fs.manageTags({ path: 'Note.md', operation: 'add', tags: ['first'] });
    await firstEntered;
    const otherPath = alias === 'absolute' ? join(vault, '.', 'Note.md') : alias;
    const second = fs.manageTags({ path: otherPath, operation: 'add', tags: ['second'] });
    let beforeRelease: number;
    try {
      // Lock acquisition precedes readNote; flush queued promise continuations,
      // not filesystem timing, to observe whether the second operation entered.
      for (let i = 0; i < 10; i++) await Promise.resolve();
      beforeRelease = spy.mock.calls.length;
    } finally { release(); }
    const results = await Promise.all([first, second]);
    expect(beforeRelease!).toBe(1);
    expect(results.every(r => r.success)).toBe(true);
    expect((await read('Note.md')).frontmatter.tags).toEqual(['base', 'first', 'second']);
  },
);
test('equivalent related guards do not reacquire the same mutation lock', async () => {
  const revision = (await fs.readNote('Note.md')).revision!;
  await fs.writeNoteWithRevisionGuards({ path: 'Note.md', content: 'Updated\n', expectedRevision: revision }, [
    { path: './Note.md', expectedRevision: revision },
    { path: 'dir/../Note.md', expectedRevision: revision },
  ]);
  expect((await fs.readNote('Note.md')).content).toBe('Updated\n');
}, 2000);
test('failed alias mutation releases the lock for a subsequent valid edit', async () => {
  const failed = await fs.manageTags({ path: './Note.md', operation: 'add', tags: ['bad'], expectedRevision: '0'.repeat(64) });
  expect(failed.success).toBe(false);
  const next = await fs.manageTags({ path: 'Note.md', operation: 'add', tags: ['good'] });
  expect(next.success).toBe(true);
  expect((await fs.readNote('Note.md')).frontmatter.tags).toEqual(['base', 'good']);
}, 2000);

test('overlapping guarded writes with different aliases finish without reversed-order deadlock', async () => {
  await writeFile(join(vault, 'Other.md'), 'Other\n');
  const firstRevision = (await fs.readNote('Note.md')).revision!;
  const otherRevision = (await fs.readNote('Other.md')).revision!;
  const outcomes = await Promise.allSettled([
    fs.writeNoteWithRevisionGuards({ path: 'Note.md', content: 'First\n', expectedRevision: firstRevision }, [
      { path: './Other.md', expectedRevision: otherRevision },
    ]),
    fs.writeNoteWithRevisionGuards({ path: 'Other.md', content: 'Second\n', expectedRevision: otherRevision }, [
      { path: './Note.md', expectedRevision: firstRevision },
    ]),
  ]);
  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(String((outcomes.find(r => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/Revision conflict/);
}, 2000);

test('case-folded lock identity does not rewrite the actual target spelling', async () => {
  const result = await fs.manageTags({ path: './Note.md', operation: 'add', tags: ['new'] });
  expect(result.success).toBe(true);
  expect(result.path).toBe('./Note.md');
  expect((await fs.readNote('Note.md')).frontmatter.tags).toEqual(['base', 'new']);
});
