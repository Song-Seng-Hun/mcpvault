import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import type { SemanticSearchService } from './semantic-search.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-neighborhood-snapshot-')); vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const write = (path: string, content: string, extra = {}) => fs.writeNote({ path, content, frontmatter: { note_kind: 'atomic', ...extra } });
  await write('Root.md', '# Root\n[[A]]');
  await write('A.md', '# Peer');
  await write('Back.md', '# Citation\n[[Root]]');
  return { fs, access, wiki, write };
}

test('neighborhood locators identify the document and revision that actually contain their context', async () => {
  const { fs, wiki } = await fixture();
  const result = await wiki.neighborhood(undefined, 'Root.md', 10, 16000);
  expect(result.neighbors).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'A.md', contextPath: 'Root.md', contextRevision: await fs.readNoteRevision('Root.md') }),
    expect.objectContaining({ path: 'Back.md', contextPath: 'Back.md', contextRevision: await fs.readNoteRevision('Back.md') }),
  ]));
});

test.each(['outlinks', 'backlinks'] as const)('neighborhood rejects a changed %s source instead of relabeling old context as current', async mode => {
  const { fs, wiki, write } = await fixture();
  const method = mode === 'outlinks' ? 'getOutlinks' : 'getBacklinks';
  const read = fs[method].bind(fs);
  vi.spyOn(fs, method).mockImplementation(async (...args) => {
    const value = await read(...args);
    await write(mode === 'outlinks' ? 'Root.md' : 'Back.md', '# Links removed');
    return value as any;
  });
  await expect(wiki.neighborhood(undefined, 'Root.md', 10, 16000)).rejects.toThrow(/changed or became unavailable/i);
});

test('neighborhood rejects a peer hidden after enrichment reads return their captured bodies', async () => {
  const { fs, wiki, write } = await fixture();
  const read = fs.readNote.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async path => {
    const note = await read(path);
    if (path === 'A.md' && !changed) {
      changed = true;
      await write('A.md', '# Private', { moderation_status: 'hidden' });
    }
    return note;
  });
  await expect(wiki.neighborhood(undefined, 'Root.md', 10, 16000)).rejects.toThrow(/changed or became unavailable/i);
});

test('neighborhood applies maxChars to pretty JSON as well as compact JSON', async () => {
  const { wiki } = await fixture();
  const result = await wiki.neighborhood(undefined, 'Root.md', 10, 700);
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(700);
});

test('metadata-based neighborhood never rebases a removed shared tag onto a new revision', async () => {
  const { fs, wiki, write } = await fixture();
  await write('Root.md', '# Root', { tags: ['shared'] });
  await write('A.md', '# Peer', { tags: ['shared'] });
  const read = fs.readNote.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async path => {
    if (path === 'A.md' && !changed) {
      changed = true;
      await write('A.md', '# Peer without tag');
    }
    return read(path);
  });
  await expect(wiki.neighborhood(undefined, 'Root.md', 10, 16000)).rejects.toThrow(/changed or became unavailable/i);
  expect(changed).toBe(true);
});

test('neighborhood supports 40 neighbors with bounded final validation and no unrelated reads', async () => {
  const { fs, wiki, write } = await fixture();
  const paths = Array.from({ length: 40 }, (_, index) => `P${index}.md`);
  for (const path of paths) await write(path, '# Peer');
  await write('Root.md', paths.map(path => `[[${path}]]`).join('\n'));
  await write('Unrelated.md', '# Leave alone');
  const read = fs.readNoteRevision.bind(fs);
  let active = 0, peak = 0;
  const checked: string[] = [];
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async path => {
    checked.push(path); active++; peak = Math.max(peak, active);
    try { return await read(path); } finally { active--; }
  });
  const result = await wiki.neighborhood(undefined, 'Root.md', 40, 16000);
  expect(result.totalCandidates).toBe(41); // 40 outgoing peers plus Back.md.
  expect(new Set(checked).size).toBe(41); // root and top 40 selected peers.
  expect(checked).not.toContain('Unrelated.md');
  expect(peak).toBeLessThanOrEqual(4);
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(16000);
});

test('semantic context without a line never inherits the previous graph locator', async () => {
  const { fs, access } = await fixture();
  const revision = await fs.readNoteRevision('A.md');
  const semantic = { search: async () => ({ available: true, indexed: 1, pending: 0,
    results: [{ p: 'A.md', t: 'Peer', ex: 'Semantic excerpt', rv: revision }] }) } as unknown as SemanticSearchService;
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access), semantic);
  const result = await wiki.neighborhood(undefined, 'Root.md', 10, 16000, true);
  const peer = result.neighbors.find(note => note.path === 'A.md')!;
  expect(peer).toMatchObject({ context: 'Semantic excerpt', contextPath: 'A.md', contextRevision: revision });
  expect(peer).not.toHaveProperty('line');
});

test('stale semantic excerpts cannot adopt a newly read peer revision', async () => {
  const { fs, access, write } = await fixture();
  const revision = await fs.readNoteRevision('A.md');
  const semantic = { search: async () => {
    await write('A.md', '# Changed after semantic capture');
    return { available: true, indexed: 1, pending: 0, results: [{ p: 'A.md', t: 'Peer', ex: 'Old excerpt', rv: revision, ln: 1 }] };
  } } as unknown as SemanticSearchService;
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access), semantic);
  await expect(wiki.neighborhood(undefined, 'Root.md', 10, 16000, true)).rejects.toThrow(/changed or became unavailable/i);
});
