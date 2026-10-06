import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PathFilter } from './pathfilter.js';
import { SemanticSearchService } from './semantic-search.js';
import { SearchService } from './search.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';

// Exercise the real bounded reader at smaller test ceilings; do not allocate
// hundreds of MiB just to prove each caller's fallback path.
const ceiling = vi.hoisted(() => ({ decoded: 0, rejections: 0 }));
vi.mock('./snapshot-read.js', async importOriginal => {
  const real = await importOriginal<typeof import('./snapshot-read.js')>();
  return { readSnapshotBytes: async (path: string, limits: Parameters<typeof real.readSnapshotBytes>[1]) => {
    try {
      return await real.readSnapshotBytes(path, ceiling.decoded && limits.maxDecodedBytes !== undefined
        ? { ...limits, maxDecodedBytes: Math.min(limits.maxDecodedBytes, ceiling.decoded) } : limits);
    } catch (error) { ceiling.rejections++; throw error; }
  } };
});

let vault: string;
let host: Awaited<ReturnType<typeof derivedStorageFixture>>;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-snapshot-consumers-'));
  host = await derivedStorageFixture(vault);
  vi.stubEnv('MCPVAULT_DERIVED_CACHE_DIR', host.host);
});
afterEach(async () => {
  ceiling.decoded = 0; ceiling.rejections = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await host.close();
  await rm(vault, { recursive: true, force: true });
});

test('semantic oversized gzip falls back to bounded valid legacy manifest without losing source files', async () => {
  const raw = '# Current';
  await writeFile(join(vault, 'Note.md'), raw);
  const hash = createHash('sha256').update(raw).digest('hex');
  const manifest = JSON.stringify({ 'Note.md': { hash, scope: 'global' } });
  await writeFile(host.path('semantic-manifest.snapshot.gz'), gzipSync(manifest));
  await writeFile(host.path('semantic-manifest.json'), manifest);
  ceiling.decoded = 8;
  const service = new SemanticSearchService(vault, new PathFilter());
  try {
    await (service as any).manifestReady;
    expect((service as any).manifest['Note.md']).toEqual({ hash, scope: 'global' });
    expect(ceiling.rejections).toBeGreaterThan(0);
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
  } finally { await service.close(); }
});

test('lexical search rebuilds Markdown after legacy gzip exceeds its ceiling', async () => {
  await writeFile(join(vault, 'Note.md'), '# Present\n\nSnapshotColdNeedle');
  await writeFile(host.path('search-index.snapshot.gz'), gzipSync(JSON.stringify({ version: 6, documents: [], grams: [] })));
  ceiling.decoded = 8;
  const service = new SearchService(vault, new PathFilter());
  try {
    expect((await service.search({ query: 'SnapshotColdNeedle', maxChars: 512 }))[0]?.p).toBe('Note.md');
    expect(ceiling.rejections).toBeGreaterThanOrEqual(1); // Existing legacy gzip reached the bounded reader and was rejected.
  } finally { await service.close(); }
});
