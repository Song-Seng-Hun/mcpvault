import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { FrontmatterHandler } from './frontmatter.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-write-receipt-'));
  vaults.push(vault);
  let afterWrite: ((path: string) => void) | undefined;
  const fs = new FileSystemService(vault, undefined, undefined, (path, kind) => {
    if (kind === 'upsert') afterWrite?.(join(vault, path));
  });
  return { fs, vault, observe: (callback: (path: string) => void) => { afterWrite = callback; } };
}

test('issue resolution returns its own write revision, not a later external edit', async () => {
  const { fs, observe } = await fixture();
  const path = '_wiki/issues/example.md';
  await fs.writeNote({ path, content: '# Issue\n## Resolution\nOpen.',
    frontmatter: { llm_wiki_type: 'issue', status: 'open' } });
  const before = await fs.readNote(path);
  let written = '';
  // A real external-editor write at the post-write notification boundary.
  // No filesystem/service result is mocked; both versions exist on disk.
  observe(fullPath => {
    written = readFileSync(fullPath, 'utf8');
    writeFileSync(fullPath, written.replace('status: resolved', 'status: disputed') + '\nExternal follow-up.');
  });
  const access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const result = await wiki.resolveIssue({ path, actor: 'first-agent', resolution: 'Fixed.', expectedRevision: before.revision });
  const current = await fs.readNote(path);
  expect(written).toContain('Fixed.');
  expect(current.frontmatter.status).toBe('disputed');
  expect(result.status).toBe('resolved');
  expect(result.revision).toBe(hash(written));
  expect(result.revision).not.toBe(current.revision);
  await expect(fs.writeNote({ path, content: 'Must not overwrite follow-up.', expectedRevision: result.revision })).rejects.toThrow(/revision conflict/i);
});

test.each(['overwrite', 'append', 'prepend'] as const)('%s receipt hashes the serialized UTF-8 document', async mode => {
  const { fs } = await fixture();
  const path = 'Knowledge/example.md';
  await fs.writeNote({ path, content: '기존 본문\r\n', frontmatter: { title: 'Original', tags: ['a'] } });
  const before = await fs.readNote(path);
  const receipt = await fs.writeNoteWithReceipt({ path, content: '새 본문 🧭\n', mode,
    frontmatter: { title: 'Updated' }, expectedRevision: before.revision });
  const current = await fs.readNote(path);
  expect(receipt).toEqual({ revision: current.revision });
  expect(receipt.revision).toBe(hash(current.originalContent));
  expect(current.content).toContain('새 본문 🧭');
  expect(current.frontmatter.title).toBe('Updated');
});

test('receipt preserves legacy void writes and identifies raw body content exactly', async () => {
  const { fs } = await fixture();
  expect(await fs.writeNote({ path: 'legacy.md', content: 'legacy' })).toBeUndefined();
  const content = '\uFEFF# Raw\r\n\r\n본문\r\n';
  const receipt = await fs.writeNoteWithReceipt({ path: 'raw.md', content, expectedRevision: 'missing' });
  expect(receipt).toEqual({ revision: hash(content) });
  expect(receipt.revision).toBe(await fs.readNoteRevision('raw.md'));
});

test('receipt writes use the existing revision lock and only one competing edit wins', async () => {
  const { fs } = await fixture();
  await fs.writeNote({ path: 'race.md', content: 'initial' });
  const expectedRevision = await fs.readNoteRevision('race.md');
  const results = await Promise.allSettled(['first', 'second'].map(content => fs.writeNoteWithReceipt({ path: 'race.md', content, expectedRevision })));
  const winners = results.filter(result => result.status === 'fulfilled');
  expect(winners).toHaveLength(1);
  expect(winners[0]!.value.revision).toBe(await fs.readNoteRevision('race.md'));
  expect(results.find(result => result.status === 'rejected')!.reason.message).toMatch(/revision conflict/i);
});

test('receipt writes retain restricted-path and stale-revision rejection without notifications', async () => {
  const { fs, observe } = await fixture();
  await fs.writeNote({ path: 'safe.md', content: 'keep' });
  let events = 0;
  observe(() => { events++; });
  await expect(fs.writeNoteWithReceipt({ path: '.obsidian/config.json', content: 'bad' })).rejects.toThrow();
  await expect(fs.writeNoteWithReceipt({ path: 'safe.md', content: 'bad', expectedRevision: '0'.repeat(64) })).rejects.toThrow(/revision conflict/i);
  expect((await fs.readNote('safe.md')).content).toBe('keep');
  expect(events).toBe(0);
});

