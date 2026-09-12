import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readdir, rename, symlink, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';
import * as privacy from './skill-evolution-host.js';
import { parseDocumentStructure } from './document-structure.js';
import { derivedCacheBudget } from './cache-budget.js';
import { HostDerivedStorage } from './host-derived-storage.js';

const gate = vi.hoisted(() => ({ wait: undefined as Promise<void> | undefined, entered: undefined as (() => void) | undefined,
  root: '', scans: 0, publications: 0, partial: false, closeFails: false }));
vi.mock('node:fs/promises', async original => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real,
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      if (gate.partial && String(args[0]).endsWith('.tmp')) { await real.writeFile(args[0], 'partial', args[2]); throw new Error('Injected ENOSPC'); }
      return real.writeFile(...args);
    },
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args), write = handle.writeFile.bind(handle);
      if (String(args[0]).endsWith('.tmp')) handle.writeFile = async (...values: Parameters<typeof handle.writeFile>) => {
        if (gate.partial) { await write('partial'); throw new Error('Injected ENOSPC'); }
        return write(...values);
      };
      if (String(args[0]).endsWith('.tmp')) {
        const close = handle.close.bind(handle);
        handle.close = async () => { await close(); if (gate.closeFails) throw new Error('Injected close failure'); };
      }
      return handle;
    }, rename: async (...args: Parameters<typeof real.rename>) => {
    if (String(args[1]).endsWith('.structure.json.gz')) gate.publications++;
    if (String(args[1]).endsWith('.structure.json.gz') && gate.wait) { gate.entered?.(); await gate.wait; }
    return real.rename(...args);
  }, readdir: async (...args: any[]) => { if (String(args[0]) === gate.root) gate.scans++; return (real.readdir as any)(...args); },
  opendir: async (...args: any[]) => { if (String(args[0]) === gate.root) gate.scans++; return (real.opendir as any)(...args); } };
});
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { gate.wait = undefined; gate.entered = undefined; gate.root = ''; gate.scans = 0; gate.publications = 0; gate.partial = false; gate.closeFails = false;
  vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'document-persistence-'));
  cleanup.push(() => rm(vault, { recursive: true, force: true }));
  const host = await derivedStorageFixture(vault); cleanup.push(host.close);
  await writeFile(join(vault, 'Note.md'), '# Topic\n\nEvidence needle.');
  const reader = new DocumentResourceReader(new FileSystemService(vault), new PathFilter(), new ScopeAccessPolicy());
  const index = new DocumentIndex(reader, undefined, { cacheDir: host.host }); cleanup.push(async () => { await index.close(); });
  return { vault, host, reader, index };
}

test('optional disk publication does not block a verified document response', async () => {
  const f = await fixture();
  let release!: () => void, reached!: () => void;
  gate.wait = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { reached = resolve; }); gate.entered = reached;
  let completed = false;
  const response = f.index.load('Note.md').then(value => { completed = true; return value; });
  try {
    await entered;
    await vi.waitFor(() => expect(completed).toBe(true), { timeout: 1000 });
    expect((await response).structure.raw).toContain('Evidence needle');
  } finally { release(); await response; await (f.index as any).diskQueue; }
}, 30000);

test('unverifiable public derivative storage falls back to memory without any disk write', async () => {
  const f = await fixture();
  const verify = vi.spyOn(privacy, 'assertHostPrivateStorage').mockRejectedValue(new Error('Host private ACL unavailable'));
  expect((await f.index.load('Note.md')).structure.raw).toContain('Evidence needle');
  await (f.index as any).diskQueue;
  expect(verify).toHaveBeenCalled();
  expect((await readdir(f.host.host)).filter(name => name.endsWith('.gz'))).toEqual([]);
  expect(await readdir(f.vault)).toEqual(['Note.md']);
});

test('warm document persistence does not enumerate the cache directory after every save', async () => {
  const f = await fixture(); gate.root = f.host.host;
  for (let n = 0; n < 3; n++) {
    await writeFile(join(f.vault, 'Note.md'), `# Generation ${n}`);
    await f.index.load('Note.md'); await (f.index as any).diskQueue;
  }
  expect(gate.publications).toBe(3);
  expect(gate.scans).toBeLessThanOrEqual(1);
}, 30000);

test('blocked optional persistence retains at most four pending document generations', async () => {
  const f = await fixture();
  let release!: () => void, reached!: () => void;
  gate.wait = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { reached = resolve; }); gate.entered = reached;
  try {
    await f.index.load('Note.md'); await entered;
    for (let n = 0; n < 8; n++) {
      await writeFile(join(f.vault, `${n}.md`), `# Document ${n}`);
      expect((await f.index.load(`${n}.md`)).structure.raw).toContain(`Document ${n}`);
    }
  } finally { release(); await (f.index as any).diskQueue; }
  expect(gate.publications).toBeGreaterThan(0);
  expect(gate.publications).toBeLessThanOrEqual(4);
}, 30000);

