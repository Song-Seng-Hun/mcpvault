import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { buildGraphAssertionPacket } from './graph-assertion-packet.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'curation-contrast-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  for (const path of ['Central.md', 'Distributed.md']) await fs.writeNote({ path, content: '# Policy\nKeep exceptions. ^condition',
    frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic' } });
  const plan = () => wiki.reciprocalLinkPreview(undefined, { leftPath: 'Central.md', rightPath: 'Distributed.md', relation: 'contrasts_with' });
  return { fs, wiki, access, plan };
}

test('contrast preview, guarded apply, reread and graph projection preserve bodies and both directions', async () => {
  const { fs, plan, access } = await fixture();
  const before = await fs.readNote('Central.md');
  const p = await plan(); expect(p.valid).toBe(true); expect(p.changes).toHaveLength(2);
  const preview = await fs.patchMultipleNotes({ changes: p.changes, dryRun: true });
  await fs.patchMultipleNotes({ changes: p.changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint });
  const after = await fs.readNote('Central.md'); expect(after.content).toBe(before.content);
  expect(after.frontmatter.contradicts).toBeUndefined();
  expect(after.frontmatter.contrasts_with).toEqual(['[[Distributed]]']);
  expect((await plan()).alreadyReciprocal).toBe(true);
  const packet = await buildGraphAssertionPacket(fs, access, undefined, { path: 'Central.md', maxChars: 12000 });
  expect(packet.assertions).toEqual(expect.arrayContaining([expect.objectContaining({ relation: 'contrasts_with',
    source: expect.objectContaining({ revision: after.revision }), target: expect.objectContaining({ path: 'Distributed.md' }) })]));
});

test('contrast apply never overwrites an intervening user edit', async () => {
  const { fs, plan } = await fixture(); const p = await plan();
  const preview = await fs.patchMultipleNotes({ changes: p.changes, dryRun: true });
  await fs.writeNote({ path: 'Distributed.md', content: '# Manual edit\nDo not lose this.' });
  await expect(fs.patchMultipleNotes({ changes: p.changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint })).rejects.toThrow(/revision|fingerprint/i);
  expect((await fs.readNote('Distributed.md')).content).toContain('Do not lose this.');
  expect((await fs.readNote('Central.md')).frontmatter.contrasts_with).toBeUndefined();
});

test('a contrast cannot link a public note to a private scope even when the caller owns both', async () => {
  const { fs, wiki } = await fixture();
  await fs.writeNote({ path: '_scopes/agents/worker/Private.md', content: '# Private' });
  const p = await wiki.reciprocalLinkPreview({ modelId: 'codex', agentId: 'worker' }, {
    leftPath: 'Central.md', rightPath: '_scopes/agents/worker/Private.md', relation: 'contrasts_with' });
  expect(p.valid).toBe(false); expect(p.changes).toEqual([]);
});

test('contrast and near-match plain paths appear in deletion impact, without performing deletion', async () => {
  const { fs } = await fixture();
  await fs.writeNote({ path: 'Central.md', content: '# Policy', frontmatter: { contrasts_with: ['Distributed.md'], close_match: ['Distributed.md'] } });
  const preview = await fs.previewDeleteNote({ path: 'Distributed.md' });
  expect(JSON.stringify(preview)).toContain('Central.md');
  expect((await fs.readNote('Distributed.md')).content).toContain('Keep exceptions.');
});