test.each(['publish', 'guarded publish', 'triage', 'review', 'claim review'] as const)('%s keeps its response tied to its own mutation', async action => {
  const { fs, observe } = await fixture();
  const path = 'Knowledge/example.md';
  const sourcePath = '_sources/test.md';
  await fs.writeNote({ path: sourcePath, content: 'Evidence.\n', frontmatter: {
    llm_wiki_type: 'source', immutable: true, content_sha256: hash('Evidence.\n'),
  } });
  await fs.writeNote({ path, content: '# Knowledge\nOriginal.', frontmatter: {
    llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'review',
    claims: [{ id: 'claim', text: 'A testable claim.', status: 'unverified', evidence_paths: [sourcePath] }],
  } });
  await fs.writeNote({ path: 'Knowledge/guard.md', content: 'Related state.' });
  const expectedRevision = await fs.readNoteRevision(path);
  const guard = { path: 'Knowledge/guard.md', expectedRevision: await fs.readNoteRevision('Knowledge/guard.md') };
  let written = '';
  observe(fullPath => {
    written = readFileSync(fullPath, 'utf8');
    writeFileSync(fullPath, written.replace('last_reviewed_by: reviewer', 'last_reviewed_by: someone-else')
      .replace('lifecycle: review', 'lifecycle: evergreen') + '\nExternal follow-up.');
  });
  const access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  let result;
  if (action === 'publish' || action === 'guarded publish') {
    result = await wiki.publishKnowledge({ path, content: '# Knowledge\nPublished.', evidencePaths: [sourcePath], author: 'writer', expectedRevision },
      action === 'guarded publish' ? { revisionGuards: [guard] } : {});
  } else if (action === 'triage') {
    result = await wiki.triage({ path, lifecycle: 'review', expectedRevision });
    expect(result.frontmatter.lifecycle).toBe('review');
  } else if (action === 'review') {
    result = await wiki.review({ path, reviewOutcome: 'confirmed', reviewedBy: 'reviewer', expectedRevision });
    expect(result.reviewedBy).toBe('reviewer');
    expect(result.followUpRequired).toBe(true);
  } else {
    result = await wiki.reviewClaim({ path, claimId: 'claim', status: 'supported', reviewedBy: 'reviewer', expectedRevision });
  }
  expect(written).not.toBe('');
  expect(result.revision).toBe(hash(written));
  expect(result.revision).not.toBe(await fs.readNoteRevision(path));
  await expect(fs.writeNote({ path, content: 'Unsafe overwrite.', expectedRevision: result.revision })).rejects.toThrow(/revision conflict/i);
});

test.each(['preserve', 'replace', 'no existing Properties'] as const)('Properties receipt captures %s serialization, including removals', async mode => {
  const { fs, observe } = await fixture();
  const path = 'Properties.md';
  await fs.writeNote({ path, content: '본문\n', ...(mode !== 'no existing Properties' && {
    frontmatter: { retained: 'yes', removed: 'old', nested: { flag: true } },
  }) });
  const expectedRevision = await fs.readNoteRevision(path);
  let written = '';
  observe(fullPath => {
    written = readFileSync(fullPath, 'utf8');
    writeFileSync(fullPath, '---\nexternal: true\n---\nExternal body.');
  });
  const receipt = await fs.updateFrontmatterWithReceipt({ path, frontmatter: { added: 'new', removed: undefined },
    merge: mode !== 'replace', expectedRevision });
  expect(receipt).toEqual({ revision: hash(written), frontmatter: new FrontmatterHandler().parse(written).frontmatter });
  expect(receipt.frontmatter.added).toBe('new');
  expect(receipt.frontmatter).not.toHaveProperty('removed');
  expect(receipt.frontmatter).not.toHaveProperty('external');
  expect(Object.keys(receipt).sort()).toEqual(['frontmatter', 'revision']);
});

test('Properties receipt failure preserves bytes and legacy updates still resolve void', async () => {
  const { fs, observe } = await fixture();
  const path = 'Properties.md';
  await fs.writeNote({ path, content: 'Keep body.', frontmatter: { title: 'Original' } });
  expect(await fs.updateFrontmatter({ path, frontmatter: { title: 'Updated' } })).toBeUndefined();
  const revision = await fs.readNoteRevision(path);
  let events = 0;
  observe(() => { events++; });
  await expect(fs.updateFrontmatterWithReceipt({ path, frontmatter: { title: 'Bad' }, expectedRevision: '0'.repeat(64) })).rejects.toThrow(/revision conflict/i);
  await expect(fs.updateFrontmatterWithReceipt({ path: '.obsidian/config.md', frontmatter: { title: 'Bad' } })).rejects.toThrow();
  expect(await fs.readNoteRevision(path)).toBe(revision);
  expect(events).toBe(0);
});

test('guarded receipt rejects stale related state before touching the target', async () => {
  const { fs, observe } = await fixture();
  await fs.writeNote({ path: 'target.md', content: 'Keep target.' });
  await fs.writeNote({ path: 'guard.md', content: 'Old guard.' });
  const expectedRevision = await fs.readNoteRevision('target.md');
  const guard = { path: 'guard.md', expectedRevision: await fs.readNoteRevision('guard.md') };
  await fs.writeNote({ path: guard.path, content: 'New guard.' });
  let events = 0;
  observe(() => { events++; });
  await expect(fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'target.md', content: 'Unsafe.', expectedRevision }, [guard])).rejects.toThrow(/revision conflict/i);
  expect(await fs.readNoteRevision('target.md')).toBe(expectedRevision);
  expect(events).toBe(0);
});
