// Disposable local synthetic fixture; no caller-controlled vault/runtime path.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir, freemem } from 'node:os';
import { join, relative, isAbsolute, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleSummary } from './benchmark-graph-index.mjs';

export async function benchmarkBacklinkCache({ notes = 1000, samples = 8 } = {}) {
  if (!Number.isSafeInteger(notes) || notes < 32 || notes > 10000
    || !Number.isSafeInteger(samples) || samples < 1 || samples > 20) throw Error('Invalid synthetic scale');
  if (freemem() / 2 ** 30 < 2.3) throw Error('Insufficient memory for measurement');
  const [{ VaultGraphIndex }, { VaultFileCatalog }, { PathFilter }, { FrontmatterHandler }, { VaultIoCoordinator }, { readBoundedSource }] = await Promise.all([
    import('../dist/src/vault-graph.js'), import('../dist/src/vault-catalog.js'), import('../dist/src/pathfilter.js'),
    import('../dist/src/frontmatter.js'), import('../dist/src/vault-io.js'), import('../dist/src/bounded-source-read.js'),
  ]);
  const base = await realpath(tmpdir()), prefix = 'mcpvault-backlink-cache-';
  const root = await mkdtemp(join(base, prefix)), identity = await lstat(root);
  let graph, catalog, reads = 0, bytes = 0, minimumFreeGiB = freemem() / 2 ** 30;
  const guard = () => { minimumFreeGiB = Math.min(minimumFreeGiB, freemem() / 2 ** 30); if (minimumFreeGiB < 2) throw Error('Memory reserve reached'); };
  const targets = Math.min(Math.floor(notes / 2), Math.ceil(notes / 1024) * 32);
  const target = i => `Targets/T${i}.md`, expected = Array(targets).fill(0);
  const canRead = () => true, scenarios = [];
  const io = new VaultIoCoordinator({ minConcurrency: 1, maxConcurrency: 1, initialConcurrency: 1,
    boundedReader: async (path, max) => { guard(); const text = await readBoundedSource(path, max); reads++; bytes += Buffer.byteLength(text); return text; } });
  async function measure(name, count, operation) {
    const timings = [], before = { reads, bytes };
    for (let i = 0; i < count; i++) {
      guard(); const start = performance.now(); await operation(i);
      timings.push(Math.round((performance.now() - start) * 1000) / 1000);
    }
    scenarios.push({ name, latency: sampleSummary(timings), logicalBodyReads: reads - before.reads, logicalBodyBytes: bytes - before.bytes });
  }
  const query = async i => {
    const result = await graph.getBacklinks(target(i), 5, canRead, 0, undefined, true);
    assert.equal(result.total, expected[i]);
    assert.equal(result.backlinks.length, Math.min(5, expected[i]));
    assert(result.backlinks.every(row => /^[a-f0-9]{64}$/.test(row.sourceRevision)));
  };
  let result;
  try {
    await mkdir(join(root, 'Targets')); await mkdir(join(root, 'Sources'));
    for (let i = 0; i < targets; i++) await writeFile(join(root, target(i)), '# 정확한 근거 조건 😀\n', { flag: 'wx' });
    for (let i = 0; i < notes - targets; i++) {
      guard();
      const links = Array.from({ length: 20 }, (_, j) => { const n = (i * 20 + j) % targets; expected[n]++; return `[[${target(n)}#조건|evidence]]`; });
      await writeFile(join(root, `Sources/S${i}.md`), '# Source\n' + links.join('\n'), { flag: 'wx' });
    }
    catalog = new VaultFileCatalog(root, new PathFilter());
    graph = new VaultGraphIndex(root, new PathFilter(), new FrontmatterHandler(), catalog, io);
    await measure('cold_build', 1, () => query(0));
    await measure('hot_target', samples, () => query(0));
    await measure('rotating_fill', Math.min(8, targets), i => query(i));
    await measure('rotating_hits', samples, i => query(i % Math.min(8, targets)));
    result = { synthetic: true, canonicalVaultUsed: false, sharedCatalog: true, notes, targets,
      resolvedOccurrences: expected.reduce((a, b) => a + b, 0), incomingPerTarget: { min: Math.min(...expected), max: Math.max(...expected) },
      scenarios, correctness: true, minimumFreeGiB, maxRssMiB: process.resourceUsage().maxRSS / 1024,
      limitations: 'Local synthetic shared graph/catalog, not NAS or full MCP load. Body reads exclude stats/SMB. Bounded repeated samples are not a general latency guarantee. No model or alternative database tested.' };
  } finally {
    graph?.close(); catalog?.close();
    const actual = await realpath(root), rel = relative(base, actual), current = await lstat(root);
    if (actual !== root || !rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith(prefix)
      || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw Error('Unsafe fixture cleanup');
    await rm(actual, { recursive: true, force: true });
  }
  return { ...result, fixtureRemoved: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--notes' || !['1000', '10000'].includes(args[1]))) throw Error('Only --notes 1000|10000 is allowed');
  console.log(JSON.stringify(await benchmarkBacklinkCache({ notes: args.length ? Number(args[1]) : 1000 }), null, 2));
}
