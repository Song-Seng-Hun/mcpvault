import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { DocumentSearch } from './document-search.js';
import { parseDocumentStructure } from './document-structure.js';
import * as privacy from './skill-evolution-host.js';

const roots: string[] = [], indexes: DocumentIndex[] = [];
const actor = { accountId: 'local', agentId: 'worker', modelId: 'model', role: 'agent' as const };
afterEach(async () => { for (const index of indexes.splice(0)) await index.close(); vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(disk: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'confidential-index-')), cache = await mkdtemp(join(tmpdir(), 'private-index-cache-')); roots.push(root, cache);
  await writeFile(join(root, 'Secret.md'), '# PRIVATE_TITLE\n\nPRIVATE_BODY');
  const reader = new DocumentResourceReader(new FileSystemService(root), new PathFilter(), new ScopeAccessPolicy({
    documentRules: () => [{ path: 'Secret.md', confidential: true }], localInferenceAllowed: principal => principal.accountId === 'local',
  }));
  const parse = vi.fn(parseDocumentStructure), read = vi.spyOn(reader, 'read');
  const index = new DocumentIndex(reader, undefined, { ...(disk && { cacheDir: cache }), parse }); indexes.push(index);
  return { index, parse, read, cache };
}

test('confidential parsing requires a provisioned private host derivative directory before reading bytes', async () => {
  const { index, parse, read } = await fixture(false);
  await expect(index.load('Secret.md', actor)).rejects.toThrow(/private|provision|host/i);
  expect(read).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
});

test('an ACL verification failure blocks confidential parsing instead of becoming a public cache fallback', async () => {
  const verify = vi.spyOn(privacy, 'assertHostPrivateStorage').mockRejectedValue(Error('private ACL verification refused'));
  const { index, parse, read } = await fixture(true);
  await expect(index.load('Secret.md', actor)).rejects.toThrow(/private|ACL/i);
  expect(verify).toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
});

test('warm confidential parsing rechecks private storage and never grants another caller cache access', async () => {
  const verify = vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue();
  const { index, parse, read } = await fixture(true);
  expect((await index.load('Secret.md', actor)).structure.raw).toContain('PRIVATE_BODY');
  const count = read.mock.calls.length;
  verify.mockRejectedValue(Error('private ACL revoked'));
  await expect(index.load('Secret.md', actor)).rejects.toThrow(/private|ACL/i);
  expect(read).toHaveBeenCalledTimes(count); expect(parse).toHaveBeenCalledTimes(1);
  await expect(index.load('Secret.md', { ...actor, accountId: 'remote' })).rejects.toThrow(/unavailable|denied/i);
  expect(read).toHaveBeenCalledTimes(count);
});

test('confidential restored-file privacy failure is not swallowed as a public cache miss', async () => {
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue();
  const { index, parse } = await fixture(true);
  await index.load('Secret.md', actor); await (index as any).diskQueue; index.invalidate();
  let fileChecks = 0;
  const real = (index as any).assertPrivateCache.bind(index);
  vi.spyOn(index as any, 'assertPrivateCache').mockImplementation(async (file: unknown) => {
    if (typeof file === 'string' && file.endsWith('.structure.json.gz') && ++fileChecks === 3) throw new Error('private file ACL revoked');
    return real(file);
  });
  await expect(index.load('Secret.md', actor)).rejects.toThrow(/private|ACL/i);
  expect(fileChecks).toBe(3); expect(parse).toHaveBeenCalledTimes(1);
});

test('a hot confidential structure still verifies its existing persisted file privacy', async () => {
  const verify = vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue();
  const { index, parse } = await fixture(true);
  await index.load('Secret.md', actor); await (index as any).diskQueue;
  verify.mockImplementation(async paths => { if (paths.some(path => path.endsWith('.structure.json.gz'))) throw new Error('private file ACL revoked'); });
  await expect(index.load('Secret.md', actor)).rejects.toThrow(/private|ACL/i);
  expect(parse).toHaveBeenCalledTimes(1);
});

test('metadata-only cached pages verify the persisted confidential file ACL without loading bodies', async () => {
  const verify = vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue();
  const { index } = await fixture(true);
  await writeFile(join(index.reader.fs.getVaultPath(), 'Secret.md'), 'PRIVATE one\n\nPRIVATE two\n\nPRIVATE three');
  const search = new DocumentSearch(index);
  try {
    const first = await search.search({ query: 'PRIVATE', path: 'Secret.md', principal: actor, limit: 1 });
    await (index as any).diskQueue;
    const load = vi.spyOn(index, 'load');
    await search.search({ query: 'PRIVATE', path: 'Secret.md', principal: actor, limit: 1, cursor: first.cursor });
    expect(load).not.toHaveBeenCalled();
    verify.mockImplementation(async paths => { if (paths.some(path => path.endsWith('.structure.json.gz'))) throw new Error('private file ACL revoked'); });
    await expect(search.search({ query: 'PRIVATE', path: 'Secret.md', principal: actor, limit: 1, cursor: first.cursor })).rejects.toThrow(/ACL/i);
    expect(load).not.toHaveBeenCalled();
  } finally { search.close(); }
});

test('cached confidential pages catch NAS edits during their final privacy check', async () => {
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue();
  const { index } = await fixture(true);
  await writeFile(join(index.reader.fs.getVaultPath(), 'Secret.md'), 'PRIVATE one\n\nPRIVATE two');
  const search = new DocumentSearch(index);
  try {
    const first = await search.search({ query: 'PRIVATE', path: 'Secret.md', principal: actor, limit: 1 });
    await (index as any).diskQueue;
    let injected = false;
    vi.spyOn(privacy, 'assertHostPrivateStorage').mockImplementation(async paths => {
      if (!injected && paths.some(path => path.endsWith('.structure.json.gz'))) {
        injected = true; await writeFile(join(index.reader.fs.getVaultPath(), 'Secret.md'), 'Changed generation');
      }
    });
    await expect(search.search({ query: 'PRIVATE', path: 'Secret.md', principal: actor, limit: 1, cursor: first.cursor })).rejects.toThrow(/revision|changed/i);
    expect(injected).toBe(true);
  } finally { search.close(); }
});

test.each(['edit', 'revoke'] as const)('a confidential source changed during post-read privacy verification is rejected: %s', async change => {
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue();
  const { index } = await fixture(true);
  await index.load('Secret.md', actor); await (index as any).diskQueue;
  let readFinished = false, injected = false;
  vi.spyOn(index.reader, 'read').mockImplementation(async (...args) => {
    const value = await DocumentResourceReader.prototype.read.apply(index.reader, args); readFinished = true; return value;
  });
  const verify = (index as any).assertPrivateCache.bind(index);
  vi.spyOn(index as any, 'assertPrivateCache').mockImplementation(async (...args: any[]) => {
    await verify(...args);
    if (readFinished && !injected) {
      injected = true;
      if (change === 'edit') await writeFile(join(index.reader.fs.getVaultPath(), 'Secret.md'), '# Changed generation');
      else vi.spyOn(index.reader.access, 'canAccessPhysicalPath').mockReturnValue(false);
    }
  });
  await expect(index.load('Secret.md', actor)).rejects.toThrow(/unavailable|denied|revision|changed/i);
  expect(injected).toBe(true);
});
