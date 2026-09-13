import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ContinuityService } from './continuity.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-revalidation-')); vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const service = new ContinuityService(fs, { access, buildLearningPath: (p, path, depth, limit, chars) => wiki.learningPath(p, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await fs.writeNote({ path: 'MOC.md', content: '[[A]]\n[[B]]', frontmatter: { note_kind: 'moc' } });
  for (const path of ['A.md', 'B.md']) await fs.writeNote({ path, content: '# Entry', frontmatter: { note_kind: 'atomic' } });
  const saved = await service.save({ principal, topic: 'Learn', summary: 'A reviewed', nextAction: 'B next', learningProgress: { rootPath: 'MOC.md', completedThrough: 'A.md' } });
  return { fs, service, principal, saved };
}

test('revision drift provides only affected revision-pinned reads while preserving progress and stale status', async () => {
  const { fs, service, principal, saved } = await fixture();
  await fs.writeNote({ path: 'A.md', content: '# Changed condition' });
  const result = await service.read({ principal, maxChars: 12000 });
  expect(result.revision).toBe(saved.revision);
  expect(result.learningProgress).toMatchObject({ state: 'stale', canResume: false, completedThrough: 'A.md',
    revalidation: { state: 'review_required', understandingVerified: false, changedReadsTotal: 1,
      reads: [{ endpointId: 'mcp.read_note_lines', arguments: { path: 'A.md', expectedRevision: await fs.readNoteRevision('A.md') } }],
      checkpoint: { endpointId: 'continuity.save', requiredArguments: ['topic', 'summary', 'nextAction', 'expectedRevision', 'learningProgress'] } } });
  expect(result.route).toBeUndefined();
  expect(JSON.stringify(result.learningProgress.revalidation.reads)).not.toContain('B.md');
});

test('structural changes require route review and never produce automatic acceptance', async () => {
  const { fs, service, principal } = await fixture();
  await fs.writeNote({ path: 'MOC.md', content: '[[B]]\n[[A]]', frontmatter: { note_kind: 'moc' } });
  const result = await service.read({ principal, maxChars: 12000 });
  expect(result.learningProgress.revalidation).toMatchObject({ pathReviewRequired: true, state: 'review_required', understandingVerified: false });
  expect(result.learningProgress.canResume).toBe(false);
});

test('bounded output omits whole recovery details rather than claiming checked progress', async () => {
  const { fs, service, principal } = await fixture();
  await fs.writeNote({ path: 'A.md', content: '# Changed' });
  const result = await service.read({ principal, maxChars: 512, prettyPrint: true });
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(512);
  expect(result.learningProgress.canResume).toBe(false);
  expect(result.route).toBeUndefined();
});

test('unavailable path or unchecked progress never exposes actionable revalidation receipts', async () => {
  const { fs, service, principal } = await fixture();
  await fs.writeNote({ path: 'A.md', content: '# Secret', frontmatter: { moderation_status: 'hidden' } });
  for (const validateLearningProgress of [false, true]) {
    const result = await service.read({ principal, validateLearningProgress, maxChars: 12000 });
    expect(result.learningProgress.canResume).toBe(false);
    expect(result.learningProgress.revalidation).toBeUndefined();
    expect(result.route).toBeUndefined();
  }
});
