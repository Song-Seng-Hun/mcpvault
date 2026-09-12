import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { parseDocumentStructure } from './document-structure.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'document-coalescing-'));
  cleanup.push(() => rm(vault, { recursive: true, force: true }));
  await writeFile(join(vault, 'Note.md'), '# Topic\n\nEvidence needle.');
  const reader = new DocumentResourceReader(new FileSystemService(vault), new PathFilter(), new ScopeAccessPolicy());
  const parse = vi.fn(parseDocumentStructure), index = new DocumentIndex(reader, undefined, { parse });
  cleanup.push(async () => index.close());
  return { vault, reader, parse, index };
}

test('simultaneous authorized requests parse one exact document generation once', async () => {
  const f = await fixture();
  const reads = vi.spyOn(f.reader, 'read'), checks = vi.spyOn(f.reader, 'assertCurrent');
  const results = await Promise.all(Array.from({ length: 8 }, () => f.index.load('Note.md')));
  expect(results.every(item => item.structure.raw.includes('Evidence needle'))).toBe(true);
  expect(f.parse).toHaveBeenCalledTimes(1);
  // Pure parsing may be shared; every caller still has independent authorization and source validation.
  expect(reads).toHaveBeenCalledTimes(8); expect(checks).toHaveBeenCalledTimes(8);
});

test('a failed concurrent parse is not retained as a poisoned in-flight generation', async () => {
  const f = await fixture();
  f.parse.mockImplementationOnce(() => { throw new Error('Parser interrupted'); });
  await expect(f.index.load('Note.md')).rejects.toThrow('Parser interrupted');
  expect((await f.index.load('Note.md')).structure.raw).toContain('Evidence needle');
  expect(f.parse).toHaveBeenCalledTimes(2);
});

test('concurrent preparation cannot skip a callers final source authority check', async () => {
  const f = await fixture();
  const check = f.reader.assertCurrent.bind(f.reader);
  vi.spyOn(f.reader, 'assertCurrent').mockImplementation(async (snapshot, principal) => {
    if (principal?.accountId === 'revoked') throw new Error('Document authority revoked');
    return check(snapshot, principal);
  });
  const good = { accountId: 'allowed', modelId: 'test', agentId: 'reader', role: 'agent' as const };
  const results = await Promise.allSettled([f.index.load('Note.md', good), f.index.load('Note.md', { ...good, accountId: 'revoked' })]);
  expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected');
});
