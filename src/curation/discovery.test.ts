import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileSystemService } from '../filesystem.js';
import { ScopeAccessPolicy } from '../scope-access.js';
import { DiskMemoryIndex } from '../memory/read-index.js';
import { EvolutionService } from '../evolution/service.js';
import { hash } from '../evolution/policy.js';
import { CurationService } from './service.js';
import type { EvolutionConfig } from '../evolution/model.js';
import { curationActor, curationDocument } from './delivery.js';

const roots: string[] = [], indexes: DiskMemoryIndex[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const s of indexes.splice(0)) await s.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup(options: { write?: boolean; readOnly?: boolean; managed?: boolean; grant?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'curation-discovery-')); roots.push(root);
  const vault = join(root, 'vault'), cache = join(root, 'cache'); await mkdir(vault); await mkdir(cache, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [cache, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const index = new DiskMemoryIndex(fs, cache, () => true); indexes.push(index);
  const config: EvolutionConfig = { version: 1, enabled: true, ...(options.grant && { curation: [
    { accountId: 'reader', paths: ['A.md'], operations: ['deduplicate_relations'] }] }) }; let allowed = true;
  const principal: any = { accountId: 'reader', modelId: 'test', capabilities: options.write ? ['read', 'write'] : ['read'] };
  const values = new Map<string, any>();
  const storage: any = { refresh: async () => config, records: { read: async (key: string) => ({ value: values.get(key), revision: values.has(key) ? hash(values.get(key)) : 'missing' }) } };
  const managedProof = vi.fn(async () => options.managed ? hash('receipt') : undefined);
  const readOnly = options.readOnly ?? !options.write;
  const curation = new CurationService({ fs, access, config: async () => config, readIndex: index, readOnly, managedProof });
  const service = new EvolutionService({ storage, curation, readOnly, authority: async () => ({ ownerId: 'reader', sharedOwner: false,
    revision: 'current', assertCurrent: async () => { if (!allowed) throw Error('revoked'); } }) });
  const add = (path: string, text = '# Conditions\nOnly while enabled.', fm: Record<string, unknown> = {}) => fs.writeNote({ path, content: text,
    frontmatter: { llm_wiki_type: 'knowledge', related: ['[[Target]]', '[[Target]]'], ...fm } });
  const call = (args: any = {}, who = principal) => service.execute('cycle', { kind: 'curation', op: 'list', ...args }, who);
  return { fs, index, access, add, call, principal, config, managedProof, revoke: () => { allowed = false; } };
}

test('only current exact host grants and managed receipts expose a bounded execution action', async () => {
  const f = await setup({ write: true, managed: true, grant: true }); await f.add('A.md'); await f.add('B.md'); await f.index.start();
  const r = await f.call();
  expect(r.candidates[0].nextAction).toMatchObject({ endpointId: 'evolution.cycle', arguments: {
    kind: 'curation', op: 'advance', operation: 'deduplicate_relations', path: 'A.md', expectedRevision: 'missing',
    sourceRevision: await f.fs.readNoteRevision('A.md') } });
  expect(r.candidates[0]).toMatchObject({ automaticApplication: false, execution: 'validation_required' });
  expect(r.candidates[1].nextAction.endpointId).toBe('notes.read');
  expect((await f.call()).candidates[0].nextAction).toEqual(r.candidates[0].nextAction);
  f.config.curation = [];
  expect((await f.call()).candidates[0].nextAction.endpointId).toBe('notes.read');
});

test.each([{ write: true, readOnly: true }, { write: false }, { write: true, managed: false }])(
  'read-only, missing write capability or absent receipts cannot expose advance: %j', async options => {
    const f = await setup({ managed: true, grant: true, ...options }); await f.add('A.md'); await f.index.start();
    expect((await f.call()).candidates[0].nextAction.endpointId).toBe('notes.read');
  });

test('discovery refuses a managed receipt withdrawn before return', async () => {
  const f = await setup({ managed: true }); await f.add('A.md'); await f.index.start();
  f.managedProof.mockResolvedValueOnce(hash('receipt')).mockResolvedValue(undefined);
  await expect(f.call()).rejects.toThrow();
});

test('candidate delivery history is positive, revision-aware and never proof of disuse or actual use', async () => {
  const f = await setup(); await f.add('A.md'); await f.index.start();
  const revision = await f.fs.readNoteRevision('A.md');
  await f.index.recordCurationDelivery({ actor: curationActor('reader'), eventId: hash('read-event'), observedAt: 1000,
    documents: [{ document: curationDocument('A.md'), revision }] });
  const first = (await f.call()).candidates[0];
  expect(first.usage).toEqual({ coverage: 'observed_requests_only', serverResultAt: 1000, revision,
    matchesCurrentRevision: true, actualUse: 'unknown' });
  expect((await f.call({}, { ...f.principal, accountId: 'different' })).candidates[0].usage).toEqual({ coverage: 'unknown' });
  await f.add('A.md', 'Current manual edit.'); await f.index.invalidate([{ path: 'A.md', kind: 'upsert' }]);
  expect((await f.call()).candidates[0].usage.matchesCurrentRevision).toBe(false);
  expect((await f.call()).candidates[0].nextAction.endpointId).toBe('notes.read');
});

test('read-only discovery exposes current candidates without treating authored metadata as managed proof', async () => {
  const f = await setup(); await f.add('A.md', undefined, { managed: true }); await f.index.start();
  const r = await f.call();
  expect(r.candidates).toHaveLength(1);
  expect(r.candidates[0]).toMatchObject({ kind: 'relations', path: 'A.md', managed: false, automaticApplication: false });
  expect(r.candidates[0].sourceRevision).toBe(await f.fs.readNoteRevision('A.md'));
  expect(r.effectVerified).toBe(false); expect(r.usage.coverage).toBe('unknown');
});

test('hidden group members never make a visible singleton look like a duplicate', async () => {
  const f = await setup(); await f.add('A.md'); await f.add('Hidden.md'); await f.index.start();
  vi.spyOn(f.access, 'canAccessPhysicalPath').mockImplementation(path => path !== 'Hidden.md');
  const r = await f.call({ candidateKind: 'duplicate_content' });
  expect(r.candidates).toEqual([]); expect(JSON.stringify(r)).not.toContain('Hidden'); expect(r).not.toHaveProperty('total');
});

test('opaque continuation is account-bound and invalidated by revision/index changes', async () => {
  const f = await setup(); await f.add('A.md'); await f.add('B.md'); await f.index.start();
  const first = await f.call({ limit: 1 });
  expect(first.candidates.map((c: any) => c.path)).toEqual(['A.md']);
  expect(first.nextAction.arguments.cursor).toMatch(/^[a-f0-9-]{36}$/);
  const next = await f.call(first.nextAction.arguments); expect(next.candidates.map((c: any) => c.path)).toEqual(['B.md']);
  await expect(f.call(first.nextAction.arguments, { ...f.principal, accountId: 'different' })).rejects.toThrow();
  await f.add('B.md', 'Changed.'); await f.index.invalidate([{ path: 'B.md', kind: 'upsert' }]);
  await expect(f.call(first.nextAction.arguments)).rejects.toThrow();
});

test('unavailable indexes and current body drift are partial, not proof that nothing needs review', async () => {
  const f = await setup(); await f.add('A.md');
  expect(await f.call()).toMatchObject({ partial: true, candidates: [] });
  await f.index.start(); await f.add('A.md', 'Manual edit.');
  const r = await f.call(); expect(r.partial).toBe(true); expect(r.candidates).toEqual([]);
  f.revoke(); await expect(f.call()).rejects.toThrow();
});

test('small packets paginate actual returned candidates without embedding raw metadata or source text', async () => {
  const f = await setup(); for (let i = 0; i < 5; i++) await f.add(`N${i}.md`, 'Do not copy this source into a discovery card.');
  await f.index.start(); const r = await f.call({ maxChars: 1000, limit: 5 });
  expect(JSON.stringify(r).length).toBeLessThanOrEqual(1000); expect(r.candidates.length).toBeGreaterThan(0);
  expect(r.partial).toBe(true); expect(JSON.stringify(r)).not.toContain('Do not copy');
  const next = await f.call(r.nextAction.arguments); expect(next.candidates[0].path).not.toBe(r.candidates[0].path);
});

test('a card that exceeds remaining space is deferred without repeatedly rereading it', async () => {
  const f = await setup(); const longPath = 'Z'.repeat(150) + '.md'; await f.add('A.md'); await f.add(longPath); await f.index.start();
  const reads = vi.spyOn(f.fs, 'readNote'); const r = await f.call({ maxChars: 1000, limit: 5 });
  expect(r.candidates[0].path).toBe('A.md');
  expect(reads.mock.calls.filter(c => c[0] === longPath).length).toBeLessThanOrEqual(2);
  expect(r.nextAction).not.toBeNull();
});
