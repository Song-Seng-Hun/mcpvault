import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
let vault: string;
let fs: FileSystemService;
let notified: string[];
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-rollback-owner-'));
  notified = [];
  fs = new FileSystemService(vault, undefined, undefined, path => { notified.push(path); });
  await writeFile(join(vault, 'A.md'), 'Alpha\n');
  await writeFile(join(vault, 'B.md'), 'Beta\n');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function plan() {
  const changes = await Promise.all(['A.md', 'B.md'].map(async path => ({
    path, expectedRevision: (await fs.readNote(path)).revision!, frontmatter: { set: { reviewed: true } },
  })));
  const preview = await fs.patchMultipleNotes({ changes });
  return { changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint };
}
function atSecondDestination(action: () => void, fail: boolean) {
  const service = fs as any;
  const resolve = service.resolveWritablePath.bind(fs);
  let invoked = false;
  vi.spyOn(service, 'resolveWritablePath').mockImplementation((path: unknown) => {
    if (path === 'B.md' && !invoked) {
      invoked = true;
      action();
      if (fail) return join(vault, 'missing-parent', 'B.md');
    }
    return resolve(path);
  });
}
test('rollback preserves an external edit of an earlier written note', async () => {
  const args = await plan();
  atSecondDestination(() => writeFileSync(join(vault, 'A.md'), 'External Alpha\n'), true);
  await expect(fs.patchMultipleNotes(args)).rejects.toThrow(/Rollback was incomplete/);
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('External Alpha\n');
  expect(await readFile(join(vault, 'B.md'), 'utf8')).toBe('Beta\n');
  expect(notified).toContain('A.md');
});
test('rollback does not recreate a note deleted by an external writer', async () => {
  const args = await plan();
  atSecondDestination(() => unlinkSync(join(vault, 'A.md')), true);
  await expect(fs.patchMultipleNotes(args)).rejects.toThrow(/Rollback was incomplete/);
  await expect(access(join(vault, 'A.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(notified).toContain('A.md');
});
test('an external edit after batch preflight survives the next individual write', async () => {
  const args = await plan();
  atSecondDestination(() => writeFileSync(join(vault, 'B.md'), 'External Beta\n'), false);
  await expect(fs.patchMultipleNotes(args)).rejects.toThrow(/Revision conflict/);
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('Alpha\n');
  expect(await readFile(join(vault, 'B.md'), 'utf8')).toBe('External Beta\n');
  expect(notified).toContain('B.md');
});

test('a missing next target is not recreated and invalidates its read model', async () => {
  const args = await plan();
  atSecondDestination(() => unlinkSync(join(vault, 'B.md')), false);
  await expect(fs.patchMultipleNotes(args)).rejects.toThrow(/Change-set write failed/);
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('Alpha\n');
  await expect(access(join(vault, 'B.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(notified).toContain('B.md');
});

test('already restored content is accepted and a fresh change set can run after failure', async () => {
  const args = await plan();
  atSecondDestination(() => writeFileSync(join(vault, 'A.md'), 'Alpha\n'), true);
  await expect(fs.patchMultipleNotes(args)).rejects.toThrow(/All attempted writes were restored/);
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('Alpha\n');
  expect(await readFile(join(vault, 'B.md'), 'utf8')).toBe('Beta\n');
  vi.restoreAllMocks();
  const result = await fs.patchMultipleNotes(await plan());
  expect(result.applied).toBe(true);
  for (const receipt of result.changes) {
    expect((await fs.readNote(receipt.path)).revision).toBe(receipt.revision);
  }
});
