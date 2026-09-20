import { MemorySqliteStore } from '../dist/src/memory/sqlite-store.js';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir, freemem } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
const count = Number(process.argv[2] || 100000);
if (![100000, 1000000].includes(count)) throw Error('Use 100000 or 1000000 synthetic logical documents');
if (freemem() < 3.8 * 1024 ** 3) throw Error('Benchmark requires 3.8 GiB free before starting');
const root = await mkdtemp(join(tmpdir(), 'mcpvault-memory-scale-'));
const store = new MemorySqliteStore(join(root, 'memory.sqlite'));
const began = performance.now(), before = process.memoryUsage(); let peak = before.rss, scanned = 0;
try {
  await store.ready();
  for (let start = 0; start < count; start += 128) {
    if (freemem() < 2.3 * 1024 ** 3 || process.memoryUsage().rss > 1.5 * 1024 ** 3) throw Error('Owned benchmark resource guard');
    const rows = [];
    for (let i = start; i < Math.min(start + 128, count); i++) rows.push({ path: `project-${i % 100}/note-${String(i).padStart(7, '0')}.md`, revision: 'a'.repeat(64),
      frontmatter: { memory_role: i % 3 ? 'episodic' : 'procedural' }, text: i % 101 ? 'Ordinary event.' : '배포 조건: NAS version 2.0 only.' });
    await store.put(rows); scanned += rows.length; peak = Math.max(peak, process.memoryUsage().rss);
    if (scanned % 12800 === 0) process.stdout.write(JSON.stringify({ indexed: scanned, elapsedMs: Math.round(performance.now() - began), rss: peak }) + '\n');
  }
  const buildMs = performance.now() - began, times = [], result = [];
  const query = { prefix: 'project-1', terms: ['배포'], role: 'episodic', limit: 20 };
  for (let i = 0; i < 100; i++) { const t = performance.now(); const p = await store.page(query); times.push(performance.now() - t); result.push(p.notes.length); }
  times.sort((a,b) => a-b);
  const plan = await store.explain(query), diskBytes = (await stat(join(root, 'memory.sqlite'))).size;
  const walBytes = await stat(join(root, 'memory.sqlite-wal')).then(s => s.size, e => { if (e.code === 'ENOENT') return 0; throw e; });
  const t = performance.now(); await store.put([{ path: 'project-1/changed.md', revision: 'b'.repeat(64), frontmatter: { memory_role: 'episodic', memory_corrects: [{ path: 'project-1/note-0000001.md' }] }, text: '배포 changed condition.' }]);
  const dependents = await store.dependents(['project-1/note-0000001.md'], 200);
  console.log(JSON.stringify({ status: 'measured', synthetic: true, logicalDocuments: count, memoryUnits: count, vectorChunks: 0,
    buildMs, p50Ms: times[49], p95Ms: times[94], updateAndDependencyMs: performance.now()-t, dependents: dependents.notes.length,
    peakProcessRssBytes: peak, mainJsHeapBytes: process.memoryUsage().heapUsed, diskBytes, walBytes, returnedRows: result[0], queryPlan: plan,
    nasIo: 0, scope: 'SQLite worker and bounded synthetic metadata; not whole Vault, ANN or model quality certification' }));
} catch (e) { console.log(JSON.stringify({ status: 'incomplete', indexed: scanned, reason: String(e.message).slice(0,100) })); process.exitCode = 1; }
finally { await store.close(); const rel = relative(resolve(tmpdir()), resolve(root)); if (rel && !rel.startsWith('..') && !rel.includes(':') && root.includes('mcpvault-memory-scale-')) await rm(root, { recursive: true, force: true }); }
