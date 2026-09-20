import assert from 'node:assert/strict';
import { MemorySqliteStore } from '../dist/src/memory/sqlite-store.js';
import { mkdtemp, rm, stat, statfs, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir, freemem } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const count = Number(process.argv[2] ?? 100000);
assert([100000, 1000000].includes(count), 'Use 100000 or 1000000');
assert(freemem() >= 3.8 * 1024 ** 3, 'Need 3.8 GiB free RAM');
const disk = await statfs(tmpdir()); assert(disk.bavail * disk.bsize > 4 * 1024 ** 3, 'Need 4 GiB disk reserve');
const engine = { node: process.version };
for (const file of ['memory/sqlite-store', 'memory/sqlite-worker', 'curation/discovery-features']) {
  engine[file] = digest(await readFile(new URL(`../dist/src/${file}.js`, import.meta.url)));
}
const root = await mkdtemp(join(tmpdir(), 'mcpvault-curation-discovery-'));
const store = new MemorySqliteStore(join(root, 'index.sqlite'));
let peakRss = 0, indexed = 0, lastReport = performance.now(), report;
const guard = () => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  assert(freemem() >= 2.3 * 1024 ** 3 && peakRss < 1.5 * 1024 ** 3, 'Resource guard');
};
try {
  await store.ready(); const start = performance.now();
  for (let from = 0; from < count; from += 128) {
    guard(); const rows = [];
    for (let i = from; i < Math.min(from + 128, count); i++) {
      const text = `# Topic ${i % 1000}\nOnly if enabled. 예외 유지.`;
      rows.push({ path: `N${String(i).padStart(7, '0')}.md`, text, revision: digest(`${i}:${text}`),
        frontmatter: { llm_wiki_type: 'knowledge', ...(i % 7 === 0 && { related: ['[[Target]]', '[[Target]]'] }) } });
    }
    await store.put(rows); indexed += rows.length;
    if (performance.now() - lastReport > 15000) {
      console.log(JSON.stringify({ indexed, elapsedMs: Math.round(performance.now() - start), peakRss })); lastReport = performance.now();
    }
  }
  const buildMs = performance.now() - start, scenarios = [];
  for (const kind of ['relations', 'duplicate_content']) {
    const samples = []; let first;
    for (let i = 0; i < 100; i++) {
      guard(); const t = performance.now(); first = await store.curationPage({ kind, limit: 8 }); samples.push(performance.now() - t);
      assert.equal(first.notes.length, 8); assert(first.truncated);
    }
    const next = await store.curationPage({ kind, limit: 8, after: first.next, expectedGeneration: first.generation });
    assert.equal(next.notes.length, 8); assert(!next.notes.some(b => first.notes.some(a => a.path === b.path)));
    const plan = await store.curationExplain({ kind, limit: 8, after: first.next, expectedGeneration: first.generation });
    assert(!plan.some(step => /SCAN (?:docs|curation_documents)\b|USE TEMP B-TREE/.test(step)));
    samples.sort((a, b) => a - b); scenarios.push({ kind, p50Ms: samples[49], p95Ms: samples[94], returned: 8, primaryWindowUpperBound: 9, plan });
  }
  const updateStart = performance.now();
  await store.put([{ path: 'N0000000.md', text: 'Changed.', revision: digest('Changed.'), frontmatter: { llm_wiki_type: 'knowledge' } }]);
  assert(!(await store.curationPage({ kind: 'relations', limit: 8 })).notes.some(n => n.path === 'N0000000.md'));
  const updateAndLookupMs = performance.now() - updateStart;
  report = { status: 'measured', engine, synthetic: true, logicalDocuments: count, physicalNotes: count, vectorChunks: 0,
    bodyGroups: 1000, buildMs, scenarios, updateAndLookupMs, peakProcessRssBytes: peakRss,
    mainJsHeapBytes: process.memoryUsage().heapUsed, diskBytes: (await stat(join(root, 'index.sqlite'))).size,
    nasIo: 0, scope: 'Actual worker ingestion and indexed candidate windows. Not NAS ACL coverage, quality, model cost or operational curation.' };
} catch (e) { report = { status: 'incomplete', indexed, reason: String(e.message).slice(0, 180) }; process.exitCode = 1; }
finally {
  await store.close();
  const rel = relative(resolve(tmpdir()), resolve(root));
  assert(rel && !rel.startsWith('..') && !rel.includes(':') && root.includes('mcpvault-curation-discovery-'), 'Unsafe cleanup target');
  await rm(root, { recursive: true, force: true });
}
const output = new URL('../.mcpvault/curation-discovery-benchmark/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL(`${count}-${Date.now()}.json`, output), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report));
