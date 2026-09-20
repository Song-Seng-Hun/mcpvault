import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from '../filesystem.js';
import { ScopeAccessPolicy } from '../scope-access.js';
import { EvolutionService } from '../evolution/service.js';
import { hash } from '../evolution/policy.js';
import { CurationService } from './service.js';
import { LlmWikiService } from '../llm-wiki.js';
import { ReferenceService } from '../references.js';
import { LayeredMemoryService } from '../layered-memory.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(frontmatter: Record<string, unknown> = {}, archive: boolean | 'merge_duplicates' | 'merge_passages' = false, canonicalContent?: string) {
  const root = await mkdtemp(join(tmpdir(), 'curation-run-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  await fs.writeNote({ path: 'A.md', content: '# A\nOnly if enabled. Never delete originals. ^condition',
    frontmatter: { llm_wiki_type: 'knowledge', contrasts_with: ['[[B]]', '[[B]]'], related: ['[[B|Choice]]', '[[B]]'], ...frontmatter } });
  await fs.writeNote({ path: 'B.md', content: '# B\nAlternative.' });
  const initial = await fs.readNote('A.md');
  if (archive) await fs.writeNote({ path: 'B.md', content: canonicalContent ?? initial.content, frontmatter: initial.frontmatter });
  const replacement = await fs.readNote('B.md');
  const values = new Map<string, any>(); let held = false, allowed = true, managed = true, failSave = false;
  const principal: any = { accountId: 'operator', modelId: 'test', capabilities: ['write'] };
  const config: any = { version: 1, enabled: true, curation: [{ accountId: 'operator', paths: ['A.md'], operations: ['deduplicate_relations'] }] };
  if (archive) config.curation = [{ accountId: 'operator', paths: ['A.md', 'B.md'], operations: [archive === true ? 'archive_duplicate' : archive] }];
  const storage: any = { refresh: async () => structuredClone(config), acquire: async () => {
    if (held) throw Error('busy'); held = true; return { assertHeld: async () => { if (!held) throw Error('lost'); }, close: async () => { held = false; } };
  }, records: { read: async (key: string) => ({ revision: values.has(key) ? hash(values.get(key)) : 'missing', value: structuredClone(values.get(key)) }),
    write: async (key: string, value: any, expected: string, current?: () => Promise<void>) => {
      await current?.(); if (!held || expected !== (values.has(key) ? hash(values.get(key)) : 'missing')) throw Error('conflict');
      if (failSave && value.state === 'applied') { failSave = false; throw Error('receipt interrupted'); }
      values.set(key, structuredClone(value)); return { revision: hash(value) };
    } } };
  const curation = new CurationService({ fs, access, config: () => storage.refresh(),
    wiki: new LlmWikiService(fs, access, new ReferenceService(fs)),
    managedProof: async (path: string, revision: string) => managed && (path === 'A.md' && revision === initial.revision
      || archive && path === 'B.md' && revision === replacement.revision) ? hash(['managed', path, revision]) : undefined });
  const options: any = { storage, curation, authority: async () => ({ ownerId: 'operator', sharedOwner: false, revision: 'authority', assertCurrent: async () => { if (!allowed) throw Error('revoked'); } }) };
  let service = new EvolutionService(options);
  const call = (args: any) => service.execute('cycle', { kind: 'curation', ...args }, principal);
  const prepare = () => call({ op: 'prepare', cycleId: 'cleanup', requestId: 'prepare', expectedRevision: 'missing',
    operation: archive ? archive === true ? 'archive_duplicate' : archive : 'deduplicate_relations', path: 'A.md', sourceRevision: initial.revision,
    ...(archive && { replacementPath: 'B.md', replacementRevision: replacement.revision }) });
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

