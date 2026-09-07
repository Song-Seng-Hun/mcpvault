import { afterEach, expect, test, vi } from 'vitest';
import { VaultGraphIndex } from './vault-graph.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import type { OutlinkMatch } from './types.js';
import { NavigationViewFingerprint } from './navigation-view.js';

const all = () => true;
const link = (target: string, line = 1): OutlinkMatch => ({ target, line, link: `[[${target}]]`, context: `See [[${target}]]` });
const row = (path: string, links: OutlinkMatch[] = [], moderationHidden = false) => ({
  path, links, moderationHidden, revision: `rev-${path}`, size: 100, mtimeMs: 1, ctimeMs: 1, tags: [], identityTerms: [],
});
const graphs: VaultGraphIndex[] = [];
function seed(rows: ReturnType<typeof row>[]) {
  const graph = new VaultGraphIndex(process.cwd(), new PathFilter(), new FrontmatterHandler()); graphs.push(graph);
  // Only IO refresh is bypassed. Queries, resolvers, redaction and fingerprints run normally.
  vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  for (const entry of rows) { (graph as any).entries.set(entry.path, entry); (graph as any).allPaths.add(entry.path); }
  return graph;
}
afterEach(() => { for (const graph of graphs.splice(0)) graph.close(); vi.restoreAllMocks(); });

test('backlink selection avoids N times K comparisons for a small page', async () => {
  const authors = Array.from({ length: 600 }, (_, i) => row(`Author-${String(i).padStart(4, '0')}.md`, [link('Target')]));
  const graph = seed([row('Target.md'), ...authors]);
  const original = String.prototype.localeCompare; let compares = 0;
  const spy = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (this: string, other: string) {
    if (String(this).startsWith('Author-') && String(other).startsWith('Author-')) compares++;
    return original.call(this, other);
  });
  const result = await graph.getBacklinks('Target.md', 64, all); spy.mockRestore();
  expect(result.total).toBe(600); expect(result.backlinks.map(item => item.path)).toEqual(authors.slice(0, 64).map(item => item.path));
  expect(compares).toBeLessThan(10_000);
});

test('outlinks retain the selected window without a full filtered edge array', async () => {
  const links = Array.from({ length: 600 }, (_, i) => link(`Missing-${i}`, i + 1));
  const graph = seed([row('Source.md', links)]), filter = vi.spyOn(links, 'filter');
  const result = await graph.getOutlinks('Source.md', 3, all, 20, true, true);
  expect(result.outlinks).toEqual(links.slice(20, 23)); expect(result.total).toBe(600); expect(result.truncated).toBe(true);
  expect(filter).not.toHaveBeenCalled();
});

test('orphan pagination does not materialize all orphan row objects', async () => {
  const notes = Array.from({ length: 600 }, (_, i) => row(`Note-${String(i).padStart(4, '0')}.md`));
  const graph = seed(notes), original = Array.prototype.map; let mappedOrphans = 0;
  const spy = vi.spyOn(Array.prototype, 'map').mockImplementation(function (this: unknown[], fn: any, context: any) {
    const result = original.call(this, fn, context);
    if (result[0] && typeof result[0] === 'object' && 'incomingLinks' in result[0]) mappedOrphans += result.length;
    return result;
  });
  const originalPush = Array.prototype.push, originalSort = Array.prototype.sort;
  let peakRows = 0, sortedRows = 0;
  const orphanRow = (value: any) => value && typeof value === 'object' && 'incomingLinks' in value;
  // Plain wrappers avoid recursive spy bookkeeping through Array.push itself.
  Array.prototype.push = function (...items: any[]) {
    const length = originalPush.apply(this, items);
    if (items.some(orphanRow)) peakRows = Math.max(peakRows, length);
    return length;
  };
  Array.prototype.sort = function (compare?: any) {
    if (orphanRow(this[0])) sortedRows += this.length;
    return originalSort.call(this, compare);
  };
  let result: Awaited<ReturnType<VaultGraphIndex['findOrphanNotes']>>;
  try { result = await graph.findOrphanNotes(3, all, 20, true); }
  finally { Array.prototype.push = originalPush; Array.prototype.sort = originalSort; spy.mockRestore(); }
  expect(result.orphans).toEqual(notes.slice(20, 23).map(({ path }) => ({ path, incomingLinks: 0 })));
  expect(result.total).toBe(600); expect(result.truncated).toBe(true); expect(mappedOrphans).toBe(0);
  expect(peakRows).toBe(3); expect(sortedRows).toBe(0);
});

