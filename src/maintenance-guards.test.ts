import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';

let vault: string, fs: FileSystemService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'maintenance-guards-')); fs = new FileSystemService(vault);
  await writeFile(join(vault, 'New.md'), '# Target\nCurrent contents.');
  await writeFile(join(vault, 'Ref.md'), '[[Old.md]]');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function input() {
  const changes = [{ path: 'Ref.md', expectedRevision: (await fs.readNote('Ref.md')).revision,
    patches: [{ oldString: '[[Old.md]]', newString: '[[./New.md]]' }] }];
  const guards = [{ path: 'Old.md', expectedRevision: 'missing' }, { path: 'New.md', expectedRevision: (await fs.readNote('New.md')).revision }];
  return { changes, guards };
}

test('trusted guards are included in the same change-set preview and apply fingerprint', async () => {
  const { changes, guards } = await input();
  const preview = await fs.patchMultipleNotes({ changes, dryRun: true }, p => p, { guards });
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe('[[Old.md]]');
  const result = await fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, p => p, { guards });
  expect(result.applied).toBe(true);
  expect((await fs.readNote('Ref.md')).revision).toBe(result.changes[0].revision);
});

test('the same patch cannot replay a fingerprint with different trusted related guards', async () => {
  const { changes, guards } = await input();
  const original = await fs.patchMultipleNotes({ changes }, p => p, { guards });
  const altered = [{ path: 'OtherOld.md', expectedRevision: 'missing' }, guards[1]!];
  const second = await fs.patchMultipleNotes({ changes }, p => p, { guards: altered });
  expect(second.planFingerprint).not.toBe(original.planFingerprint);
  await expect(fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: original.planFingerprint }, p => p, { guards: altered })).rejects.toThrow(/confirmation/);
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe('[[Old.md]]');
});

test.each(['destination', 'reused-old', 'reference'])('change-set guards reject %s drift after preview', async kind => {
  const { changes, guards } = await input();
  const preview = await fs.patchMultipleNotes({ changes }, p => p, { guards });
  const path = kind === 'destination' ? 'New.md' : kind === 'reused-old' ? 'Old.md' : 'Ref.md';
  await writeFile(join(vault, path), '# User edit\nPreserve this.');
  const before = await readFile(join(vault, 'Ref.md'), 'utf8');
  await expect(fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, p => p, { guards })).rejects.toThrow();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(before);
});

test('revocation and a racing edit during async admission cannot truncate the reference', async () => {
  const { changes, guards } = await input();
  const preview = await fs.patchMultipleNotes({ changes }, p => p, { guards });
  let changed = false;
  const assertAccess = async () => {
    if (!changed) { changed = true; await writeFile(join(vault, 'Ref.md'), '# Racing user edit'); }
  };
  await expect(fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, p => p, { guards, assertAccess })).rejects.toThrow();
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe('# Racing user edit');
});

test('unsafe and duplicate guard paths are rejected before mutation', async () => {
  const { changes, guards } = await input();
  for (const bad of [[{ path: '../outside.md', expectedRevision: 'missing' }], [guards[1], guards[1]], [{ path: 'Ref.md', expectedRevision: changes[0].expectedRevision }]]) {
    await expect(fs.patchMultipleNotes({ changes }, p => p, { guards: bad })).rejects.toThrow();
  }
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe('[[Old.md]]');
});

test.each(['reference', 'destination', 'revocation'])('async physical preparation cannot bypass the final %s guard', async kind => {
  const { changes, guards } = await input();
  const preview = await fs.patchMultipleNotes({ changes }, p => p, { guards });
  let revoked = false, prepared = false;
  await expect(withEnterpriseStorageContext({ access: new ScopeAccessPolicy(), assertFresh: () => {},
    beforeWrite: async () => {
      if (prepared) return; prepared = true;
      if (kind === 'revocation') revoked = true;
      else await writeFile(join(vault, kind === 'reference' ? 'Ref.md' : 'New.md'), '# Late user edit');
    },
  }, () => fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, p => p,
    { guards, assertAccess: async () => { if (revoked) throw new Error('Revoked'); } }))).rejects.toThrow();
  expect(prepared).toBe(true);
  expect(await readFile(join(vault, 'Ref.md'), 'utf8')).toBe(kind === 'reference' ? '# Late user edit' : '[[Old.md]]');
});