test('verified duplicate archives through the lifecycle owner and restores exact source bytes', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, true);
  const replacement = await f.fs.readNote('B.md'), p = await f.prepare();
  expect(p.status).toBe('prepared');
  const done = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'archive', expectedRevision: p.revision, fingerprint: p.fingerprint });
  expect(done.status).toBe('applied');
  const archived = await f.fs.readNote('A.md');
  expect(archived.frontmatter.lifecycle).toBe('archived'); expect(archived.content).toBe(f.initial.content);
  expect((await f.fs.readNote('B.md')).revision).toBe(replacement.revision);
  const restored = await f.call({ op: 'revert', cycleId: 'cleanup', requestId: 'restore', expectedRevision: done.revision });
  expect(restored.status).toBe('withdrawn'); expect((await f.fs.readNote('A.md')).originalContent).toBe(f.initial.originalContent);
});

test('duplicate retirement stops active memory reuse while retaining history and exact recovery', async () => {
  for (const operation of [true, 'merge_duplicates'] as const) for (const metadata of [
    { memory_role: 'episodic', memory_state: 'active' }, { memory_entries: [{ block_id: 'condition', role: 'semantic', state: 'active' }] },
  ]) {
    const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active', ...metadata }, operation);
    const memory = new LayeredMemoryService(f.fs, {} as any, new ScopeAccessPolicy());
    const read = (includeHistory = false) => memory.read('recall', { scope: 'global', semantic: false, includeHistory, maxChars: 12000 });
    expect((await read()).items.map((n: any) => n.path).sort()).toEqual(['A.md', 'B.md']);
    const p = await f.prepare(), applied = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'retire', expectedRevision: p.revision, fingerprint: p.fingerprint });
    expect((await read()).items.map((n: any) => n.path)).toEqual(['B.md']);
    expect((await read(true)).items.map((n: any) => n.path).sort()).toEqual(['A.md', 'B.md']);
    await f.call({ op: 'revert', cycleId: 'cleanup', requestId: 'restore', expectedRevision: applied.revision });
    expect((await read()).items).toHaveLength(2);
  }
});

test('replacement changes and newly added inbound evidence prevent archive', async () => {
  for (const change of ['replacement', 'inbound']) {
    const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, true), p = await f.prepare();
    expect(p.status).toBe('prepared');
    if (change === 'replacement') await f.fs.writeNote({ path: 'B.md', content: 'User revision' });
    else await f.fs.writeNote({ path: 'Active.md', content: 'Required [[A#A]]', frontmatter: { basis: ['[[A]]'] } });
    await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'archive', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
    expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
  }
});

test('archive never treats an unmatched condition or inbound dependency as disposable', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, true);
  await f.fs.writeNote({ path: 'Active.md', content: 'Recovery [[A]]' });
  expect(await f.prepare()).toMatchObject({ status: 'review_required', reason: 'archive_impact_requires_review' });
  expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
});

test('identical managed documents merge into an explicit canonical with reciprocal lineage and two-file recovery', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_duplicates');
  const canonical = await f.fs.readNote('B.md'), p = await f.prepare();
  expect(p.status).toBe('prepared');
  const done = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'merge', expectedRevision: p.revision, fingerprint: p.fingerprint });
  expect(done.status).toBe('applied');
  const source = await f.fs.readNote('A.md'), target = await f.fs.readNote('B.md');
  expect(source.frontmatter.lifecycle).toBe('superseded'); expect(source.frontmatter.replaced_by).toBe('[[B]]');
  expect(target.frontmatter.supersedes).toEqual(['[[A]]']);
  expect(source.content).toBe(f.initial.content); expect(target.content).toBe(canonical.content);
  f.restart();
  expect((await f.call({ op: 'read', cycleId: 'cleanup' })).status).toBe('applied');
  await f.call({ op: 'revert', cycleId: 'cleanup', requestId: 'undo', expectedRevision: done.revision });
  expect((await f.fs.readNote('A.md')).originalContent).toBe(f.initial.originalContent);
  expect((await f.fs.readNote('B.md')).originalContent).toBe(canonical.originalContent);
});

test('merge recovery observes both outputs and refuses to overwrite edits to either document', async () => {
  for (const path of ['A.md', 'B.md']) {
    const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_duplicates'), p = await f.prepare();
    const done = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'merge', expectedRevision: p.revision, fingerprint: p.fingerprint });
    await f.fs.writeNote({ path, content: 'User edit survives', expectedRevision: (await f.fs.readNote(path)).revision });
    await expect(f.call({ op: 'revert', cycleId: 'cleanup', requestId: 'undo', expectedRevision: done.revision })).rejects.toThrow();
    expect((await f.fs.readNote(path)).content).toContain('User edit survives');
  }
});

