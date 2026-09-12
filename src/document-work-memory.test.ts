import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { derivedCacheBudget } from './cache-budget.js';
import { parseDocumentStructure } from './document-structure.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';
import * as snapshots from './snapshot-read.js';
import * as privacy from './skill-evolution-host.js';
import { withDocumentWork } from './document-work-memory.js';
import { FrontmatterHandler } from './frontmatter.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
async function fixture(text = '# Small document') {
  const vault = await mkdtemp(join(tmpdir(), 'document-work-budget-'));
  cleanup.push(() => rm(vault, { recursive: true, force: true }));
  await writeFile(join(vault, 'Note.md'), text);
  const reader = new DocumentResourceReader(new FileSystemService(vault), new PathFilter(), new ScopeAccessPolicy());
  return { vault, reader };
}

test('exhausted shared work memory rejects source read before allocating source buffers', async () => {
  const { reader } = await fixture();
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes); cleanup.push(held.release);
  const allocate = vi.spyOn(Buffer, 'allocUnsafe');
  await expect(reader.read('Note.md')).rejects.toThrow(/work memory budget/i);
  expect(allocate).not.toHaveBeenCalled();
});

test('parse admission accounts for source bytes still held by the same operation', async () => {
  const { reader } = await fixture('x'.repeat(100_000));
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes - 1_000_000); cleanup.push(held.release);
  const parse = vi.fn(parseDocumentStructure);
  const index = new DocumentIndex(reader, undefined, { parse }); cleanup.push(() => index.close());
  await expect(index.load('Note.md').then(() => 'unexpected success')).rejects.toThrow(/work memory budget/i);
  expect(parse).not.toHaveBeenCalled();
  expect(derivedCacheBudget.workSnapshot().activeBytes).toBe(derivedCacheBudget.maxWorkingBytes - 1_000_000);
});

test('parallel reads cannot overbook pinned memory and failure releases each reservation', async () => {
  const { reader } = await fixture();
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes - 200_000); cleanup.push(held.release);
  const values = await Promise.allSettled(Array.from({ length: 8 }, () => reader.read('Note.md')));
  expect(values.filter(v => v.status === 'rejected').length).toBeGreaterThan(0);
  expect(values.filter(v => v.status === 'fulfilled').length).toBeGreaterThan(0);
  expect(derivedCacheBudget.workSnapshot().activeBytes).toBe(derivedCacheBudget.maxWorkingBytes - 200_000);
});

test('streaming revalidation reserves its scratch buffer from the same process budget', async () => {
  const { reader } = await fixture();
  const snapshot = await reader.read('Note.md');
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes); cleanup.push(held.release);
  const allocate = vi.spyOn(Buffer, 'allocUnsafe');
  await expect(reader.assertCurrent(snapshot)).rejects.toThrow(/work memory budget/i);
  expect(allocate).not.toHaveBeenCalled();
});

test('warm structures borrowed from an evictable cache remain charged during a response', async () => {
  const { reader } = await fixture('x'.repeat(100_000));
  const index = new DocumentIndex(reader); cleanup.push(() => index.close());
  await index.load('Note.md');
  let pinnedAtBoundary = 0;
  const check = reader.assertCurrent.bind(reader);
  vi.spyOn(reader, 'assertCurrent').mockImplementation(async (...args) => {
    pinnedAtBoundary = derivedCacheBudget.workSnapshot().activeBytes;
    return check(...args);
  });
  await index.load('Note.md');
  // Source chunks/decode (6x) plus the independently pinned borrowed raw (2x).
  expect(pinnedAtBoundary).toBeGreaterThanOrEqual(100_000 * 8 + 128 * 1024);
});

