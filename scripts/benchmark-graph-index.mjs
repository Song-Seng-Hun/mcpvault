// Opt-in synthetic fixture only. No NAS copy, model, database or runtime writes.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, lstat, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { freemem, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export function parseBenchmarkArguments(args) {
  if (!args.length) return { notes: 1000, samples: 8 };
  if (![2, 3].includes(args.length) || (args.length === 3 && args[2] !== '--shared')
    || args[0] !== '--notes' || !['1000', '10000', '50000'].includes(args[1])) throw Error('Only --notes 1000|10000|50000 and optional --shared are supported; fixture paths are not accepted');
  return { notes: Number(args[1]), samples: 8, ...(args.length === 3 && { sharedCatalog: true }) };
}
export function sampleSummary(values) {
  if (!values.length || values.some(n => !Number.isFinite(n) || n < 0)) throw Error('Invalid measurement samples');
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] };
}
export async function benchmarkGraphIndex(options) {
  if (!options || Object.keys(options).some(k => !['notes', 'samples', 'sharedCatalog'].includes(k))
    || (options.sharedCatalog !== undefined && typeof options.sharedCatalog !== 'boolean')
    || !Number.isSafeInteger(options.notes) || options.notes < 32 || options.notes > 50000
    || !Number.isSafeInteger(options.samples) || options.samples < 1 || options.samples > 20) throw Error('Invalid synthetic fixture options');
  const { notes, samples, sharedCatalog = false } = options;
  if (freemem() / 2 ** 30 < 2.3) throw Error('Memory admission deferred; at least 2.3GiB must remain');
  const [{ VaultGraphIndex }, { VaultIoCoordinator }, { PathFilter }, { FrontmatterHandler }, { readBoundedSource }, { VaultFileCatalog }] = await Promise.all([
    import('../dist/src/vault-graph.js'), import('../dist/src/vault-io.js'), import('../dist/src/pathfilter.js'),
    import('../dist/src/frontmatter.js'), import('../dist/src/bounded-source-read.js'), import('../dist/src/vault-catalog.js'),
  ]);
  const prefix = 'mcpvault-graph-benchmark-', base = await realpath(tmpdir());
  const root = await mkdtemp(join(base, prefix)), rootStat = await lstat(root);
  let graph, catalog, minimumFreeGiB = freemem() / 2 ** 30, cancelled = false, reads = 0, bytes = 0;
  const stop = () => { cancelled = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const timer = setInterval(() => { minimumFreeGiB = Math.min(minimumFreeGiB, freemem() / 2 ** 30); }, 50);
  timer.unref();
  const guard = () => {
    minimumFreeGiB = Math.min(minimumFreeGiB, freemem() / 2 ** 30);
    if (cancelled || minimumFreeGiB < 2) throw Error('Synthetic measurement cancelled or memory reserve reached');
  };
  const file = i => `Notes/N${String(i).padStart(5, '0')}.md`;
  const content = (i, dense = false) => `---\nsupports: ['[[${file(0)}]]']\ncontradicts: ['[[${file(0)}]]']\n---\n# Note ${i}\n`
    + (dense ? Array.from({ length: 17 }, (_, j) => `[[${file(j)}]]`).join(' ') + ` [[${file(0)}]]` : `[[${file(0)}]] [[${file(0)}]]`) + '\n조건 and counterexample 🙂\n';
  const visible = new Set(Array.from({ length: notes }, (_, i) => file(i))), canRead = p => visible.has(p);
  const io = new VaultIoCoordinator({ minConcurrency: 1, maxConcurrency: 1, initialConcurrency: 1,
    boundedReader: async (p, max) => { guard(); const text = await readBoundedSource(p, max); reads++; bytes += Buffer.byteLength(text); return text; } });
  const scenarios = [];
  async function measure(name, count, operation) {
    guard(); const before = { calls: reads, bytes }, timings = []; let retries = 0, value;
    for (let i = 0; i < count; i++) {
      const started = performance.now();
      for (let attempt = 0; ; attempt++) {
        try { value = await operation(i); break; }
        catch (error) {
          if (attempt >= 2 || !/Graph changed|visibility changed/.test(String(error))) throw error;
          retries++; await new Promise(resolve => setTimeout(resolve, 30)); guard();
        }
      }
      timings.push(Math.round((performance.now() - started) * 1000) / 1000); guard();
    }
    scenarios.push({ name, latency: sampleSummary(timings), retries, logicalReads: { calls: reads - before.calls, bytes: bytes - before.bytes } });
    return value;
  }
  const backlinks = (target = 0) => graph.getBacklinks(file(target), 40, canRead);
  let result;
  try {
    await mkdir(join(root, 'Notes'));
    const generationStart = performance.now();
    for (let i = 0; i < notes; i++) { guard(); await writeFile(join(root, file(i)), content(i), { flag: 'wx' }); }
    const fixtureGenerationMs = Math.round(performance.now() - generationStart);
    catalog = sharedCatalog ? new VaultFileCatalog(root, new PathFilter()) : undefined;
    graph = new VaultGraphIndex(root, new PathFilter(), new FrontmatterHandler(), catalog, io);
    const cold = await measure('cold_build', 1, () => backlinks());
    assert.equal(cold.total, 4 * (notes - 1));
    assert(cold.backlinks.some(r => r.relation === 'supports') && cold.backlinks.some(r => r.relation === 'contradicts'));
    assert(cold.backlinks.every(r => r.path !== file(0)));
    await measure('warm_query', samples, async () => { const r = await backlinks(); assert.equal(r.total, cold.total); return r; });
    const oldRevision = (await graph.getOutlinks(file(1), 10, canRead, 0, true)).sourceRevision;
    await measure('upsert', 1, async () => {
      await writeFile(join(root, file(1)), `# Updated\n[[${file(17)}]]\n`); graph.invalidate(file(1), 'upsert');
      const r = await backlinks(); assert.equal(r.total, 4 * (notes - 2)); return r;
    });
    const newRevision = (await graph.getOutlinks(file(1), 10, canRead, 0, true)).sourceRevision;
    assert.match(newRevision, /^[a-f0-9]{64}$/); assert.notEqual(newRevision, oldRevision);
    await measure('delete', 1, async () => { await unlink(join(root, file(2))); graph.invalidate(file(2), 'delete'); const r = await backlinks(); assert.equal(r.total, 4 * (notes - 3)); return r; });
    await measure('alias_add', 1, async () => {
      await writeFile(join(root, file(3)), '---\naliases: [UniqueFixtureAlias]\n---\n# Alias\n');
      await writeFile(join(root, file(1)), '[[UniqueFixtureAlias]]\n');
      graph.invalidate(file(1), 'upsert'); graph.invalidate(file(3), 'upsert');
      const r = await backlinks(3); assert.equal(r.total, 1); assert.equal(r.backlinks[0].path, file(1)); return r;
    });
    await measure('alias_remove', 1, async () => {
      await writeFile(join(root, file(3)), '# Alias removed\n'); graph.invalidate(file(3), 'upsert');
      const r = await backlinks(3); assert.equal(r.total, 0); return r;
    });
    // Separate alias identity work from author changes, and from the directory
    // notification caused by the preceding deletion in legacy alias_add.
    await measure('alias_target_only', 1, async () => {
      await writeFile(join(root, file(3)), '---\naliases: [UniqueFixtureAlias]\n---\n# Alias\n'); graph.invalidate(file(3), 'upsert');
      const r = await backlinks(3); assert.equal(r.total, 1); return r;
    });
    await measure('alias_reference_only', 1, async () => {
      await writeFile(join(root, file(1)), '# Reference removed\n'); graph.invalidate(file(1), 'upsert');
      const r = await backlinks(3); assert.equal(r.total, 0); return r;
    });
    await measure('alias_combined', 1, async () => {
      await writeFile(join(root, file(3)), '---\naliases: [SecondFixtureAlias]\n---\n# Alias\n');
      await writeFile(join(root, file(1)), '[[SecondFixtureAlias]]\n');
      graph.invalidate(file(1), 'upsert'); graph.invalidate(file(3), 'upsert');
      const r = await backlinks(3); assert.equal(r.total, 1); return r;
    });
    await measure('permission_revoke', 1, async () => {
      visible.delete(file(4)); // Same predicate object; no content modification.
      const r = await backlinks(); assert.equal(r.total, 4 * (notes - 5));
      assert(!JSON.stringify(r).includes(file(4))); return r;
    });
    graph.close(); graph = undefined; catalog?.close(); catalog = undefined;
    for (let i = 0; i < notes; i++) { guard(); visible.add(file(i)); await writeFile(join(root, file(i)), content(i, true)); }
    catalog = sharedCatalog ? new VaultFileCatalog(root, new PathFilter()) : undefined;
    graph = new VaultGraphIndex(root, new PathFilter(), new FrontmatterHandler(), catalog, io);
    const dense = await measure('dense_build', 1, () => backlinks()); assert.equal(dense.total, cold.total);
    await measure('dense_warm', samples, async () => { const r = await backlinks(); assert.equal(r.total, cold.total); return r; });
    result = { notes, sharedCatalog, synthetic: true, canonicalVaultUsed: false, fixtureGenerationMs, scenarios,
      correctness: { occurrenceKinds: true, revisionsChanged: true, deletion: true, aliasDrift: true, permissionRevocation: true },
      dense: { resolvedOccurrences: 20 * notes, reverseCacheCap: 16384, exceedsCacheCap: 20 * notes > 16384 },
      maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024 * 100) / 100, minimumFreeGiB,
      smbBytes: null, alternativeDatabaseTested: false,
      limitations: 'Cold index, not cold OS cache. Logical bounded-body reads exclude metadata/stat and SMB transport. Single-run mutations have one sample, not a stable p95 estimate. Existing default index projection is not evidence verification. Dense overflow is exercised by fixture cardinality, not private instrumentation.' };
  } finally {
    graph?.close(); catalog?.close(); clearInterval(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    const target = await realpath(root), rel = relative(base, target), current = await lstat(root);
    if (target !== root || !rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)
      || current.isSymbolicLink() || current.dev !== rootStat.dev || current.ino !== rootStat.ino) throw Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
  return { ...result, fixtureRemoved: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await benchmarkGraphIndex(parseBenchmarkArguments(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
