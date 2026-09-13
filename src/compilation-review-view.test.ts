import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { attachCompilationReview } from './compilation-review-view.js';

let vault: string, fs: FileSystemService, access: ScopeAccessPolicy;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'compilation-view-')); fs = new FileSystemService(vault);
  access = new ScopeAccessPolicy(); await writeFile(join(vault, 'Source.md'), '# Source\nOnly safe retries.'); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function fixture(maxChars = 4000) {
  const revision = await fs.readNoteRevision('Source.md');
  const finding = { path: 'Source.md', revision, code: 'compilation_evidence_missing', basis: 'a'.repeat(64), attribution: 'agent_report' as const,
    nextAction: { endpointId: 'wiki.compilation' as const, arguments: { op: 'read' as const, requestId: 'job',
      expectedJobRevision: 'a'.repeat(64), includeInspection: true as const, maxChars: 4000 } } };
  return { fs, access, maxChars, result: { status: 'ready', sources: [{ path: 'Source.md', revision, passages: [{ text: 'Only safe retries.' }] }] },
    review: async (_paths?: readonly string[]) => [finding], revalidateActor: async () => {},
    retry: { endpointId: 'wiki.answer_packet', arguments: { query: 'retry', maxChars: 12000 } } };
}
test('existing packet includes scoped compilation warnings without interpreting them as truth', async () => {
  const options = await fixture(); let requested: readonly string[] | undefined;
  const result = await attachCompilationReview({ ...options, review: async paths => { requested = paths; return options.review(); } });
  expect(requested).toEqual(['Source.md']); expect(result.compilationReview[0]).toMatchObject({ path: 'Source.md', attribution: 'agent_report' });
  expect(result.status).toBe('partial'); expect(result.sources).toEqual(options.result.sources);
});
test('small budgets preserve a revision-pinned inspection action instead of silently dropping warnings', async () => {
  const result = await attachCompilationReview(await fixture(512));
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512); expect(result.status).toBe('partial');
  expect(result.nextAction.endpointId).toBe('wiki.compilation');
  expect(result.nextAction.arguments.expectedJobRevision).toBe('a'.repeat(64));
});
test('view revalidates original packet revisions and actor after reading host-private diagnostics', async () => {
  const options = await fixture();
  await expect(attachCompilationReview({ ...options, review: async () => {
    await writeFile(join(vault, 'Source.md'), '---\nmoderation_status: hidden\n---\nSecret.'); return options.review();
  } })).rejects.toThrow(/unavailable/);
  await expect(attachCompilationReview({ ...options, revalidateActor: async () => { throw Error('revoked'); } })).rejects.toThrow(/unavailable/);
});

test('inspection of a later packet row cannot hide a compilation-only dependency while retaining its warning', async () => {
  const options = await fixture(); await writeFile(join(vault, 'Dependency.md'), 'Supporting source.');
  const dependencyRevision = await fs.readNoteRevision('Dependency.md');
  const original = fs.readNoteMetadata.bind(fs); let changed = false;
  fs.readNoteMetadata = async (...args) => {
    const result = await original(...args);
    if (!changed && args[0].includes('Source.md')) { changed = true;
      await writeFile(join(vault, 'Dependency.md'), '---\nmoderation_status: hidden\n---\nNo longer available.'); }
    return result;
  };
  await expect(attachCompilationReview({ ...options, review: async () => (await options.review()).map(finding => ({ ...finding,
    affectedEvidence: [{ path: 'Dependency.md', revision: dependencyRevision }] })) })).rejects.toThrow(/unavailable/);
});