test('backlink ties preserve encounter order consistently across page sizes', async () => {
  const a = row('A.md', [link('Target#first'), link('Target#second')]);
  const b = row('B.md', [link('Target#third'), link('Target#fourth')]);
  // Targets are already parsed by the index; authored anchors remain in link text.
  for (const edge of [...a.links, ...b.links]) edge.target = 'Target';
  const graph = seed([row('Target.md'), b, a]);
  const full = await graph.getBacklinks('Target.md', 4, all, 0, undefined, true, true);
  expect(full.backlinks.map(edge => edge.link)).toEqual([...a.links, ...b.links].map(edge => edge.link));
  for (const [offset, limit] of [[0, 3], [1, 2], [2, 1], [4, 3], [8, 1]]) {
    const page = await graph.getBacklinks('Target.md', limit!, all, offset, undefined, true, true);
    expect(page.backlinks).toEqual(full.backlinks.slice(offset, offset! + limit!));
    expect(page.snapshotFingerprint).toBe(full.snapshotFingerprint); expect(page.total).toBe(4);
    expect(page.truncated).toBe(4 > offset! + page.backlinks.length);
  }
});

test('outlink fingerprint covers off-page links and validates off-page dependencies', async () => {
  const links = [link('A'), link('B', 2), link('Missing', 3)], source = row('Source.md', links);
  const graph = seed([source, row('A.md'), row('B.md')]);
  const validate = vi.fn(async (_targets: ReadonlyMap<string, string>) => {});
  const page = await graph.getOutlinks('Source.md', 1, all, 0, true, true, validate);
  expect([...validate.mock.calls[0]![0].keys()]).toEqual(['A.md', 'B.md']);
  const oracle = new NavigationViewFingerprint(['outlinks', source.path, source.revision]);
  for (const edge of links) oracle.add(source.path, source.revision, edge);
  expect(page.snapshotFingerprint).toBe(oracle.finish());
  const last = await graph.getOutlinks('Source.md', 1, all, 2, true, true);
  const empty = await graph.getOutlinks('Source.md', 1, all, 8, true, true);
  expect(last.outlinks).toEqual([links[2]]); expect(last.truncated).toBe(false);
  expect(empty.outlinks).toEqual([]); expect(empty.total).toBe(3); expect(empty.truncated).toBe(false);
  expect(empty.snapshotFingerprint).toBe(page.snapshotFingerprint);
  links[2]!.context = 'changed outside selected page';
  expect((await graph.getOutlinks('Source.md', 1, all, 0, true, true)).snapshotFingerprint).not.toBe(page.snapshotFingerprint);
});

test.each(['generation', 'visibility'] as const)('outlink window never escapes a changed %s during validation', async change => {
  let visible = true;
  const graph = seed([row('Source.md', [link('Target')]), row('Target.md')]);
  await expect(graph.getOutlinks('Source.md', 1, path => visible || path === 'Source.md', 0, true, true, async () => {
    await Promise.resolve();
    if (change === 'generation') graph.invalidate('Target.md', 'upsert'); else visible = false;
  })).rejects.toThrow(/Graph changed or visibility changed/);
});

test('hidden scopes, moderated sources and private references stay out of windows and counts', async () => {
  const source = row('Source.md', [link('Target'), link('Private/Secret', 2), link('scope://agent/secret/Note', 3)]);
  const rows = [source, row('Target.md'), row('Private/Secret.md'), row('Hidden.md', [link('Target')], true)];
  const before = JSON.stringify(rows), graph = seed(rows), publicOnly = (path: string) => !path.startsWith('Private/');
  const out = await graph.getOutlinks('Source.md', 1, publicOnly, 0, true, true);
  expect(out.total).toBe(1); expect(out.outlinks).toEqual([source.links[0]]);
  const back = await graph.getBacklinks('Target.md', 1, publicOnly, 0, async path => path !== 'Source.md');
  expect(back.total).toBe(0); expect(back.backlinks).toEqual([]);
  const orphan = await graph.findOrphanNotes(10, publicOnly, 0, true);
  expect(orphan.orphans).toEqual([{ path: 'Source.md', incomingLinks: 0 }]);
  expect(JSON.stringify([out, back, orphan])).not.toMatch(/Private|Secret|Hidden/);
  expect(JSON.stringify(rows)).toBe(before);
});

test('orphan windows preserve sorted order, self-link semantics and whole-view fingerprints', async () => {
  const graph = seed([row('Z.md'), row('B.md', [link('B')]), row('A.md', [link('Linked')]), row('Linked.md')]);
  const full = await graph.findOrphanNotes(10, all, 0, true);
  const expected = ['A.md', 'B.md', 'Z.md'];
  expect(full.orphans.map(item => item.path)).toEqual(expected); expect(full.total).toBe(3);
  const oracle = new NavigationViewFingerprint(['orphans']);
  for (const path of expected) oracle.add(path, `rev-${path}`, { path, incomingLinks: 0 });
  expect(full.snapshotFingerprint).toBe(oracle.finish());
  for (let offset = 0; offset < 5; offset++) {
    const page = await graph.findOrphanNotes(1, all, offset, true);
    expect(page.orphans).toEqual(full.orphans.slice(offset, offset + 1));
    expect(page.total).toBe(3); expect(page.snapshotFingerprint).toBe(full.snapshotFingerprint);
    expect(page.truncated).toBe(3 > offset + 1);
  }
});
