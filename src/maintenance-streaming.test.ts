import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
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
async function fixture(indexed: boolean, run: (wiki: LlmWikiService, fs: FileSystemService,
  seed: (path: string, fm?: Record<string, unknown>, body?: string) => Promise<string>, root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-maint-stream-', root = await mkdtemp(join(base, prefix));
  const seed = async (path: string, fm: Record<string, unknown> = {}, body = '# Body\n') => {
    const raw = `---\n${stringify({ ...fm })}---\n${body}`;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), raw);
    return raw;
  };
  let index: VaultMetadataIndex | undefined;
  try {
    const filter = new PathFilter(), frontmatter = new FrontmatterHandler();
    if (indexed) index = new VaultMetadataIndex(root, filter, frontmatter);
    const fs = new FileSystemService(root, filter, frontmatter, undefined, index), access = new ScopeAccessPolicy();
    await run(new LlmWikiService(fs, access, new ReferenceService(fs, access)), fs, seed, root);
  } finally {
    await index?.close();
    vi.restoreAllMocks();
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test.each([false, true])('maintenance hydrates at most four bodies without content pages (indexed=%s)', async indexed => {
  await fixture(indexed, async (wiki, fs, seed) => {
    for (let i = 0; i < 17; i++) await seed(`Inbox/${i}.md`, { lifecycle: 'inbox' }, 'body'.repeat(1024));
    let active = 0, peak = 0;
    const hydrate = (fs as any).hydrateQueryNote.bind(fs);
    vi.spyOn(fs as any, 'hydrateQueryNote').mockImplementation(async (...args: any[]) => {
      peak = Math.max(peak, ++active);
      try { return await hydrate(...args); } finally { active--; }
    });
    const query = vi.spyOn(fs, 'queryNotes');
    const result: any = await wiki.maintenanceDebt(undefined, 30, 2, 7000);
    expect(result.scanned).toBe(17);
    expect(result.counts.inbox_capture).toBe(17);
    expect(result.items).toHaveLength(2);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(4);
    expect(active).toBe(0);
    expect(query.mock.calls.every(([params]) => params?.includeContent === false)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(7000);
  });
});

test('changed selected source cannot lend its new revision to old repair reasons', async () => {
  await fixture(false, async (wiki, fs, seed) => {
    await seed('Note.md', { lifecycle: 'inbox' });
    let newRaw = '';
    const change = async () => { if (!newRaw) newRaw = await seed('Note.md', { lifecycle: 'evergreen' }, '# Already repaired\n'); };
    const read = fs.readNote.bind(fs), metadata = fs.readNoteMetadata.bind(fs);
    vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => { await change(); return read(...args); });
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => { await change(); return metadata(...args); });
    const result: any = await wiki.maintenanceDebt();
    expect(newRaw).not.toBe('');
    expect(result.items[0].reasons).toContain('inbox_capture');
    expect(result.items[0].revision).toBeUndefined();
    expect(result.items[0].curationPlan).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(digest(newRaw));
  });
});