test('lost merge completion receipt is reconciled only after both resulting revisions are re-read', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_duplicates'), p = await f.prepare();
  f.interrupt();
  await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'merge', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
  f.restart(); const pending = await f.call({ op: 'read', cycleId: 'cleanup' });
  expect(pending.status).toBe('applying');
  const done = await f.call({ op: 'reconcile', cycleId: 'cleanup', requestId: 'reconcile', expectedRevision: pending.revision });
  expect(done.status).toBe('applied');
});

test('a partially present merge is not certified complete or replayed over the remaining target', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_duplicates');
  const canonical = await f.fs.readNote('B.md'), p = await f.prepare(); f.interrupt();
  await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'merge', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
  await f.fs.writeNote({ path: 'B.md', content: canonical.originalContent });
  const pending = await f.call({ op: 'read', cycleId: 'cleanup' }); expect(pending.status).toBe('review_required');
  const result = await f.call({ op: 'reconcile', cycleId: 'cleanup', requestId: 'inspect', expectedRevision: pending.revision });
  expect(result.status).toBe('review_required'); expect((await f.fs.readNote('B.md')).revision).toBe(canonical.revision);
});

test('second-file write interruption restores both originals and permits a revision-checked retry after reconciliation', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_duplicates');
  const canonical = await f.fs.readNote('B.md'), p = await f.prepare();
  const original = (f.fs as any).writeProtectedFile.bind(f.fs); let interrupted = false;
  vi.spyOn(f.fs as any, 'writeProtectedFile').mockImplementation(async (...args: any[]) => {
    if (!interrupted && String(args[0]).endsWith('A.md') && String(args[1]).includes('replaced_by:')) {
      expect((await f.fs.readNote('B.md')).revision).not.toBe(canonical.revision);
      interrupted = true; throw Error('Synthetic second-file interruption');
    }
    return original(...args);
  });
  await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'first', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
  expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
  expect((await f.fs.readNote('B.md')).revision).toBe(canonical.revision);
  f.restart(); const pending = await f.call({ op: 'read', cycleId: 'cleanup' });
  const recovered = await f.call({ op: 'reconcile', cycleId: 'cleanup', requestId: 'inspect', expectedRevision: pending.revision });
  expect(recovered.status).toBe('prepared');
  const done = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'retry', expectedRevision: recovered.revision, fingerprint: recovered.fingerprint });
  expect(done.status).toBe('applied');
});

test('nonidentical passages are published into the canonical before retiring the source and both recover exactly', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_passages', '# B\nOnly version 2.0. Counterexample: offline NAS.');
  const canonical = await f.fs.readNote('B.md'), p = await f.prepare();
  expect(p.status).toBe('prepared'); expect(p.passageCoverage).toHaveLength(2);
  const writes: string[] = [], original = (f.fs as any).writeProtectedFile.bind(f.fs);
  vi.spyOn(f.fs as any, 'writeProtectedFile').mockImplementation(async (...args: any[]) => { writes.push(String(args[0])); return original(...args); });
  const done = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'merge', expectedRevision: p.revision, fingerprint: p.fingerprint });
  expect(done.status).toBe('applied'); expect(writes[0]).toMatch(/B\.md$/);
  const result = await f.fs.readNote('B.md');
  expect(done.outputs).toContainEqual({ path: 'B.md', revision: result.revision });
  expect(done.passageCoverage.every((m: any) => m.outputPath === 'B.md' && m.expectedOutputRevision === result.revision)).toBe(true);
  expect(result.content).toContain(canonical.content); expect(result.content).toContain(f.initial.content);
  await f.call({ op: 'revert', cycleId: 'cleanup', requestId: 'undo', expectedRevision: done.revision });
  expect((await f.fs.readNote('A.md')).originalContent).toBe(f.initial.originalContent);
  expect((await f.fs.readNote('B.md')).originalContent).toBe(canonical.originalContent);
});

