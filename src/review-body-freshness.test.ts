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
