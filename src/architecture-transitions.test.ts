import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

let root: string, base: string, service: LlmWikiService;
const prefix = 'mcpvault-architecture-transitions-';
beforeEach(async () => {
  base = await realpath(tmpdir()); root = await mkdtemp(join(base, prefix));
  await mkdir(join(root, 'Knowledge'));
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => {
  const target = await realpath(root), rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});
const note = (lifecycle: string, extra = '') => `---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: ${lifecycle}\nknowledge_status: verified\n${extra}\n---\n# Decision\nOriginal 조건 and dissent remain.\n`;
async function seed(lifecycle: string, extra = '') {
  await writeFile(join(root, 'Knowledge/A.md'), note(lifecycle, extra));
  await writeFile(join(root, 'Knowledge/B.md'), note('evergreen'));
}

test.each([
  ['archive', 'active', false, 'archived'],
  ['supersede', 'evergreen', true, 'superseded'],
  ['tombstone', 'active', false, 'archived'],
  ['tombstone', 'evergreen', true, 'superseded'],
  ['reactivate', 'archived', false, 'review'],
])('architecture lifecycle example %s from %s is a revision-pinned preview, not a write', async (operation, initial, replacement, target) => {
  await seed(initial as string);
  const before = await readFile(join(root, 'Knowledge/A.md'), 'utf8');
  const r = await service.lifecycleTransitionPreview(undefined, { path: 'Knowledge/A.md', operation, reason: 'Explicit fixture review', ...(replacement && { replacementPath: 'Knowledge/B.md' }) });
  expect(r.valid).toBe(true);
  expect(r.changes[0]).toMatchObject({ path: 'Knowledge/A.md', expectedRevision: expect.stringMatching(/^[a-f0-9]{64}$/), frontmatter: { set: expect.objectContaining({ lifecycle: target }) } });
  expect(r.nextAction).toMatchObject({ endpointId: 'notes.change_set' });
  expect(await readFile(join(root, 'Knowledge/A.md'), 'utf8')).toBe(before);
});
test.each(['legal_hold: true', 'preserve_until: 2999-01-01'])('architecture retirement guard rejects %s without changing bytes', async extra => {
  await seed('evergreen', extra);
  const before = await readFile(join(root, 'Knowledge/A.md'), 'utf8');
  const r = await service.lifecycleTransitionPreview(undefined, { path: 'Knowledge/A.md', operation: 'archive', reason: 'Fixture' });
  expect(r).toMatchObject({ valid: false, changes: [] });
  expect(r.blockers.length).toBeGreaterThan(0);
  expect(await readFile(join(root, 'Knowledge/A.md'), 'utf8')).toBe(before);
});
test('architecture reactivation cannot infer epistemic state or accept a retirement target', async () => {
  await seed('superseded');
  await writeFile(join(root, 'Knowledge/A.md'), note('superseded').replace('knowledge_status: verified', 'knowledge_status: superseded'));
  const r = await service.lifecycleTransitionPreview(undefined, { path: 'Knowledge/A.md', operation: 'reactivate', reason: 'Fixture' });
  expect(r).toMatchObject({ valid: false, changes: [] });
  expect(JSON.stringify(r.blockers)).toContain('nextKnowledgeStatus');
  const rejected = await service.lifecycleTransitionPreview(undefined, { path: 'Knowledge/A.md', operation: 'reactivate', reason: 'Fixture', nextKnowledgeStatus: 'draft', targetLifecycle: 'archived' });
  expect(rejected).toMatchObject({ valid: false, changes: [] });
});