test('only one live index writes a shared cache root and closing it releases the writer lease', async () => {
  const f = await fixture();
  const peer = new DocumentIndex(f.reader, undefined, { cacheDir: f.host.host });
  cleanup.push(() => peer.close());
  await f.index.load('Note.md'); await (f.index as any).diskQueue;
  await writeFile(join(f.vault, 'Peer.md'), '# Peer');
  expect((await peer.load('Peer.md')).structure.raw).toBe('# Peer');
  await (peer as any).diskQueue;
  expect(gate.publications).toBe(1);
  await f.index.close();
  await writeFile(join(f.vault, 'Peer.md'), '# Peer new generation');
  await peer.load('Peer.md'); await (peer as any).diskQueue;
  expect(gate.publications).toBe(2);
}, 30000);

test('a queued derivative is discarded when source admission is revoked before its turn', async () => {
  const f = await fixture();
  let release!: () => void;
  gate.wait = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { gate.entered = resolve; });
  try {
    await f.index.load('Note.md'); await entered;
    await writeFile(join(f.vault, 'Queued.md'), '# Queued private evidence');
    await f.index.load('Queued.md');
    const original = f.reader.filter.isAllowedForListing.bind(f.reader.filter);
    vi.spyOn(f.reader.filter, 'isAllowedForListing').mockImplementation(path => path !== 'Queued.md' && original(path));
  } finally { release(); await (f.index as any).diskQueue; }
  expect(gate.publications).toBe(1);
}, 30000);

test('pending metadata bytes, not only entry count, bound the optional persistence queue', async () => {
  const f = await fixture();
  // Real private-storage integration is covered above; avoid repeated OS ACL
  // subprocesses while testing serialization/queue arithmetic with large metadata.
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  const index = new DocumentIndex(f.reader, undefined, { cacheDir: f.host.host,
    parse: input => ({ ...parseDocumentStructure(input), title: 'T'.repeat(2_000_000) }) });
  cleanup.push(() => index.close());
  let release!: () => void;
  gate.wait = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { gate.entered = resolve; });
  try {
    await index.load('Note.md'); await entered;
    for (let n = 0; n < 3; n++) {
      await writeFile(join(f.vault, `${n}.md`), `# ${n}`);
      await index.load(`${n}.md`);
    }
  } finally { release(); await (index as any).diskQueue; }
  expect(gate.publications).toBe(2);
});

test('capacity ledger reconciles periodically while preserving foreign host files', async () => {
  const f = await fixture(); gate.root = f.host.host;
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  await writeFile(join(f.host.host, 'foreign.json'), 'host-owned');
  for (let n = 0; n < 65; n++) {
    await writeFile(join(f.vault, 'Note.md'), `# Generation ${n}`);
    await f.index.load('Note.md'); await (f.index as any).diskQueue;
  }
  expect(gate.publications).toBe(65);
  expect(gate.scans).toBe(2);
  expect(await import('node:fs/promises').then(fs => fs.readFile(join(f.host.host, 'foreign.json'), 'utf8'))).toBe('host-owned');
}, 30000);

test.each(['account', 'department'])('queued authorization pins the submitting principal rather than a mutable caller object: %s', async field => {
  const f = await fixture();
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  let revoked = false;
  const actor = { accountId: 'a', modelId: 'model', agentId: 'worker', role: 'agent' as const,
    enterprise: { mode: 'public' as const, realmId: 'realm', runtimeId: 'runtime', sharedMemoryEnabled: false, departmentIds: ['a'] } };
  const original = f.reader.access.canAccessPhysicalPath.bind(f.reader.access);
  vi.spyOn(f.reader.access, 'canAccessPhysicalPath').mockImplementation((path, principal) => original(path, principal)
    && (path !== 'Queued.md' || (field === 'account' ? principal?.accountId === 'b' : principal?.enterprise?.departmentIds?.includes('b')) || !revoked));
  let release!: () => void;
  gate.wait = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { gate.entered = resolve; });
  try {
    await f.index.load('Note.md', actor); await entered;
    await writeFile(join(f.vault, 'Queued.md'), '# Queued');
    await f.index.load('Queued.md', actor);
    revoked = true;
    if (field === 'account') actor.accountId = 'b'; else actor.enterprise.departmentIds[0] = 'b';
  } finally { release(); await (f.index as any).diskQueue; }
  expect(gate.publications).toBe(1);
});

test('queued publication refuses a source ancestor replaced by a junction', async () => {
  const f = await fixture();
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  let release!: () => void;
  gate.wait = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { gate.entered = resolve; });
  try {
    await f.index.load('Note.md'); await entered;
    await mkdir(join(f.vault, 'Folder'));
    await writeFile(join(f.vault, 'Folder/Queued.md'), '# Queued');
    await f.index.load('Folder/Queued.md');
    await rename(join(f.vault, 'Folder'), join(f.vault, 'OldFolder'));
    await symlink(join(f.vault, 'OldFolder'), join(f.vault, 'Folder'), process.platform === 'win32' ? 'junction' : 'dir');
  } finally { release(); await (f.index as any).diskQueue; }
  expect(gate.publications).toBe(1);
});

