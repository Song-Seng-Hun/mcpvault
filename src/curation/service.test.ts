import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from '../filesystem.js';
import { ScopeAccessPolicy } from '../scope-access.js';
import { EvolutionService } from '../evolution/service.js';
import { hash } from '../evolution/policy.js';
import { CurationService } from './service.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(frontmatter: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'curation-run-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  await fs.writeNote({ path: 'A.md', content: '# A\nOnly if enabled. Never delete originals. ^condition',
    frontmatter: { llm_wiki_type: 'knowledge', contrasts_with: ['[[B]]', '[[B]]'], related: ['[[B|Choice]]', '[[B]]'], ...frontmatter } });
  await fs.writeNote({ path: 'B.md', content: '# B\nAlternative.' });
  const initial = await fs.readNote('A.md');
  const values = new Map<string, any>(); let held = false, allowed = true, managed = true, failSave = false;
  const principal: any = { accountId: 'operator', modelId: 'test', capabilities: ['write'] };
  const config: any = { version: 1, enabled: true, curation: [{ accountId: 'operator', paths: ['A.md'], operations: ['deduplicate_relations'] }] };
  const storage: any = { refresh: async () => structuredClone(config), acquire: async () => {
    if (held) throw Error('busy'); held = true; return { assertHeld: async () => { if (!held) throw Error('lost'); }, close: async () => { held = false; } };
  }, records: { read: async (key: string) => ({ revision: values.has(key) ? hash(values.get(key)) : 'missing', value: structuredClone(values.get(key)) }),
    write: async (key: string, value: any, expected: string, current?: () => Promise<void>) => {
      await current?.(); if (!held || expected !== (values.has(key) ? hash(values.get(key)) : 'missing')) throw Error('conflict');
      if (failSave && value.state === 'applied') { failSave = false; throw Error('receipt interrupted'); }
      values.set(key, structuredClone(value)); return { revision: hash(value) };
    } } };
  const curation = new CurationService({ fs, access, config: () => storage.refresh(),
    managedProof: async (path: string, revision: string) => managed && path === 'A.md' && revision === initial.revision ? hash(['managed', path, revision]) : undefined });
  const options: any = { storage, curation, authority: async () => ({ ownerId: 'operator', sharedOwner: false, revision: 'authority', assertCurrent: async () => { if (!allowed) throw Error('revoked'); } }) };
  let service = new EvolutionService(options);
  const call = (args: any) => service.execute('cycle', { kind: 'curation', ...args }, principal);
  const prepare = () => call({ op: 'prepare', cycleId: 'cleanup', requestId: 'prepare', expectedRevision: 'missing',
    operation: 'deduplicate_relations', path: 'A.md', sourceRevision: initial.revision });
  return { fs, initial, config, call, prepare, values, options, principal,
    restart: () => { service = new EvolutionService(options); }, revoke: () => { allowed = false; }, unmanage: () => { managed = false; }, interrupt: () => { failSave = true; } };
}

test('managed cleanup previews, applies, rereads and restores exact original bytes through evolution', async () => {
  const f = await fixture(), plan = await f.prepare();
  expect(plan.status).toBe('prepared'); expect(plan.removedOccurrences).toBe(1);
  const done = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'apply', expectedRevision: plan.revision, fingerprint: plan.fingerprint });
  expect(done.status).toBe('applied'); expect(done.effectVerified).toBe(false);
  const note = await f.fs.readNote('A.md'); expect(note.content).toBe(f.initial.content);
  expect(note.frontmatter.contrasts_with).toEqual(['[[B]]']); expect(note.frontmatter.related).toEqual(['[[B|Choice]]', '[[B]]']);
  const repeat = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'apply', expectedRevision: plan.revision, fingerprint: plan.fingerprint });
  expect(repeat).toEqual(done);
  const undo = await f.call({ op: 'revert', cycleId: 'cleanup', requestId: 'undo', expectedRevision: done.revision });
  expect(undo.status).toBe('withdrawn'); expect((await f.fs.readNote('A.md')).originalContent).toBe(f.initial.originalContent);
});

test('unmanaged or ungranted documents cannot acquire automatic ownership', async () => {
  const f = await fixture(); f.unmanage();
  expect(await f.prepare()).toMatchObject({ status: 'review_required', reason: 'managed_receipt_required' });
  f.config.curation = [];
  expect(await f.prepare()).toMatchObject({ status: 'diagnostic_only', reason: 'curation_grant_required' });
  expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
});

test('manual edits, grant withdrawal and authority revocation stop application', async () => {
  for (const change of ['manual', 'grant', 'authority']) {
    const f = await fixture(), p = await f.prepare();
    if (change === 'manual') await f.fs.writeNote({ path: 'A.md', content: '# User edit' });
    if (change === 'grant') f.config.curation = [];
    if (change === 'authority') f.revoke();
    await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'apply', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
  }
});

test('uncertain completion reconciles from exact output; it never reapplies an old patch', async () => {
  const f = await fixture(), p = await f.prepare(); f.interrupt();
  await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'apply', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
  const revision = (await f.fs.readNote('A.md')).revision; f.restart();
  const pending = await f.call({ op: 'read', cycleId: 'cleanup' }); expect(pending.status).toBe('applying');
  const done = await f.call({ op: 'reconcile', cycleId: 'cleanup', requestId: 'recover', expectedRevision: pending.revision });
  expect(done.status).toBe('applied'); expect((await f.fs.readNote('A.md')).revision).toBe(revision);
});

test('read-only server may diagnose but cannot prepare or apply', async () => {
  const f = await fixture(); f.options.readOnly = true;
  expect((await f.call({ op: 'diagnose' })).automaticApplication).toBe(false);
  await expect(f.prepare()).rejects.toThrow();
});

test('changed rollback output is never overwritten, and small responses omit private snapshots', async () => {
  const f = await fixture(), p = await f.prepare();
  const done = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'apply', expectedRevision: p.revision, fingerprint: p.fingerprint });
  const read = await f.call({ op: 'read', cycleId: 'cleanup', maxChars: 1000 });
  expect(JSON.stringify(read)).not.toContain('Never delete originals');
  await f.fs.writeNote({ path: 'A.md', content: '# User change after curation' });
  await expect(f.call({ op: 'revert', cycleId: 'cleanup', requestId: 'undo', expectedRevision: done.revision })).rejects.toThrow();
  expect((await f.fs.readNote('A.md')).content).toContain('User change');
});

test.each([{ legal_hold: ' TRUE ' }, { preserve_until: '2999-01-01' }, { immutable: 'true' }])('preservation metadata blocks changes: %j', async metadata => {
  const f = await fixture(metadata); await expect(f.prepare()).rejects.toThrow();
  expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
});

test('over-budget edges are incomplete, not an approved cleanup', async () => {
  const f = await fixture({ related: Array.from({ length: 201 }, () => '[[B]]') });
  expect(await f.prepare()).toMatchObject({ status: 'review_required', partial: true });
  expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
});

test('corrupt journal and cross-account reads never expose original bytes or enable a rewrite', async () => {
  const f = await fixture(), p = await f.prepare();
  const service = new EvolutionService(f.options);
  await expect(service.execute('cycle', { kind: 'curation', op: 'read', cycleId: 'cleanup' }, { ...f.principal, accountId: 'another' })).rejects.toThrow();
  for (const [key, value] of f.values) if (value.id === 'cleanup') f.values.set(key, { ...value, original: '# Corrupt' });
  await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'apply', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
  expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
});
