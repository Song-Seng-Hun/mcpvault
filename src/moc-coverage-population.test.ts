import { expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

async function fixture(run: (wiki: LlmWikiService, seed: (path: string, fields?: Record<string, unknown>, body?: string) => Promise<void>, root: string) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-coverage-pop-', root = await mkdtemp(join(base, prefix));
  const originals = new Map<string, string>();
  const seed = async (path: string, fields: Record<string, unknown> = {}, body = '# Knowledge\n') => {
    const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', ...fields })}---\n${body}`;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), raw); originals.set(path, raw);
  };
  try {
    const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
    await run(new LlmWikiService(fs, access, new ReferenceService(fs, access)), seed, root);
    for (const [path, raw] of originals) expect(await readFile(join(root, path), 'utf8')).toBe(raw);
  } finally {
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

for (const managed of [false, true]) test.each(['moc', 'MOC', ' moc '])(`managed=${managed} map kind %s uses a coverage-only population`, async kind => {
  await fixture(async (wiki, seed) => {
    await seed('Root.md', { note_kind: kind, llm_wiki_type: managed ? 'knowledge' : undefined }, '# Root\n[[Leaf]]\n');
    await seed('Leaf.md');
    const result = await wiki.graphHealth(undefined, 20, 16000);
    expect(result.mocCount).toBe(1);
    expect(result.mocCoverage).toMatchObject({ knowledgeTotal: 1, knowledgeLinkedFromMoc: 1, ratio: 1, uncoveredKnowledge: { total: 0, items: [] } });
    expect(result.mocCoverage.mocs).toEqual([expect.objectContaining({ path: 'Root.md', directKnowledge: 1, indirectKnowledge: 0, linkedKnowledge: 1, knowledgeCoverage: 1 })]);
    expect(result.knowledgeUsage.total).toBe(managed ? 2 : 1);
    const candidates = await wiki.mocCandidates(undefined, 10, 16000);
    expect(candidates).toMatchObject({ candidates: [], total: 0, uncoveredKnowledgeTotal: 0 });
  });
});

test.each([false, true])('nested maps and cycles do not count maps as covered knowledge (cycle=%s)', async cycle => {
  await fixture(async (wiki, seed) => {
    await seed('Root.md', { note_kind: 'moc' }, '# Root\n[[Child]]\n[[Child]]\n');
    await seed('Child.md', { note_kind: ' MOC ', moc_parent: '[[Root]]' }, `# Child\n[[Leaf]]\n${cycle ? '[[Root]]\n' : ''}`);
    await seed('Leaf.md');
    const result = await wiki.graphHealth(undefined, 20, 16000);
    expect(result.mocCount).toBe(2);
    expect(result.mocCoverage).toMatchObject({ knowledgeTotal: 1, knowledgeLinkedFromMoc: 1, ratio: 1, uncoveredKnowledge: { total: 0, items: [] } });
    const root = result.mocCoverage.mocs.find(item => item.path === 'Root.md');
    expect(root).toMatchObject({ linkedKnowledge: 1, directKnowledge: 0, indirectKnowledge: 1, nestedMocs: 1, knowledgeCoverage: 1 });
    expect(root?.linkedNotes).toBe(cycle ? 3 : 2);
    expect(result.knowledgeUsage.total).toBe(3);
  });
});

test('a maps-only inventory needs no map-of-maps scaffold', async () => {
  await fixture(async (wiki, seed) => {
    await seed('Root.md', { note_kind: 'moc' }, '# Root\n[[Child]]\n');
    await seed('Child.md', { note_kind: 'moc', moc_parent: '[[Root]]' });
    const result = await wiki.graphHealth(undefined, 20, 16000);
    expect(result.mocCoverage).toMatchObject({ knowledgeTotal: 0, knowledgeLinkedFromMoc: 0, ratio: 1, uncoveredKnowledge: { total: 0, items: [] } });
    expect(result.knowledgeUsage.total).toBe(2);
    expect(result.emptyMocs.total).toBe(1);
    expect(result.mocHierarchy?.roots.items).toEqual(['Root.md']);
    expect(await wiki.mocCandidates(undefined, 10, 16000)).toMatchObject({ candidates: [], total: 0, uncoveredKnowledgeTotal: 0 });
  });
});

test('genuinely uncovered knowledge remains a candidate while the root map does not', async () => {
  await fixture(async (wiki, seed) => {
    await seed('Root.md', { note_kind: 'moc' }, '# Root\n[[Linked]]\n');
    await seed('Linked.md');
    await seed('Uncovered.md', { domain: 'Research', primary_moc: '[[Root]]' });
    const result = await wiki.graphHealth(undefined, 20, 16000);
    expect(result.mocCoverage).toMatchObject({ knowledgeTotal: 2, knowledgeLinkedFromMoc: 1, ratio: 0.5, uncoveredKnowledge: { total: 1, items: [{ path: 'Uncovered.md' }] } });
    const candidates = await wiki.mocCandidates(undefined, 10, 16000);
    expect(candidates.uncoveredKnowledgeTotal).toBe(1);
    expect(candidates.candidates.flatMap(item => item.notePaths)).toEqual(['Uncovered.md']);
    expect(candidates.candidates[0]?.orderedEntries).toEqual([expect.objectContaining({ path: 'Uncovered.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  });
});

test('coverage does not silently remove retired knowledge from the inventory', async () => {
  await fixture(async (wiki, seed) => {
    await seed('Root.md', { note_kind: 'moc' }, '# Root\n[[Archived]]\n');
    await seed('Archived.md', { lifecycle: 'archived' });
    await seed('Superseded.md', { lifecycle: 'superseded' });
    const result = await wiki.graphHealth(undefined, 20, 16000);
    expect(result.mocCoverage).toMatchObject({ knowledgeTotal: 2, knowledgeLinkedFromMoc: 1, ratio: 0.5, uncoveredKnowledge: { items: [{ path: 'Superseded.md' }] } });
    expect(result.knowledgeUsage.total).toBe(3);
  });
});

test('hidden and private maps cannot inflate coverage or disclose their knowledge', async () => {
  await fixture(async (wiki, seed) => {
    await seed('Visible.md');
    await seed('Hidden.md', { note_kind: 'moc', moderation_status: 'hidden', title: 'SECRET-HIDDEN' }, '[[Visible]]');
    await seed('Hidden-leaf.md', { moderation_status: 'hidden', title: 'SECRET-LEAF' });
    await seed('_scopes/models/claude/Private.md', { note_kind: 'moc', title: 'SECRET-PRIVATE' }, '[[Visible]]');
    const result = await wiki.graphHealth(undefined, 20, 16000);
    expect(result.mocCount).toBe(0);
    expect(result.mocCoverage).toMatchObject({ knowledgeTotal: 1, knowledgeLinkedFromMoc: 0, ratio: 0, uncoveredKnowledge: { items: [{ path: 'Visible.md' }] } });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    const candidates = await wiki.mocCandidates(undefined, 10, 16000);
    expect(candidates.candidates.flatMap(item => item.notePaths)).toEqual(['Visible.md']);
    expect(JSON.stringify(candidates)).not.toContain('SECRET');
  });
});

test('snapshot visibility controls both map traversal and coverage denominator', async () => {
  await fixture(async (wiki, seed) => {
    await seed('Root.md', { note_kind: 'moc' }, '[[Included]]\n[[Excluded]]');
    await seed('Included.md'); await seed('Excluded.md');
    const result = await wiki.graphHealth(undefined, 20, 16000, path => path !== 'Excluded.md');
    expect(result.mocCoverage).toMatchObject({ knowledgeTotal: 1, knowledgeLinkedFromMoc: 1, ratio: 1 });
    const withoutRoot = await wiki.graphHealth(undefined, 20, 16000, path => path !== 'Root.md');
    expect(withoutRoot.mocCount).toBe(0);
    expect(withoutRoot.mocCoverage).toMatchObject({ knowledgeTotal: 2, knowledgeLinkedFromMoc: 0, ratio: 0 });
  });
});

test.each([['moc'], [' MOC ']])('a malformed array kind %j is not promoted into a navigation map', async value => {
  await fixture(async (wiki, seed) => {
    await seed('Malformed.md', { note_kind: [value] }, '[[Leaf]]'); await seed('Leaf.md');
    const result = await wiki.graphHealth(undefined, 20, 16000);
    expect(result.mocCount).toBe(0);
    expect(result.mocCoverage).toMatchObject({ knowledgeTotal: 2, knowledgeLinkedFromMoc: 0, ratio: 0 });
  });
});

test('MCP graph and MOC candidates expose the same bounded coverage population', async () => {
  await fixture(async (_wiki, seed, root) => {
    await seed('Root.md', { note_kind: 'moc' }, '[[Leaf]]'); await seed('Leaf.md');
    const server = createServer(root, { version: 'moc-coverage-population' });
    const client = new Client({ name: 'moc-coverage', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      expect((await client.listTools()).tools).toHaveLength(5);
      for (const maxChars of [512, 6000, 16000]) {
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.graph_health', arguments: { maxChars, prettyPrint: true } } });
        expect(result.isError).not.toBe(true);
        const text = (result.content as any)[0].text;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        const report = JSON.parse(text);
        if (report.mocCoverage) expect(report.mocCoverage).toMatchObject({ knowledgeTotal: 1, knowledgeLinkedFromMoc: 1, ratio: 1 });
        else expect(report.truncated).toBe(true);
        if (maxChars === 16000) expect(report.mocCoverage).toBeDefined();
      }
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.moc_candidates', arguments: { maxChars: 12000 } } });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.content as any)[0].text)).toMatchObject({ candidates: [], uncoveredKnowledgeTotal: 0 });
    } finally { await client.close(); await server.close(); }
  });
});
