import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { NotificationService } from './notifications.js';
import type { ReputationService } from './reputation.js';
import { SemanticSearchService } from './semantic-search.js';
import { SearchService } from './search.js';

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
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-snapshot-consumers-'));
  await mkdir(join(vault, '.mcpvault/semantic-index'), { recursive: true });
});
afterEach(async () => {
  ceiling.decoded = 0; ceiling.rejections = 0;
  vi.restoreAllMocks();
  await rm(vault, { recursive: true, force: true });
});

test('public discovery restores valid cache and rebuilds current Markdown when decoding is rejected', async () => {
  await mkdir(join(vault, 'Community/Posts'), { recursive: true });
  const post = '---\nmcpvault_type: blog_post\nstatus: published\npost_id: actual\ntitle: Current post\n---\nBody';
  await writeFile(join(vault, 'Community/Posts/actual.md'), post);
  const fs = new FileSystemService(vault);
  const catalog = new VaultFileCatalog(vault, new PathFilter());
  // Reputation is not used by discovery; fail immediately if this changes.
  const reputation = new Proxy({} as ReputationService, { get() { throw new Error('Unexpected reputation operation'); } });
  const first = new NotificationService(fs, reputation, vault, catalog);
  const restored = new NotificationService(fs, reputation, vault, catalog);
  const rejected = new NotificationService(fs, reputation, vault, catalog);
  try {
    expect((await first.discoverySnapshot()).posts[0]?.path).toBe('Community/Posts/actual.md');
    await first.close();
    expect((await readFile(join(vault, '.mcpvault/public-discovery.snapshot.bin'))).length).toBeGreaterThan(0);
    expect((await (restored as any).loadPublicSnapshot()).posts[0]?.path).toBe('Community/Posts/actual.md');
    ceiling.decoded = 8;
    const before = ceiling.rejections;
    expect((await rejected.discoverySnapshot()).posts[0]?.path).toBe('Community/Posts/actual.md');
    expect(ceiling.rejections).toBeGreaterThan(before);
    expect(await readFile(join(vault, 'Community/Posts/actual.md'), 'utf8')).toBe(post);
  } finally { await first.close(); await restored.close(); await rejected.close(); catalog.close(); }
});

test('semantic oversized gzip falls back to bounded valid legacy manifest without losing source files', async () => {
  const raw = '# Current';
  await writeFile(join(vault, 'Note.md'), raw);
  const hash = createHash('sha256').update(raw).digest('hex');
  const manifest = JSON.stringify({ 'Note.md': { hash, scope: 'global' } });
  await writeFile(join(vault, '.mcpvault/semantic-index/manifest.snapshot.gz'), gzipSync(manifest));
  await writeFile(join(vault, '.mcpvault/semantic-index/manifest.json'), manifest);
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
  await writeFile(join(vault, '.mcpvault/search-index.snapshot.gz'), gzipSync(JSON.stringify({ version: 6, documents: [], grams: [] })));
  ceiling.decoded = 8;
  const service = new SearchService(vault, new PathFilter());
  try {
    expect((await service.search({ query: 'SnapshotColdNeedle', maxChars: 512 }))[0]?.p).toBe('Note.md');
    expect(ceiling.rejections).toBeGreaterThanOrEqual(2); // absent binary and rejected legacy gzip
  } finally { service.close(); }
});

test.each(['Community/Posts/actual.md', '_scopes/agents/other/Private.md', 'Community/Posts/../Comments/forged.md'])('legacy discovery validates note membership for %s', async path => {
  const actualPath = 'Community/Posts/actual.md';
  await mkdir(join(vault, 'Community/Posts'), { recursive: true });
  await writeFile(join(vault, actualPath), '---\nmcpvault_type: blog_post\nstatus: published\n---\nActual');
  const info = await stat(join(vault, actualPath));
  const string = (value: string) => {
    const bytes = Buffer.from(value); const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length); return Buffer.concat([length, bytes]);
  };
  const header = Buffer.alloc(12); header.writeUInt32LE(1); header.writeUInt32LE(1, 4); header.writeUInt32LE(1, 8);
  const metadata = Buffer.alloc(16); metadata.writeDoubleLE(info.size); metadata.writeDoubleLE(info.mtimeMs, 8);
  const disk = Buffer.concat([Buffer.from('MCPVPUB1'), header, string(actualPath), metadata,
    Buffer.from([0]), string(path), string(JSON.stringify({ mcpvault_type: 'blog_post', status: 'published' }))]);
  await writeFile(join(vault, '.mcpvault/public-discovery.snapshot.bin'), gzipSync(disk));
  const catalog = new VaultFileCatalog(vault, new PathFilter());
  const service = new NotificationService(new FileSystemService(vault), {} as ReputationService, vault, catalog);
  try {
    const result = await (service as any).loadPublicSnapshot();
    if (path === actualPath) expect(result?.posts[0]?.path).toBe(actualPath);
    else expect(result).toBeUndefined();
  } finally { await service.close(); catalog.close(); }
});
