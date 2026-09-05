import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
let vault: string;
let fs: FileSystemService;
let notified: string[];
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-response-preflight-'));
  notified = [];
  fs = new FileSystemService(vault, undefined, undefined, path => { notified.push(path); });
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function fixture(longPaths: boolean | number) {
  return Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const path = `${index}-${'n'.repeat(typeof longPaths === 'number' ? longPaths : longPaths ? 170 : 1)}.md`;
    await writeFile(join(vault, path), 'Original\n');
    return { path, expectedRevision: (await fs.readNote(path)).revision!, patches: [{ oldString: 'Original', newString: 'Changed' }] };
  }));
}
test('an impossible apply response is rejected before any file or index mutation', async () => {
  const changes = await fixture(true);
  const preview = await fs.patchMultipleNotes({ changes, maxChars: 20000 });
  await expect(fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint, maxChars: 4096 }))
    .rejects.toThrow(/maxChars is too small/);
  for (const change of changes) expect(await readFile(join(vault, change.path), 'utf8')).toBe('Original\n');
  expect(notified).toEqual([]);
  const retry = await fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint, maxChars: 20000 });
  expect(retry.applied).toBe(true);
  expect(JSON.stringify(retry).length).toBeLessThanOrEqual(20000);
  for (const change of changes) expect((await fs.readNote(change.path)).content).toBe('Changed\n');
  expect(notified).toHaveLength(10);
});
test('optional previews can be omitted while preserving every applied path and revision', async () => {
  const changes = await fixture(false);
  const preview = await fs.patchMultipleNotes({ changes, maxChars: 20000 });
  const applied = await fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint, maxChars: 4096 });
  expect(applied.applied).toBe(true);
  expect(applied.truncated).toBe(true);
  expect(JSON.stringify(applied).length).toBeLessThanOrEqual(4096);
  expect(applied.changes).toHaveLength(10);
  for (const item of applied.changes) {
    expect(item.preview).toBeUndefined();
    expect(item.revision).toBe((await fs.readNote(item.path)).revision);
  }
});

test('pretty JSON is admitted before writing, not just its compact encoding', async () => {
  const changes = await fixture(50);
  const preview = await fs.patchMultipleNotes({ changes, maxChars: 20000 });
  const args = { changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint, maxChars: 4096, prettyPrint: true };
  await expect(fs.patchMultipleNotes(args)).rejects.toThrow(/maxChars is too small/);
  for (const change of changes) expect(await readFile(join(vault, change.path), 'utf8')).toBe('Original\n');
  expect(notified).toEqual([]);
});

test('public path projection is included in pre-write response admission', async () => {
  const changes = await fixture(false);
  const preview = await fs.patchMultipleNotes({ changes, maxChars: 20000 });
  await expect(fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint, maxChars: 4096 },
    path => `scope://agent/${'a'.repeat(200)}/${path}`))
    .rejects.toThrow(/maxChars is too small/);
  for (const change of changes) expect(await readFile(join(vault, change.path), 'utf8')).toBe('Original\n');
  expect(notified).toEqual([]);
});