test('a cold cache skips decompression when its bounded decode cannot be admitted', async () => {
  const { reader, vault } = await fixture();
  const host = await derivedStorageFixture(vault); cleanup.push(host.close);
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  const first = new DocumentIndex(reader, undefined, { cacheDir: host.host }); cleanup.push(() => first.close());
  await first.load('Note.md'); await first.close();
  const parse = vi.fn(parseDocumentStructure);
  const second = new DocumentIndex(reader, undefined, { cacheDir: host.host, parse }); cleanup.push(() => second.close());
  const readCache = vi.spyOn(snapshots, 'readSnapshotBytes');
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes - 2_000_000); cleanup.push(held.release);
  expect((await second.load('Note.md')).structure.raw).toContain('Small document');
  expect(readCache).not.toHaveBeenCalled();
  expect(parse).toHaveBeenCalledTimes(1);
});

test('PDF parent output and conversion memory are admitted before invoking its provider', async () => {
  const { reader, vault } = await fixture();
  await writeFile(join(vault, 'File.pdf'), 'pdf fixture');
  const extract = vi.fn(async snapshot => parseDocumentStructure({ path: snapshot.path, revision: snapshot.revision, raw: 'extracted', format: 'text' }));
  const index = new DocumentIndex(reader, undefined, { pdf: { extract } }); cleanup.push(() => index.close());
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes - 1_000_000); cleanup.push(held.release);
  await expect(index.load('File.pdf').then(() => 'unexpected success')).rejects.toThrow(/work memory budget/i);
  expect(extract).not.toHaveBeenCalled();
});

test('one operation reuses verified source decoding but never exposes its private cached bytes', async () => {
  const { reader } = await fixture();
  const decode = vi.spyOn(TextDecoder.prototype, 'decode');
  await withDocumentWork(async () => {
    const first = await reader.read('Note.md'); first.bytes.fill(0); first.text = 'poison';
    const second = await reader.read('Note.md');
    expect(second.bytes.toString()).toBe('# Small document');
    expect(second.text).toBe('# Small document');
  });
  expect(decode).toHaveBeenCalledTimes(1);
  await reader.read('Note.md');
  expect(decode).toHaveBeenCalledTimes(2);
});

test('operation snapshot reuse revalidates external edits and current source admission', async () => {
  const { reader, vault } = await fixture();
  await withDocumentWork(async () => {
    await reader.read('Note.md');
    await writeFile(join(vault, 'Note.md'), '# External change');
    await expect(reader.read('Note.md').then(() => 'unexpected success')).rejects.toThrow(/revision|changed/i);
  });
});

test('operation snapshot reuse rejects source admission revoked after its first read', async () => {
  const { reader } = await fixture();
  await withDocumentWork(async () => {
    await reader.read('Note.md');
    vi.spyOn(reader, 'admitted').mockReturnValue(false);
    await expect(reader.read('Note.md')).rejects.toThrow(/denied|unavailable/i);
  });
  expect(derivedCacheBudget.workSnapshot().activeBytes).toBe(0);
});

test('moderation frontmatter node expansion is admitted before parsing even for raw export', async () => {
  const { reader } = await fixture('---\nitems:\n' + '- 0\n'.repeat(10000) + '---\n');
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes - 512 * 1024); cleanup.push(held.release);
  const parse = vi.spyOn(FrontmatterHandler.prototype, 'parse');
  await expect(reader.read('Note.md', undefined, { decodeText: false }).then(() => 'unexpected success')).rejects.toThrow(/work memory budget/i);
  expect(parse).not.toHaveBeenCalled();
});

test('wide GFM table expansion is admitted before the Markdown AST allocation', async () => {
  const { reader } = await fixture('|' + 'a|'.repeat(2000) + '\n|' + '-|'.repeat(2000) + '\n');
  const held = derivedCacheBudget.reserveWork(derivedCacheBudget.maxWorkingBytes - 512 * 1024); cleanup.push(held.release);
  const parse = vi.fn(parseDocumentStructure);
  const index = new DocumentIndex(reader, undefined, { parse }); cleanup.push(() => index.close());
  await expect(index.load('Note.md').then(() => 'unexpected success')).rejects.toThrow(/work memory budget/i);
  expect(parse).not.toHaveBeenCalled();
});
