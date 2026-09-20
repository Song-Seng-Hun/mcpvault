import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, rename } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileSystemService } from '../filesystem.js';
import { ScopeAccessPolicy } from '../scope-access.js';
import { LayeredMemoryService } from '../layered-memory.js';
import { RetrievalService } from '../retrieval-service.js';
import { DiskMemoryIndex } from './read-index.js';
import { withEnterpriseStorageContext } from '../enterprise-storage-context.js';
const roots: string[] = [], indexes: DiskMemoryIndex[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const i of indexes.splice(0)) await i.close(); for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'memory-disk-read-')); roots.push(root);
  const vault = join(root, 'vault'), host = join(root, 'private'); await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const index = new DiskMemoryIndex(fs, host, () => true); indexes.push(index);
  // Real disk lexical candidates must bypass the legacy whole-vault search index.
  const retrieval = new RetrievalService({ memoryCandidates() { throw Error('Legacy search must not run'); } } as any, {} as any, {} as any, access, fs);
  const memory = new LayeredMemoryService(fs, retrieval, access, index);
  return { fs, index, memory };
}
test('disk memory serves current excerpts without queryNotes inventory; out-of-prefix correction hides the old interpretation', async () => {
  const { fs, index, memory } = await setup();
  await fs.writeNote({ path: 'A/old.md', content: 'NAS old claim', frontmatter: { memory_role: 'episodic' } });
  await fs.writeNote({ path: 'Else/new.md', content: 'new claim', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'A/old.md' }] } });
  await index.start(); const inventory = vi.spyOn(fs, 'queryNotes');
  const reply = await memory.read('recall', { scope: 'global', query: 'NAS', semantic: false, maxChars: 12000 });
  expect(reply.items.map((n: any) => n.path)).toEqual(['Else/new.md']); expect(inventory).not.toHaveBeenCalled();
  const scoped = await memory.read('recall', { scope: 'global', pathPrefix: 'A', query: 'NAS', semantic: false });
  expect(scoped.status).toBe('partial'); expect(scoped.items).toEqual([]);
}, 30000);
test('preparing storage fails partial without a foreground scan; revocation fences already captured candidates', async () => {
  const { fs, index, memory } = await setup();
  const inventory = vi.spyOn(fs, 'queryNotes'); const cold = await memory.read('brief', { scope: 'global' });
  expect(cold.status).toBe('partial'); expect(inventory).not.toHaveBeenCalled();
  const small = await memory.read('recall', { scope: 'global', query: '가'.repeat(1000), maxChars: 1000 });
  expect(JSON.stringify(small).length).toBeLessThanOrEqual(1000);
  await fs.writeNote({ path: 'A/one.md', content: '배포', frontmatter: { memory_role: 'episodic' } }); await index.start();
  let allowed = true; const view = await index.capture({ root: '', prefix: '', query: '배포', canAccess: () => allowed });
  expect(view.notes).toHaveLength(1); allowed = false; await expect(view.assertCurrent()).rejects.toThrow();
}, 30000);

test('events coalesce, new corrections invalidate an old capture, and NAS loss is not deletion', async () => {
  const { fs, index } = await setup();
  await fs.writeNote({ path: 'A/old.md', content: '배포', frontmatter: { memory_role: 'episodic' } }); await index.start();
  const p = { root: '', prefix: '', query: '배포', canAccess: () => true };
  const before = await index.capture(p), reads = vi.spyOn(fs, 'readNoteMetadata');
  await Promise.all(Array.from({ length: 40 }, () => index.invalidate([{ path: 'A/old.md', kind: 'upsert' }])));
  expect(reads).toHaveBeenCalledTimes(1);
  await index.invalidate([]); expect((await index.capture(p)).reason).toBeUndefined();
  await fs.writeNote({ path: 'A/new.md', content: 'new', frontmatter: { memory_role: 'semantic', memory_corrects: [{ path: 'A/OLD.md' }] } });
  await index.invalidate([{ path: 'A/new.md', kind: 'upsert' }]); await expect(before.assertCurrent()).rejects.toThrow();
  expect((await index.capture(p)).notes.map(n => n.path)).toContain('A/new.md');
  const vault = fs.getVaultPath(); await rename(vault, vault + '-offline');
  try {
    await index.invalidate([{ path: 'A/old.md', kind: 'delete' }]);
    expect((await index.capture(p)).reason).toContain('unavailable');
  } finally { await rename(vault + '-offline', vault); }
  await index.start(); expect((await index.capture(p)).notes.map(n => n.path)).toContain('A/old.md');
}, 30000);

test('background scan overlaps bounded source reads instead of serial NAS round trips', async () => {
  const { fs, index } = await setup();
  for (let i = 0; i < 24; i++) await fs.writeNote({ path: `A/${i}.md`, content: 'event', frontmatter: { memory_role: 'episodic' } });
  let active = 0, peak = 0;
  const read = fs.readNoteMetadata.bind(fs);
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    active++; peak = Math.max(peak, active);
    try { await new Promise(r => setTimeout(r, 20)); return await read(...args); }
    finally { active--; }
  });
  await index.start();
  expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(8); expect(active).toBe(0);
  expect((await index.capture({ root: '', prefix: '', query: 'event', canAccess: () => true })).notes).toHaveLength(24);
}, 30000);

test('shutdown interrupts a directory scan before reading another document or sweeping rows', async () => {
  const { fs, index } = await setup();
  for (const name of ['one', 'two', 'three']) await fs.writeNote({ path: `A/${name}.md`, content: name, frontmatter: { memory_role: 'episodic' } });
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const read = fs.readNoteMetadata.bind(fs);
  const reads = vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => { entered(); await wait; return read(...args); });
  const scan = index.start(); await started; const dispatched = reads.mock.calls.length;
  const close = index.close(); release(); await scan; await close;
  expect(dispatched).toBeLessThanOrEqual(8); expect(reads).toHaveBeenCalledTimes(dispatched);
}, 30000);