test('hidden and private notes never contribute maintenance reasons or counters', async () => {
  await fixture(true, async (wiki, _fs, seed) => {
    await seed('Visible.md', { lifecycle: 'inbox' });
    await seed('Hidden.md', { lifecycle: 'inbox', moderation_status: 'hidden', title: 'SECRET-HIDDEN' });
    await seed('_scopes/models/claude/Private.md', { lifecycle: 'inbox', title: 'SECRET-PRIVATE' });
    const result: any = await wiki.maintenanceDebt();
    expect(result.scanned).toBe(1);
    expect(result.counts).toEqual({ inbox_capture: 1 });
    expect(result.items.map((item: any) => item.path)).toEqual(['Visible.md']);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

test.each([false, true])('body and metadata reasons retain meaning and revision-safe actions (indexed=%s)', async indexed => {
  await fixture(indexed, async (wiki, _fs, seed, root) => {
    const body = '# Current\n';
    const original = await seed('Fresh.md', { summary: 'Fresh', summary_of_content_sha256: digest(body) }, body);
    await seed('Stale.md', { summary: 'Old', summary_of_content_sha256: digest('old') }, body);
    await seed('Empty.md', { note_kind: 'moc' }, '# No links\n');
    await seed('Linked.md', { note_kind: 'moc' }, '[[Fresh]]');
    await seed('Literature.md', { note_kind: 'literature', interpretation_status: 'unprocessed' });
    await seed('Project.md', { note_kind: 'project', lifecycle: 'active' });
    const result: any = await wiki.maintenanceDebt(undefined, 30, 20, 16000);
    expect(result.counts).toEqual({ stale_summary: 1, empty_moc: 1, unprocessed_literature: 1, project_without_next_action: 1 });
    for (const item of result.items) {
      expect(item.revision).toBe(digest(await readFile(join(root, item.path), 'utf8')));
      expect(item.curationPlan).toBeDefined();
      expect(item.evaluatedRevision).toBeUndefined();
    }
    expect(await readFile(join(root, 'Fresh.md'), 'utf8')).toBe(original);
  });
});

test.each(['changed', 'hidden', 'missing'])('a %s source between metadata and body invalidates the maintenance read', async change => {
  await fixture(true, async (wiki, fs, seed, root) => {
    await seed('Note.md', { lifecycle: 'inbox' });
    const query = fs.queryNotes.bind(fs);
    vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
      const page = await query(...args);
      if (change === 'missing') await rm(join(root, 'Note.md'));
      else await seed('Note.md', { lifecycle: 'inbox', ...(change === 'hidden' && { moderation_status: 'hidden' }) }, '# New body\n');
      return page;
    });
    await expect(wiki.maintenanceDebt()).rejects.toThrow('Query snapshot changed');
  });
});

test('newly hidden selected candidate loses its public row and repair plan', async () => {
  await fixture(true, async (wiki, fs, seed) => {
    await seed('Note.md', { lifecycle: 'inbox', title: 'OLD-VISIBLE-TITLE' });
    const metadata = fs.readNoteMetadata.bind(fs);
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
      await seed('Note.md', { lifecycle: 'inbox', moderation_status: 'hidden' });
      return metadata(...args);
    });
    const result: any = await wiki.maintenanceDebt();
    expect(result.items).toEqual([]);
    expect(result.counts).toEqual({});
    expect(result.scanned).toBe(0);
    expect(result.debtTotal).toBe(0);
    expect(result.truncated).toBe(false);
    expect(JSON.stringify(result)).not.toContain('OLD-VISIBLE-TITLE');
    expect(JSON.stringify(result)).not.toContain('Note.md');
  });
});

test('deleted selected candidate remains advisory without fabricated revision or plan', async () => {
  await fixture(true, async (wiki, fs, seed, root) => {
    await seed('Note.md', { lifecycle: 'inbox' });
    const metadata = fs.readNoteMetadata.bind(fs);
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
      await rm(join(root, 'Note.md'));
      return metadata(...args);
    });
    const result: any = await wiki.maintenanceDebt();
    expect(result.items[0]).toMatchObject({ path: 'Note.md', reasons: ['inbox_capture'] });
    expect(result.items[0].revision).toBeUndefined();
    expect(result.items[0].curationPlan).toBeUndefined();
  });
});

test('removing a newly hidden candidate preserves other rows and shared reason counts', async () => {
  await fixture(true, async (wiki, fs, seed) => {
    await seed('Hide.md', { lifecycle: 'inbox', summary: 'Old', summary_of_content_sha256: digest('old') });
    await seed('Keep.md', { lifecycle: 'inbox' });
    const metadata = fs.readNoteMetadata.bind(fs);
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
      if (args[0][0] === 'Hide.md') await seed('Hide.md', { lifecycle: 'inbox', moderation_status: 'hidden' });
      return metadata(...args);
    });
    const result: any = await wiki.maintenanceDebt();
    expect(result.items.map((item: any) => item.path)).toEqual(['Keep.md']);
    expect(result.counts).toEqual({ inbox_capture: 1 });
    expect(result.scanned).toBe(1); expect(result.debtTotal).toBe(1);
    expect(result.truncated).toBe(false);
  });
});
