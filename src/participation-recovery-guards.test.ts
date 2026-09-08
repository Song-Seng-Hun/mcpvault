import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
let root: string, fs: FileSystemService;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'participation-guards-')); fs = new FileSystemService(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
test('missing related-note guard allows only confirmed absence and rejects present targets', async () => {
  await fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'State.md', content: 'absent confirmed', expectedRevision: 'missing' }, [{ path: 'Result.md', expectedRevision: 'missing' }]);
  const state = await fs.readNote('State.md');
  await fs.writeNote({ path: 'Result.md', content: 'published', expectedRevision: 'missing' });
  await expect(fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'State.md', content: 'incorrectly absent', expectedRevision: state.revision }, [{ path: 'Result.md', expectedRevision: 'missing' }])).rejects.toThrow(/revision/i);
  expect((await fs.readNote('State.md')).content).toBe('absent confirmed');
});
test('recovery and delayed public write have one winner under reciprocal revision guards', async () => {
  await fs.writeNote({ path: 'State.md', content: 'reserved', expectedRevision: 'missing' }); const state = await fs.readNote('State.md');
  const results = await Promise.allSettled([
    fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'State.md', content: 'recovered', expectedRevision: state.revision }, [{ path: 'Result.md', expectedRevision: 'missing' }]),
    new FileSystemService(root).writeNoteWithRevisionGuardsAndReceipt({ path: 'Result.md', content: 'published', expectedRevision: 'missing' }, [{ path: 'State.md', expectedRevision: state.revision }]),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  if (await fs.noteExists('Result.md')) expect((await fs.readNote('State.md')).content).toBe('reserved');
  else expect((await fs.readNote('State.md')).content).toBe('recovered');
});
test('missing guards retain PathFilter traversal and invalid revision rejection', async () => {
  await expect(fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'State.md', content: 'x', expectedRevision: 'missing' }, [{ path: '../outside.md', expectedRevision: 'missing' }])).rejects.toThrow();
  await expect(fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'State.md', content: 'x', expectedRevision: 'missing' }, [{ path: 'Result.md', expectedRevision: 'latest' }])).rejects.toThrow();
});
