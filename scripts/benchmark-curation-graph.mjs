import { MemorySqliteStore } from '../dist/src/memory/sqlite-store.js';
import { mkdtemp, rm, stat, statfs, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir, freemem } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const count = Number(process.argv[2] || 100000);
const engine = { node: process.version };
for (const name of ['sqlite-store', 'sqlite-worker']) engine[name] = createHash('sha256')
  .update(await readFile(new URL(`../dist/src/memory/${name}.js`, import.meta.url))).digest('hex');
if (![100000, 1000000].includes(count)) throw Error('Use 100000 or 1000000 synthetic logical documents');
if (freemem() < 3.8 * 1024 ** 3) throw Error('Requires 3.8 GiB free RAM before starting');
const disk = await statfs(tmpdir());
if (disk.bavail * disk.bsize < (count === 1000000 ? 8 : 2) * 1024 ** 3) throw Error('Insufficient temporary disk reserve');
const root = await mkdtemp(join(tmpdir(), 'mcpvault-curation-graph-'));
const store = new MemorySqliteStore(join(root, 'graph.sqlite'));
const began = performance.now(); let indexed = 0, peakRss = process.memoryUsage().rss, lastReport = began;
const guard = () => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (freemem() < 2.3 * 1024 ** 3 || peakRss > 1.5 * 1024 ** 3) throw Error('Owned benchmark resource guard');
};
let result;
try {
  await store.ready();
  for (let start = 0; start < count; start += 128) {
    guard(); const rows = [];
    for (let i = start; i < Math.min(start + 128, count); i++) {
      const path = `project-${i % 100}/note-${String(i).padStart(7, '0')}.md`, text = `# ${i}\n[[Hub]]\n[[Other]]`;
      rows.push({ path, revision: createHash('sha256').update(text).digest('hex'), text, frontmatter: { llm_wiki_type: 'knowledge' } });
    }
    await store.put(rows); indexed += rows.length;
    if (performance.now() - lastReport > 15000) {
      console.log(JSON.stringify({ indexed, elapsedMs: Math.round(performance.now() - began), rssBytes: peakRss })); lastReport = performance.now();
    }
  }
  const buildMs = performance.now() - began, scenarios = [];
  for (const query of [
    { direction: 'incoming', keys: ['hub', 'other'], limit: 20 },
    { direction: 'outgoing', keys: Array.from({ length: 20 }, (_, i) => `project-${i}/note-${String(i).padStart(7, '0')}.md`), limit: 20 },
  ]) {
    const times = []; let page;
    for (let i = 0; i < 100; i++) { guard(); const t = performance.now(); page = await store.graph(query); times.push(performance.now() - t); }
    times.sort((a, b) => a - b);
    const next = await store.graph({ ...query, after: page.next, expectedGeneration: page.generation });
    if (page.occurrences.some(a => next.occurrences.some(b => b.id === a.id))) throw Error('Duplicate continuation occurrence');
    scenarios.push({ direction: query.direction, p50Ms: times[49], p95Ms: times[94], returned: page.occurrences.length,
      indexedBranchRowUpperBound: query.keys.length * (query.limit + 1), queryPlan: await store.graphExplain(query) });
  }
  const t = performance.now();
  await store.put([{ path: 'project-0/note-0000000.md', revision: 'b'.repeat(64), text: '[[Changed]]', frontmatter: { llm_wiki_type: 'knowledge' } }]);
  const changed = await store.graph({ direction: 'incoming', keys: ['changed'], limit: 20 });
  if (changed.occurrences.length !== 1) throw Error('Incremental graph replacement failed');
  const updateAndLookupMs = performance.now() - t;
  const memoryStart = performance.now(), memory = await store.page({ terms: [], limit: 20 });
  if (memory.notes.length) throw Error('Graph-only rows leaked into memory candidates');
  result = { status: 'measured', engine, synthetic: true, logicalDocuments: count, graphOccurrencesBeforeUpdate: count * 2, vectorChunks: 0,
    buildMs, scenarios, updateAndLookupMs, emptyMemoryLookupMs: performance.now() - memoryStart,
    peakProcessRssBytes: peakRss, mainJsHeapBytes: process.memoryUsage().heapUsed,
    diskBytes: (await stat(join(root, 'graph.sqlite'))).size,
    walBytes: await stat(join(root, 'graph.sqlite-wal')).then(s => s.size, e => { if (e.code === 'ENOENT') return 0; throw e; }),
    nasIo: 0, scope: 'Real SQLite worker ingestion and paged graph queries; not NAS, ACL completeness, search quality or whole-plan certification' };
} catch (e) { result = { status: 'incomplete', indexed, reason: String(e.message).slice(0, 150) }; process.exitCode = 1; }
finally {
  await store.close();
  const rel = relative(resolve(tmpdir()), resolve(root));
  if (rel && !rel.startsWith('..') && !rel.includes(':') && root.includes('mcpvault-curation-graph-')) await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ ...result, scenarios: result.scenarios?.map(({ queryPlan, ...metrics }) => ({ ...metrics, planSteps: queryPlan.length })) }));
const output = new URL('../.mcpvault/curation-benchmark/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL(`${count}-${Date.now()}.json`, output), JSON.stringify(result, null, 2), { flag: 'wx' });