test('a failed post-publication check cannot leave the capacity ledger undercounting', async () => {
  const f = await fixture();
  let failed = false;
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockImplementation(async paths => {
    if (!failed && gate.publications === 1 && paths.some(path => path.endsWith('.structure.json.gz'))) {
      failed = true; throw new Error('temporary private ACL verification failure');
    }
  });
  const names = Array.from({ length: 511 }, (_, n) => n.toString(16).padStart(64, '0') + '.structure.json.gz');
  await Promise.all(names.map(name => writeFile(join(f.host.host, name), 'old')));
  await writeFile(join(f.host.host, 'foreign.json'), 'host-owned');
  await f.index.load('Note.md'); await (f.index as any).diskQueue;
  await writeFile(join(f.vault, 'Next.md'), '# Next');
  await f.index.load('Next.md'); await (f.index as any).diskQueue;
  expect(failed).toBe(true);
  expect((await readdir(f.host.host)).filter(name => name.endsWith('.structure.json.gz'))).toHaveLength(512);
  expect(await readFile(join(f.host.host, 'foreign.json'), 'utf8')).toBe('host-owned');
}, 30000);

test.each(['abandoned', 'replaced'])('an unowned cache writer lock survives index close: %s', async kind => {
  const f = await fixture();
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  const lock = join(f.host.host, 'document-cache.writer.lock');
  if (kind === 'replaced') {
    await f.index.load('Note.md'); await (f.index as any).diskQueue;
    await rename(lock, join(f.host.host, 'abandoned-host.lock'));
  }
  await writeFile(lock, 'host-owned lock');
  await writeFile(join(f.vault, 'Next.md'), '# Next');
  await f.index.load('Next.md'); await f.index.close();
  expect(gate.publications).toBe(kind === 'replaced' ? 1 : 0);
  expect(await readFile(lock, 'utf8')).toBe('host-owned lock');
});

test('a blocked persistence queue remains charged after its document response completes', async () => {
  const f = await fixture();
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  let release!: () => void;
  gate.wait = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { gate.entered = resolve; });
  try {
    await f.index.load('Note.md'); await entered;
    expect(derivedCacheBudget.workSnapshot().activeBytes).toBeGreaterThan(0);
  } finally { release(); await (f.index as any).diskQueue; }
  expect(derivedCacheBudget.workSnapshot().activeBytes).toBe(0);
});

test('a partially written owned temporary is removed when writing fails', async () => {
  const f = await fixture();
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  gate.partial = true;
  await f.index.load('Note.md'); await (f.index as any).diskQueue;
  expect((await readdir(f.host.host)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  expect(gate.publications).toBe(0);
});

test('private storage is checked after the publication source hook before writing any derived bytes', async () => {
  const f = await fixture();
  let revoked = false;
  const realGuard = (f.index as any).publicationGuard.bind(f.index);
  vi.spyOn(f.index as any, 'publicationGuard').mockImplementation((...args: any[]) => {
    const guard = realGuard(...args); let calls = 0;
    const wrapped = async () => { await (typeof guard === 'function' ? guard() : guard.refresh()); if (++calls === 2) revoked = true; };
    return typeof guard === 'function' ? wrapped : { ...guard, refresh: wrapped };
  });
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockImplementation(async () => { if (revoked) throw new Error('private ACL revoked'); });
  await f.index.load('Note.md'); await (f.index as any).diskQueue;
  expect(revoked).toBe(true);
  expect((await readdir(f.host.host)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});

test.each(['bytes', 'gzip'])('host snapshots clean up owned partial files without publishing: %s', async kind => {
  const f = await fixture();
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  const store = new HostDerivedStorage(f.vault, f.host.host);
  gate.partial = kind === 'bytes';
  function* interrupted() { yield 'payload'; throw new Error('Injected source interruption'); }
  await expect(kind === 'bytes' ? store.write('state.bin', Buffer.from('payload'), 100)
    : store.writeGzip('state.gz', interrupted(), { maxBytes: 100, maxDecodedBytes: 100 })).rejects.toThrow();
  expect(await readdir(f.host.path(''))).toEqual([]);
});

test('a close failure cannot leak queued work memory or poison later persistence', async () => {
  const f = await fixture();
  vi.spyOn(privacy, 'assertHostPrivateStorage').mockResolvedValue(undefined);
  gate.closeFails = true;
  await f.index.load('Note.md'); await (f.index as any).diskQueue.catch(() => undefined);
  expect(derivedCacheBudget.workSnapshot().activeBytes).toBe(0);
  expect((f.index as any).pendingDiskKeys.size).toBe(0);
  gate.closeFails = false;
  await writeFile(join(f.vault, 'Next.md'), '# Next');
  await f.index.load('Next.md'); await (f.index as any).diskQueue;
  expect(gate.publications).toBe(2);
});
