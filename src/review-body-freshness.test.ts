import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { VaultMetadataIndex } from './vault-index.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';

const digest = (body: string) => createHash('sha256').update(body).digest('hex');
async function fixture(run: (wiki: LlmWikiService, fs: FileSystemService, seed: (path: string, body: string, fm?: Record<string, unknown>) => Promise<void>) => Promise<void>, indexed = false) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-review-body-', vault = await mkdtemp(join(base, prefix));
  const seed = async (path: string, body: string, fm: Record<string, unknown> = {}) => {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), `---\n${stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', ...fm })}---\n${body}`);
  };
  let index: VaultMetadataIndex | undefined;
  try {
    const filter = new PathFilter(), frontmatter = new FrontmatterHandler();
    if (indexed) index = new VaultMetadataIndex(vault, filter, frontmatter);
    const fs = new FileSystemService(vault, filter, frontmatter, undefined, index), access = new ScopeAccessPolicy();
    await run(new LlmWikiService(fs, access, new ReferenceService(fs, access)), fs, seed);
  } finally {
    await index?.close();
    const target = await realpath(vault), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test.each([false, true])('metadata-only review and impact do not mark current nonempty summaries stale (indexed=%s)', async indexed => {
  await fixture(async (wiki, fs, seed) => {
    const body = '# Current\nGrounded body.\n';
    await seed('Fresh.md', body, { summary: 'Grounded summary', summary_of_content_sha256: digest(body) });
    expect((await fs.queryNotes({})).notes[0]!.content).toBeUndefined();
    expect((await wiki.reviewQueue()).items).toEqual([]);
    const impact = await wiki.impactReport(undefined, 20, 12000);
    expect(JSON.stringify(impact)).not.toContain('summary_stale');
  }, indexed);
});

test('an unchanged on_any_edit body does not trigger itself or create a cascade seed', async () => {
  await fixture(async (wiki, _fs, seed) => {
    const body = '# Stable\nNo edit.\n';
    await seed('Root.md', body, { review_policy: 'on_any_edit', review_basis_content_sha256: digest(body) });
    const queue = await wiki.reviewQueue(undefined, 20, 12000);
    expect(queue.items).toEqual([]);
    expect(queue.cascade.seedCount).toBe(0);
  });
});

test('manual notes without projections need no additional body hydration and private notes stay excluded', async () => {
  await fixture(async (wiki, fs, seed) => {
    const body = '# Current\n';
    await seed('Plain.md', body);
    await seed('Fresh.md', body, { summary: 'Current', summary_of_content_sha256: digest(body) });
    await seed('_scopes/models/claude/Hidden.md', body, { summary: 'Hidden', summary_of_content_sha256: digest('old') });
    const spy = vi.spyOn(fs, 'readQueryNoteBody');
    try {
      expect((await wiki.reviewQueue()).total).toBe(0);
      expect(spy.mock.calls.map(([note]) => note.path)).toEqual(['Fresh.md']);
    } finally { spy.mockRestore(); }
  });
});

test('single-row hydration rejects denied, newly hidden and oversized sources without returning partial content', async () => {
  await fixture(async (_wiki, fs, seed) => {
    await seed('Source.md', '# Body\n');
    const note = (await fs.queryNotes({})).notes[0]!;
    const io = vi.spyOn((fs as any).vaultIo, 'readUtf8Bounded');
    try {
      await expect(fs.readQueryNoteBody(note, () => false, () => true)).rejects.toThrow('Query snapshot changed');
      expect(io).not.toHaveBeenCalled();
      await seed('Source.md', '# Hidden\n', { moderation_status: 'quarantined' });
      await expect(fs.readQueryNoteBody(note, () => true, current => current.frontmatter.moderation_status !== 'quarantined')).rejects.toThrow('Query snapshot changed');
      await seed('Large.md', 'x'.repeat(8 * 1024 * 1024 + 1));
      const large = (await fs.queryNotes({})).notes.find(row => row.path === 'Large.md')!;
      await expect(fs.readQueryNoteBody(large, () => true, () => true)).rejects.toThrow('Source exceeds query read budget');
    } finally { io.mockRestore(); }
  });
});

test('real empty source digests are distinct from missing bodies and real edits remain detectable', async () => {
  await fixture(async (wiki, _fs, seed) => {
    await seed('Empty.md', '', { summary: 'Empty body', summary_of_content_sha256: digest('') });
    await seed('Changed.md', '# New\n', { summary: 'Old summary', summary_of_content_sha256: digest('# Old\n'), review_policy: 'on_any_edit', review_basis_content_sha256: digest('# Old\n') });
    const queue = await wiki.reviewQueue(undefined, 20, 12000);
    expect(queue.items.map(item => item.path)).toEqual(['Changed.md']);
    expect(queue.items[0]!.reviewReasons).toEqual(expect.arrayContaining(['summary_stale', 'note_edited']));
  });
});

test('on_link_change reads real body links rather than interpreting omitted content as link deletion', async () => {
  await fixture(async (wiki, fs, seed) => {
    await seed('Target.md', '# Target\n');
    await seed('Linked.md', '# Linked\n[[Target]]\n', { review_policy: 'on_link_change', review_basis_links: [{ path: 'Target.md', revision: (await fs.readNote('Target.md')).revision }] });
    const queue = await wiki.reviewQueue(undefined, 20, 12000);
    expect(queue.items).toEqual([]);
  });
});

test.each([false, true])('relocation never certifies an old summary against rewritten content (indexed=%s)', async indexed => {
  await fixture(async (wiki, fs, seed) => {
    await seed('Wiki/Target.md', '# Target\n');
    const path = 'Wiki/Reader.md', body = '[[./Target.md]]\n';
    await seed(path, body, { summary: 'Original summary', summary_of_content_sha256: digest(body), review_policy: 'on_any_edit' });
    await wiki.review({ path, reviewOutcome: 'confirmed', reviewedBy: 'reader', expectedRevision: (await fs.readNote(path)).revision });
    const before = await fs.readNote(path);
    expect((await wiki.reviewQueue()).items).toEqual([]);
    expect((await fs.moveNote({ oldPath: path, newPath: 'Archive/Reader.md', updateLinks: true, expectedRevision: before.revision })).success).toBe(true);
    const moved = await fs.readNote('Archive/Reader.md');
    expect(moved.content).toContain('[[Wiki/Target.md]]');
    expect(moved.frontmatter.summary_of_content_sha256).toBe(before.frontmatter.summary_of_content_sha256);
    expect(moved.frontmatter.review_basis_content_sha256).toBe(before.frontmatter.review_basis_content_sha256);
    const queue = await wiki.reviewQueue();
    expect(queue.items.find(item => item.path === 'Archive/Reader.md')?.reviewReasons).toEqual(expect.arrayContaining(['summary_stale', 'note_edited']));
  }, indexed);
});

test.each([false, true])('a target-only rename preserves the link review baseline when its content is unchanged (indexed=%s)', async indexed => {
  await fixture(async (wiki, fs, seed) => {
    await seed('Wiki/Target.md', '# Target\n');
    const path = 'Wiki/Reader.md';
    await seed(path, '[[./Target.md]]\n', { review_policy: 'on_link_change' });
    await wiki.review({ path, reviewOutcome: 'confirmed', reviewedBy: 'reader', expectedRevision: (await fs.readNote(path)).revision });
    const originalBasis = (await fs.readNote(path)).frontmatter.review_basis_links;
    await seed('Other/Target.md', '# Unrelated same-name note\n');
    expect((await fs.moveNote({ oldPath: 'Wiki/Target.md', newPath: 'Target.md', updateLinks: true, expectedRevision: (await fs.readNote('Wiki/Target.md')).revision })).success).toBe(true);
    const after = await fs.readNote(path);
    expect(after.frontmatter.review_basis_links[0].path).toBe('Target.md');
    expect(after.frontmatter.review_basis_links[0].revision).toBe(originalBasis[0].revision);
    expect((await wiki.reviewQueue()).items).toEqual([]);
    const rootTarget = await fs.readNote('Target.md');
    expect((await fs.moveNote({ oldPath: 'Target.md', newPath: 'Archive/Final.md', updateLinks: true, expectedRevision: rootTarget.revision })).success).toBe(true);
    expect((await fs.readNote(path)).frontmatter.review_basis_links[0].path).toBe('Archive/Final.md');
    expect((await wiki.reviewQueue()).items).toEqual([]);
    await fs.writeNote({ path: 'Archive/Final.md', content: '# Actual change\n', expectedRevision: rootTarget.revision });
    expect((await wiki.reviewQueue()).items.find(item => item.path === path)?.reviewReasons).toContain('link_changed');
  }, indexed);
});

test.each(['dependency', 'support'])('upstream %s renames keep unchanged evidence out of the review queue', async direction => {
  await fixture(async (wiki, fs, seed) => {
    const path = 'Reader.md';
    await seed('Wiki/Target.md', '# Evidence\n', direction === 'support' ? { supports: ['Reader.md'] } : {});
    await seed(path, '# Reader\n', { review_policy: 'on_upstream_change', ...(direction === 'dependency' ? { depends_on: ['Wiki/Target.md'] } : {}) });
    await wiki.review({ path, reviewOutcome: 'confirmed', reviewedBy: 'reader', expectedRevision: (await fs.readNote(path)).revision });
    expect((await wiki.reviewQueue()).items).toEqual([]);
    expect((await fs.moveNote({ oldPath: 'Wiki/Target.md', newPath: 'Target.md', expectedRevision: (await fs.readNote('Wiki/Target.md')).revision, updateLinks: true })).success).toBe(true);
    expect((await wiki.reviewQueue()).items).toEqual([]);
    const evidence = await fs.readNote('Target.md');
    await fs.writeNote({ path: 'Target.md', content: '# Evidence changed\n', expectedRevision: evidence.revision });
    expect((await wiki.reviewQueue()).items.find(item => item.path === path)?.reviewReasons).toContain('upstream_changed');
  });
});

test.each([false, true])('explicit wikilink extensions retain the same exact review target (indexed=%s)', async indexed => {
  await fixture(async (wiki, fs, seed) => {
    await seed('Wiki/Target.md', '# Target\n');
    await seed('Wiki/Target.markdown', '# Separate\n');
    const path = 'Wiki/Reader.md', body = '[[./Target.md#Heading]]\n';
    await seed(path, body, { review_policy: 'on_link_change' });
    expect(await new ReferenceService(fs, new ScopeAccessPolicy()).validateAndNormalize(undefined, path, undefined, body)).toEqual(['Wiki/Target.md']);
    await wiki.review({ path, reviewOutcome: 'confirmed', reviewedBy: 'reader', expectedRevision: (await fs.readNote(path)).revision });
    expect((await fs.readNote(path)).frontmatter.review_basis_links.map((item: {path: string}) => item.path)).toEqual(['Wiki/Target.md']);
    const other = await fs.readNote('Wiki/Target.markdown');
    await fs.writeNote({ path: 'Wiki/Target.markdown', content: '# Other edited\n', expectedRevision: other.revision });
    expect((await wiki.reviewQueue()).items).toEqual([]);
    const actual = await fs.readNote('Wiki/Target.md');
    await fs.writeNote({ path: 'Wiki/Target.md', content: '# Actual edited\n', expectedRevision: actual.revision });
    expect((await wiki.reviewQueue()).items.map(item => item.path)).toEqual([path]);
  }, indexed);
});

test.each([false, true])('ordinary Markdown links use source-relative reference and review targets (indexed=%s)', async indexed => {
  await fixture(async (wiki, fs, seed) => {
    await seed('Wiki/Target.md', '# Target\n');
    await seed('Other/Target.md', '# Other\n');
    const path = 'Wiki/Reader.md', body = '[target](Target.md#Heading)\n';
    await seed(path, body, { review_policy: 'on_link_change' });
    expect(await new ReferenceService(fs, new ScopeAccessPolicy()).validateAndNormalize(undefined, path, undefined, body)).toEqual(['Wiki/Target.md']);
    await wiki.review({ path, reviewOutcome: 'confirmed', reviewedBy: 'reader', expectedRevision: (await fs.readNote(path)).revision });
    expect((await fs.readNote(path)).frontmatter.review_basis_links.map((item: {path: string}) => item.path)).toEqual(['Wiki/Target.md']);
    expect((await wiki.reviewQueue()).total).toBe(0);
    await fs.writeNote({ path: 'Wiki/Target.md', content: '# Changed\n', expectedRevision: (await fs.readNote('Wiki/Target.md')).revision });
    expect((await wiki.reviewQueue(undefined, 20, 12000)).items.find(item => item.path === path)?.reviewReasons).toContain('link_changed');
  }, indexed);
});

test.each([false, true])('relative wikilinks keep their source-relative review target (indexed=%s)', async indexed => {
  await fixture(async (wiki, fs, seed) => {
    await seed('Knowledge/Target.md', '# Target\n');
    await seed('Elsewhere/Target.md', '# Not the target\n');
    await seed('Elsewhere/Local.md', '# Not the local target\n');
    await seed('Knowledge/Nested/Local.md', '# Local\n');
    const path = 'Knowledge/Nested/Linked.md';
    const body = '[[../Target#Heading|alias]] and [[./Local\\|local]]\n';
    await seed(path, body, { review_policy: 'on_link_change' });
    const references = new ReferenceService(fs, new ScopeAccessPolicy());
    expect(await references.validateAndNormalize(undefined, path, undefined, body)).toEqual(['Knowledge/Target.md', 'Knowledge/Nested/Local.md']);
    await wiki.review({ path, reviewOutcome: 'confirmed', reviewedBy: 'test', expectedRevision: (await fs.readNote(path)).revision });
    const baseline = (await fs.readNote(path)).frontmatter.review_basis_links;
    expect(baseline.map((item: { path: string }) => item.path).sort()).toEqual(['Knowledge/Nested/Local.md', 'Knowledge/Target.md']);
    expect((await wiki.reviewQueue(undefined, 20, 12000)).items).toEqual([]);
    await fs.writeNote({ path: 'Knowledge/Target.md', content: '# Changed target\n', expectedRevision: (await fs.readNote('Knowledge/Target.md')).revision });
    const queue = await wiki.reviewQueue(undefined, 20, 12000);
    expect(queue.items.find(item => item.path === path)?.reviewReasons).toContain('link_changed');
    expect(JSON.stringify(queue)).not.toContain('Elsewhere/Target');
  }, indexed);
});

test.each([false, true])('explicit private wikilinks retain the caller identity without widening visibility (indexed=%s)', async indexed => {
  await fixture(async (_wiki, fs, seed) => {
    await seed('_scopes/models/codex/Target.md', '# Own model\n');
    await seed('_scopes/models/claude/Target.md', '# Other model\n');
    const principal = { accountId: 'reader', modelId: 'codex', agentId: 'reader-worker', role: 'agent' as const };
    const path = '_scopes/models/codex/Nested/Source.md';
    const references = new ReferenceService(fs, new ScopeAccessPolicy());
    expect(await references.validateAndNormalize(['[[../Target]]'], path, principal)).toEqual(['_scopes/models/codex/Target.md']);
    await expect(references.validateAndNormalize(['[[../Target]]'], path)).rejects.toThrow(/does not resolve/);
    expect(await fs.findPathForWikiLink('Target', candidate => new ScopeAccessPolicy().canAccessPhysicalPath(candidate, principal))).toEqual(['_scopes/models/codex/Target.md']);
    await expect(references.validateAndNormalize(['[[_scopes/models/codex/Target]]'], 'Public.md', principal)).rejects.toThrow(/more-private/);
  }, indexed);
});

test.each([false, true])('review baselines do not copy an authenticated reader\'s private targets into a public note (indexed=%s)', async indexed => {
  await fixture(async (wiki, fs, seed) => {
    const hidden = '_scopes/models/codex/Secret.md';
    await seed(hidden, '# Secret\n');
    await seed('Public.md', `[[${hidden}]]\n`, { references: [hidden], review_policy: 'on_link_change' });
    await wiki.review({ path: 'Public.md', principal: { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' }, reviewOutcome: 'confirmed', reviewedBy: 'reader', expectedRevision: (await fs.readNote('Public.md')).revision });
    expect((await fs.readNote('Public.md')).frontmatter.review_basis_links).toEqual([]);
  }, indexed);
});

test('a body changed after metadata selection is rejected instead of paired with the old revision', async () => {
  await fixture(async (wiki, fs, seed) => {
    const body = '# Stable\n';
    await seed('Fresh.md', body, { summary: 'Summary', summary_of_content_sha256: digest(body), review_policy: 'on_any_edit', review_basis_content_sha256: digest(body) });
    const query = fs.queryNotes.bind(fs);
    let changed = false;
    const spy = vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
      const result = await query(...args);
      if (!changed) { changed = true; await seed('Fresh.md', '# Changed\n', { summary: 'Summary', summary_of_content_sha256: digest(body) }); }
      return result;
    });
    try { await expect(wiki.reviewQueue()).rejects.toThrow(/snapshot changed/i); }
    finally { spy.mockRestore(); }
  });
});