test('a verified canonical-first partial merge resumes only the pending source and keeps its full rollback', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_passages', '# B\nOther preserved condition.'), p = await f.prepare();
  const canonical = await f.fs.readNote('B.md'); f.interrupt();
  await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'merge', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
  // Model an interrupted bundle with only its first, canonical write durable.
  await f.fs.writeNote({ path: 'A.md', content: f.initial.originalContent });
  f.restart(); const pending = await f.call({ op: 'read', cycleId: 'cleanup' });
  const recovery = await f.call({ op: 'reconcile', cycleId: 'cleanup', requestId: 'inspect', expectedRevision: pending.revision });
  expect(recovery.status).toBe('resumable');
  const writes: string[] = [], original = (f.fs as any).writeProtectedFile.bind(f.fs);
  vi.spyOn(f.fs as any, 'writeProtectedFile').mockImplementation(async (...args: any[]) => { writes.push(String(args[0])); return original(...args); });
  const done = await f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'resume', expectedRevision: recovery.revision, fingerprint: recovery.fingerprint });
  expect(done.status).toBe('applied'); expect(writes).toHaveLength(1); expect(writes[0]).toMatch(/A\.md$/);
  await f.call({ op: 'revert', cycleId: 'cleanup', requestId: 'undo', expectedRevision: done.revision });
  expect((await f.fs.readNote('A.md')).originalContent).toBe(f.initial.originalContent);
  expect((await f.fs.readNote('B.md')).originalContent).toBe(canonical.originalContent);
});

test('partial merge recovery refuses a changed canonical and a forged passage locator', async () => {
  for (const corrupt of ['canonical', 'locator']) {
    const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_passages', '# B\nOther preserved condition.'), p = await f.prepare();
    if (corrupt === 'locator') {
      for (const [key, value] of f.values) if (value.id === 'cleanup') {
        value.passageCoverage[0].path = 'Hidden.md'; f.values.set(key, value);
      }
      await expect(f.call({ op: 'read', cycleId: 'cleanup' })).rejects.toThrow();
    } else {
      f.interrupt();
      await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'merge', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
      await f.fs.writeNote({ path: 'A.md', content: f.initial.originalContent });
      await f.fs.writeNote({ path: 'B.md', content: 'User change; do not replay' });
      await expect(f.call({ op: 'read', cycleId: 'cleanup' })).rejects.toThrow();
      expect((await f.fs.readNote('B.md')).content).toContain('User change');
    }
  }
});

test('lossless merge requests chaptering instead of publishing more than 50 physical lines', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_passages',
    '# B\n' + Array.from({ length: 45 }, (_, i) => `Condition ${i}.`).join('\n'));
  const before = (await f.fs.readNote('B.md')).revision;
  expect(await f.prepare()).toMatchObject({ status: 'review_required', reason: 'chapter_bundle_required' });
  expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
  expect((await f.fs.readNote('B.md')).revision).toBe(before);
});

test('a new external dependency blocks the remaining stage of a resumable merge', async () => {
  const f = await fixture({ related: [], contrasts_with: [], lifecycle: 'active' }, 'merge_duplicates'), p = await f.prepare(); f.interrupt();
  await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'merge', expectedRevision: p.revision, fingerprint: p.fingerprint })).rejects.toThrow();
  await f.fs.writeNote({ path: 'A.md', content: f.initial.originalContent });
  const pending = await f.call({ op: 'read', cycleId: 'cleanup' });
  const resume = await f.call({ op: 'reconcile', cycleId: 'cleanup', requestId: 'inspect', expectedRevision: pending.revision });
  await f.fs.writeNote({ path: 'Active.md', content: 'Required procedure [[A]]' });
  await expect(f.call({ op: 'apply', cycleId: 'cleanup', requestId: 'resume', expectedRevision: resume.revision, fingerprint: resume.fingerprint })).rejects.toThrow();
  expect((await f.fs.readNote('A.md')).revision).toBe(f.initial.revision);
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
