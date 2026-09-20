import { expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from '../filesystem.js';

test('single-note guarded changes require an access fence even without related-file guards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'curation-guard-'));
  try {
    const fs = new FileSystemService(root); await fs.writeNote({ path: 'A.md', content: '# Before' });
    const expectedRevision = await fs.readNoteRevision('A.md');
    const changes = [{ path: 'A.md', expectedRevision, patches: [{ oldString: '# Before', newString: '# After' }] }];
    await expect(fs.patchMultipleNotes({ changes, dryRun: true }, undefined, { guards: [] })).rejects.toThrow();
    let allowed = true, checks = 0;
    const policy = { guards: [], assertAccess: async () => { checks++; if (!allowed) throw Error('revoked'); } };
    const plan = await fs.patchMultipleNotes({ changes, dryRun: true }, undefined, policy);
    allowed = false;
    await expect(fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: plan.planFingerprint }, undefined, policy)).rejects.toThrow();
    expect(await fs.readNoteRevision('A.md')).toBe(expectedRevision); expect(checks).toBeGreaterThan(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bounded reference inspection stops discovery before reading a too-large vault', async () => {
  const root = await mkdtemp(join(tmpdir(), 'curation-bounded-'));
  try {
    const fs = new FileSystemService(root);
    for (const path of ['A.md', 'B.md', 'C.md']) await fs.writeNote({ path, content: '# Knowledge' });
    const body = vi.spyOn((fs as any).vaultIo, 'readUtf8Bounded');
    await expect(fs.previewDeleteNote({ path: 'A.md' }, () => true,
      { maxFiles: 2, maxTotalBytes: 2048, maxFileBytes: 1024 })).rejects.toThrow();
    expect(body).not.toHaveBeenCalled();
    body.mockRestore();
    expect(await fs.previewDeleteNote({ path: 'A.md' }, () => true,
      { maxFiles: 3, maxTotalBytes: 2048, maxFileBytes: 1024 })).toMatchObject({ exists: true, total: 0 });
  } finally { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); }
});