test('failed parallel scan drains owned reads and does not publish a partial index', async () => {
  const { fs, index } = await setup();
  for (const name of ['one', 'two', 'three']) await fs.writeNote({ path: `A/${name}.md`, content: 'event', frontmatter: { memory_role: 'episodic' } });
  let release!: () => void, entered!: () => void, settled = false;
  const held = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const read = fs.readNoteMetadata.bind(fs);
  const spy = vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    if (args[0][0] === 'A/one.md') throw Error('NAS unavailable');
    entered(); await held; return read(...args);
  });
  const scan = index.start().then(() => { settled = true; }); await started;
  await new Promise(r => setTimeout(r, 20)); expect(settled).toBe(false);
  release(); await scan;
  const request = { root: '', prefix: '', query: 'event', canAccess: () => true };
  expect((await index.capture(request)).reason).toBe('memory_index_unavailable');
  spy.mockRestore(); await index.start(); expect((await index.capture(request)).notes).toHaveLength(3);
}, 30000);

test('semantic contextual candidates are independent of literals; exposure is separate from delivery', async () => {
  const { fs, index, memory } = await setup();
  await fs.writeNote({ path: 'A/event.md', content: 'Only if enabled: 정확한 조건. '.repeat(20), frontmatter: { memory_role: 'episodic' } }); await index.start();
  const view = await index.capture({ root: '', prefix: '', query: 'incident', semantic: true, canAccess: () => true });
  expect(view.notes.map(n => n.path)).toEqual(['A/event.md']); expect(view.candidatePaths.size).toBe(0);
  const principal: any = { accountId: 'a', agentId: 'one', sessionId: 'real-auth-session', sessionGeneration: 1 };
  const args = { scope: 'global' as const, semantic: false, principal, maxChars: 12000 };
  const first = await memory.read('recall', args), reuse = { mode: 'if_retained' as const, knownReads: [first.deliveryReceipt] };
  expect((await memory.read('recall', { ...args, reuse })).items[0].excerpt).not.toBeNull();
  memory.exposure.confirm(principal, first.deliveryReceipt, 'host-context-one');
  expect((await memory.read('recall', { ...args, reuse })).items[0].excerpt).toBeNull();
  await fs.writeNote({ path: 'A/new.md', content: 'Counterexample.', frontmatter: { memory_role: 'episodic' } });
  await index.invalidate([{ path: 'A/new.md', kind: 'upsert' }]);
  expect((await memory.read('recall', { ...args, reuse })).items[0].excerpt).not.toBeNull();
}, 30000);

test('host-owned indexing does not inherit a completed request lifetime', async () => {
  const { fs, index, memory } = await setup();
  await fs.writeNote({ path: 'A/event.md', content: 'previous', frontmatter: { memory_role: 'episodic' } });
  await index.start();
  await fs.writeNote({ path: 'A/event.md', content: 'current condition', frontmatter: { memory_role: 'episodic' } });
  let release!: () => void, entered!: () => void, active = true;
  const wait = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const read = fs.readNoteMetadata.bind(fs);
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => { entered(); await wait; return read(...args); });
  const access = new ScopeAccessPolicy({ documentRules: () => [{ path: 'Protected.md', accountIds: ['owner'] }] });
  const change = withEnterpriseStorageContext({ access, assertFresh: () => { if (!active) throw Error('Request ended'); } },
    () => index.invalidate([{ path: 'A/event.md', kind: 'upsert' }]));
  await started; active = false; release(); await change;
  const result = await memory.read('recall', { scope: 'global', semantic: false });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].excerpt.text).toBe('current condition');
}, 30000);

test('index owner construction restrictions are preserved instead of cleared', async () => {
  const access = new ScopeAccessPolicy();
  const { fs, index, memory } = await withEnterpriseStorageContext({ access, assertFresh() {}, canAccessPath: () => false }, setup);
  await fs.writeNote({ path: 'A/event.md', content: 'Not granted to this index owner', frontmatter: { memory_role: 'episodic' } });
  await index.start();
  const result = await memory.read('recall', { scope: 'global', semantic: false });
  expect(result.status).toBe('partial'); expect(result.items).toEqual([]);
}, 30000);

test('background graph indexing covers ordinary knowledge without injecting it into memory results', async () => {
  const { fs, index } = await setup();
  await fs.writeNote({ path: 'Knowledge.md', content: '[[Target]]', frontmatter: { llm_wiki_type: 'knowledge' } });
  await fs.writeNote({ path: 'Memory.md', content: 'event', frontmatter: { memory_role: 'episodic' } });
  await index.start();
  const store = (index as any).store;
  expect((await store.graph({ direction: 'incoming', keys: ['target'], limit: 20 })).occurrences).toHaveLength(1);
  expect((await index.capture({ root: '', prefix: '', query: '', canAccess: () => true })).notes.map(n => n.path)).toEqual(['Memory.md']);
  await fs.writeNote({ path: 'Knowledge.md', content: '[[Changed]]', frontmatter: { llm_wiki_type: 'knowledge' } });
  await index.invalidate([{ path: 'Knowledge.md', kind: 'upsert' }]);
  expect((await store.graph({ direction: 'incoming', keys: ['target'], limit: 20 })).occurrences).toHaveLength(0);
  expect((await store.graph({ direction: 'incoming', keys: ['changed'], limit: 20 })).occurrences).toHaveLength(1);
}, 30000);
