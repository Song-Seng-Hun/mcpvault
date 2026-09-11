import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { ContinuityService } from './continuity.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'learning-config-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy(), wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const service = new ContinuityService(fs, { access, buildLearningPath: (p, path, depth, limit, chars) => wiki.learningPath(p, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await fs.writeNote({ path: 'Course.md', content: '# Course\n[[A]]\n[[B]]', frontmatter: { note_kind: 'moc' }, expectedRevision: 'missing' });
  for (const path of ['A.md', 'B.md']) await fs.writeNote({ path, content: '# Original', expectedRevision: 'missing' });
  const configuration = { id: 'course', version: '1.0.0', nodes: [{ id: 'base', requires: [], excludes: [], cost: 1 }, { id: 'next', requires: ['base'], excludes: [], cost: 2 }], selected: ['base', 'next'] };
  const mappings = [{ nodeId: 'base', path: 'A.md' }, { nodeId: 'next', path: 'B.md' }];
  const args = { principal, rootPath: 'Course.md', configuration, mappings, maxChars: 6000 };
  return { fs, service, principal, args };
}
test('preview maps selected nodes to current MOC revisions and saves only through existing Continuity', async () => {
  const { fs, service, principal, args } = await fixture();
  const preview = await service.previewLearningConfiguration(args);
  expect(preview).toMatchObject({ executable: false, permissionsGranted: false, competencyCertified: false, mappings: [{ nodeId: 'base', path: 'A.md', revision: expect.any(String) }, { nodeId: 'next', path: 'B.md', revision: expect.any(String) }] });
  expect(await fs.noteExists('_scopes/agents/worker/_continuity/work-state.md')).toBe(false);
  const learningProgress = preview.checkpointAction.learningProgress;
  const saved = await service.save({ principal, topic: 'Course', summary: 'Read first original', nextAction: 'Read second', learningProgress: { ...learningProgress, completedThrough: 'A.md' } });
  expect(saved.learningProgress.configuration).toMatchObject({ fingerprint: preview.fingerprint, mappedNodes: 2 });
  const current = await service.read({ principal });
  expect(current.learningProgress).toMatchObject({ state: 'ready', canResume: true, configuration: { fingerprint: preview.fingerprint } });
  const a = await fs.readNote('A.md'); await fs.writeNote({ path: 'A.md', content: 'Changed source', expectedRevision: a.revision });
  expect((await service.read({ principal })).learningProgress).toMatchObject({ state: 'stale', canResume: false });
  await expect(service.save({ principal, topic: 'Course', summary: 'Old mapping', nextAction: 'Continue', learningProgress })).rejects.toThrow(/changed|fingerprint/i);
});
test('incomplete, reversed, hidden and unknown mappings never create a checkpoint', async () => {
  const { fs, service, args } = await fixture();
  for (const mappings of [[args.mappings[0]], [{ nodeId: 'base', path: 'B.md' }, { nodeId: 'next', path: 'A.md' }], [{ nodeId: 'base', path: 'A.md' }, { nodeId: 'unknown', path: 'B.md' }], [{ nodeId: 'base', path: 'A.md' }, { nodeId: 'next', path: '_scopes/agents/other/Private.md' }]]) {
    await expect(service.previewLearningConfiguration({ ...args, mappings })).rejects.toThrow();
  }
  expect(await fs.noteExists('_scopes/agents/worker/_continuity/work-state.md')).toBe(false);
});
