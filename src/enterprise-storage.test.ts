import { expect, test } from 'vitest';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { assertEnterpriseStorageAccess, canReadEnterpriseStoragePath, prepareDocumentWrite, withEnterpriseStorageContext } from './enterprise-storage-context.js';
import { authorIdentity, resolveActorMention } from './enterprise-identity.js';
import { FileSystemService } from './filesystem.js';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseSensitiveFilesystem, hostGate } from '../tests/host-conditions.js';

const principal: ScopePrincipal = { accountId: 'a', agentId: 'network', modelId: 'codex', userId: 'u', commandCenterId: 'acme', role: 'agent' };

test('three Codex roles have exact persistent mentions despite identical biographies', () => {
  const agents = ['network', 'memory', 'research'].map(agentId => ({ ...principal, agentId }));
  expect(new Set(agents.map(p => authorIdentity(p).authorLabel)).size).toBe(3);
  expect(resolveActorMention('@actor:acme:network', agents)).toBe('actor:acme:network');
  expect(() => resolveActorMention('@codex', agents)).toThrow(/ambiguous/);
});

test('nested storage contexts intersect owner predicates and preserve both freshness and write hooks', async () => {
  const events: string[] = [];
  const ownerAccess = new ScopeAccessPolicy();
  await withEnterpriseStorageContext({ access: ownerAccess, assertFresh() { events.push('outer-fresh'); },
    canAccessPath: path => path === 'Shared/allowed.md' || path === 'Shared/outer-only.md',
    canTraversePath: path => path === 'Shared',
    beforeWrite: async path => { events.push(`outer-write:${path}`); },
  }, () => withEnterpriseStorageContext({ access: ownerAccess, assertFresh() { events.push('inner-fresh'); },
    canAccessPath: path => path === 'Shared/allowed.md' || path === 'Shared/inner-only.md',
    canTraversePath: path => path === 'Shared',
    beforeWrite: async path => { events.push(`inner-write:${path}`); },
  }, async () => {
    expect(canReadEnterpriseStoragePath('Shared/allowed.md')).toBe(true);
    expect(canReadEnterpriseStoragePath('Shared/outer-only.md')).toBe(false);
    expect(canReadEnterpriseStoragePath('Shared/inner-only.md')).toBe(false);
    expect(() => assertEnterpriseStorageAccess('Shared/outer-only.md')).toThrow(/owner activity/i);
    expect(() => assertEnterpriseStorageAccess('Shared/inner-only.md')).toThrow(/owner activity/i);
    await prepareDocumentWrite('Shared/allowed.md');
  }));

  expect(events).toContain('outer-fresh');
  expect(events).toContain('inner-fresh');
  expect(events).toContain('outer-write:Shared/allowed.md');
  expect(events).toContain('inner-write:Shared/allowed.md');
});

test('access revoked during the write barrier leaves no folders from a note write or move', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await fs.writeNote({ path: 'Source.md', content: '# Source\n' });
    const before = await readdir(vault, { recursive: true });
    // Admitted when resolved; revoked by the barrier, as an owner refresh would.
    let revoked = false;
    const context = { access: new ScopeAccessPolicy(), assertFresh() {}, beforeWrite: async () => { revoked = true; },
      canAccessPath: (path: string) => !(revoked && path.startsWith('Deep/')) };
    const attempt = (write: () => Promise<unknown>) => { revoked = false; return withEnterpriseStorageContext(context, write); };
    await expect(attempt(() => fs.writeNote({ path: 'Deep/Folder/Note.md', content: '# Note\n' }))).rejects.toThrow(/owner activity/i);
    const revision = (await fs.readNote('Source.md')).revision;
    expect(await attempt(() => fs.moveNote({ oldPath: 'Source.md', newPath: 'Deep/Moved/Source.md', expectedRevision: revision }))).toMatchObject({ success: false });
    expect(await readdir(vault, { recursive: true })).toEqual(before);
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test('access revoked during the write barrier leaves no folders from trash, original capture or a view export', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await fs.writeNote({ path: 'Source.md', content: '# Source\n' });
    const before = await readdir(vault, { recursive: true });
    let revoked = false;
    const context = { access: new ScopeAccessPolicy(), assertFresh() {}, beforeWrite: async () => { revoked = true; },
      canAccessPath: () => !revoked };
    const attempt = (write: () => Promise<unknown>) => { revoked = false; return withEnterpriseStorageContext(context, write); };
    expect(await attempt(() => fs.deleteNote({ path: 'Source.md', confirmPath: 'Source.md', trashMode: 'local' })))
      .toMatchObject({ success: false, message: expect.stringMatching(/owner activity/i) });
    await expect(attempt(() => fs.preserveOriginal('_sources/Deep/original.bin', Buffer.from('bytes')))).rejects.toThrow(/owner activity/i);
    await expect(attempt(() => fs.writeBaseFile({ path: 'Views/Index.base', content: 'views: []\n', expectedRevision: 'missing' }))).rejects.toThrow(/owner activity/i);
    expect(await readdir(vault, { recursive: true })).toEqual(before);
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test('a write barrier that denies the target keeps the file a move would overwrite, and the note a delete would remove', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await writeFile(join(vault, 'Source.png'), 'source');
    await writeFile(join(vault, 'Target.png'), 'old target');
    await fs.writeNote({ path: 'Kept.md', content: '# Kept\n' });
    const denied = new Set(['Target.png', 'Kept.md']);
    const context = { access: new ScopeAccessPolicy(), assertFresh() {},
      beforeWrite: async (path: string) => { if (denied.has(path)) throw new Error(`barrier denied ${path}`); } };
    const move = { oldPath: 'Source.png', newPath: 'Target.png', confirmOldPath: 'Source.png', confirmNewPath: 'Target.png', overwrite: true };
    expect(await withEnterpriseStorageContext(context, () => fs.moveFile(move))).toMatchObject({ success: false });
    expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
    expect(await readFile(join(vault, 'Source.png'), 'utf8')).toBe('source');
    expect(await withEnterpriseStorageContext(context, () => fs.deleteNote({ path: 'Kept.md', confirmPath: 'Kept.md' })))
      .toMatchObject({ success: false, message: expect.stringMatching(/barrier denied/) });
    expect((await fs.readNote('Kept.md')).content).toContain('# Kept');
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test('a same-device move runs the write barrier for its source', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await writeFile(join(vault, 'Source.png'), 'source');
    await writeFile(join(vault, 'Target.png'), 'old target');
    const context = { access: new ScopeAccessPolicy(), assertFresh() {},
      beforeWrite: async (path: string) => { if (path === 'Source.png') throw new Error('barrier denied the source'); } };
    const move = { oldPath: 'Source.png', newPath: 'Target.png', confirmOldPath: 'Source.png', confirmNewPath: 'Target.png', overwrite: true };
    expect(await withEnterpriseStorageContext(context, () => fs.moveFile(move)))
      .toMatchObject({ success: false, message: expect.stringMatching(/barrier denied the source/) });
    expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
    expect(await readFile(join(vault, 'Source.png'), 'utf8')).toBe('source');
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test('an overwrite move whose source is revoked during the write barriers keeps the old target bytes', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await writeFile(join(vault, 'Source.png'), 'source');
    await writeFile(join(vault, 'Target.png'), 'old target');
    // The target stays admitted throughout; only the source is revoked, by the target's own barrier.
    let revoked = false;
    const context = { access: new ScopeAccessPolicy(), assertFresh() {}, beforeWrite: async () => { revoked = true; },
      canAccessPath: (path: string) => !(revoked && path === 'Source.png') };
    const move = { oldPath: 'Source.png', newPath: 'Target.png', confirmOldPath: 'Source.png', confirmNewPath: 'Target.png', overwrite: true };
    expect(await withEnterpriseStorageContext(context, () => fs.moveFile(move))).toMatchObject({ success: false });
    expect(await readFile(join(vault, 'Target.png'), 'utf8')).toBe('old target');
    expect(await readFile(join(vault, 'Source.png'), 'utf8')).toBe('source');
  } finally { await rm(vault, { recursive: true, force: true }); }
});

// The old unlink removed the source itself only where a.png and A.png are one file.
test.skipIf(Boolean(hostGate(caseSensitiveFilesystem(tmpdir()))))('an overwrite move that only changes the letter case keeps the file', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await writeFile(join(vault, 'a.png'), 'bytes');
    const move = { oldPath: 'a.png', newPath: 'A.png', confirmOldPath: 'a.png', confirmNewPath: 'A.png', overwrite: true };
    expect(await fs.moveFile(move)).toMatchObject({ success: true });
    expect(await readdir(vault)).toEqual(['A.png']);
    expect(await readFile(join(vault, 'A.png'), 'utf8')).toBe('bytes');
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test('a note move denied for its source reaches no write barrier for the destination', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await fs.writeNote({ path: 'Source.md', content: '# Source\n' });
    const barrier: string[] = [];
    const context = { access: new ScopeAccessPolicy(), assertFresh() {},
      beforeWrite: async (path: string) => { barrier.push(path); if (path === 'Source.md') throw new Error('barrier denied the source'); } };
    const revision = (await fs.readNote('Source.md')).revision;
    expect(await withEnterpriseStorageContext(context, () => fs.moveNote({ oldPath: 'Source.md', newPath: 'Moved.md', expectedRevision: revision })))
      .toMatchObject({ success: false, message: expect.stringMatching(/barrier denied the source/) });
    expect(barrier).toEqual(['Source.md']);
    expect(await readdir(vault)).toEqual(['Source.md']);
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test.each([false, true])('a note move whose destination is denied at its first barrier (overwrite %s) claims no rollback and keeps both notes', async overwrite => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await fs.writeNote({ path: 'Source.md', content: '# Source\n' });
    if (overwrite) await fs.writeNote({ path: 'Moved.md', content: '# Previous\n' });
    const context = { access: new ScopeAccessPolicy(), assertFresh() {},
      beforeWrite: async (path: string) => { if (path === 'Moved.md') throw new Error('barrier denied Moved.md'); } };
    const revision = (await fs.readNote('Source.md')).revision;
    const result = await withEnterpriseStorageContext(context, () => fs.moveNote({ oldPath: 'Source.md', newPath: 'Moved.md', overwrite, expectedRevision: revision }));
    expect(result).toMatchObject({ success: false, message: 'Failed to move note: barrier denied Moved.md' });
    expect((await fs.readNote('Source.md')).content).toBe('# Source\n');
    if (overwrite) expect((await fs.readNote('Moved.md')).content).toBe('# Previous\n');
    else expect(await readdir(vault)).toEqual(['Source.md']);
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test('a note move whose rollback also fails says so and names what it could not restore', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await fs.writeNote({ path: 'Source.md', content: '# Source\n' });
    // Each path is admitted once, then revoked: the source removal fails, and so does undoing the destination.
    const seen = new Set<string>();
    const context = { access: new ScopeAccessPolicy(), assertFresh() {},
      beforeWrite: async (path: string) => { if (seen.has(path)) throw new Error(`revoked ${path}`); seen.add(path); } };
    const revision = (await fs.readNote('Source.md')).revision;
    const result = await withEnterpriseStorageContext(context, () => fs.moveNote({ oldPath: 'Source.md', newPath: 'Moved.md', expectedRevision: revision }));
    expect(result).toMatchObject({ success: false, message: expect.stringMatching(/revoked Source\.md.*Rollback incomplete: Moved\.md could not be removed, so both copies of the note remain \(revoked Moved\.md\)/) });
    expect((await readdir(vault)).sort()).toEqual(['Moved.md', 'Source.md']);
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test('a failed rollback names lost destination content and unrestored backlinks without claiming two copies', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-barrier-order-'));
  try {
    const fs = new FileSystemService(vault);
    await fs.writeNote({ path: 'Source.md', content: '# Source\n' });
    await fs.writeNote({ path: 'Moved.md', content: '# Previous\n' });
    await fs.writeNote({ path: 'Linker.md', content: 'See [[Source]].\n' });
    // Admit each listed path once, then revoke it; other paths stay admitted.
    const once = (paths: string[]) => {
      const seen = new Set<string>();
      return { access: new ScopeAccessPolicy(), assertFresh() {}, beforeWrite: async (path: string) => {
        if (paths.includes(path) && seen.has(path)) throw new Error(`revoked ${path}`); seen.add(path);
      } };
    };
    let revision = (await fs.readNote('Source.md')).revision;
    const overwrite = await withEnterpriseStorageContext(once(['Source.md', 'Moved.md']),
      () => fs.moveNote({ oldPath: 'Source.md', newPath: 'Moved.md', overwrite: true, expectedRevision: revision }));
    expect(overwrite.message).toMatch(/Rollback incomplete: the previous content of Moved\.md was not restored and is lost/);
    expect(overwrite.message).not.toMatch(/both copies/);
    await fs.writeNote({ path: 'Moved.md', content: '# Previous\n' });
    revision = (await fs.readNote('Source.md')).revision;
    const links = await withEnterpriseStorageContext(once(['Source.md', 'Linker.md']),
      () => fs.moveNote({ oldPath: 'Source.md', newPath: 'Renamed.md', updateLinks: true, expectedRevision: revision }));
    expect(links.message).toMatch(/Rollback incomplete: Linker\.md was not restored and may still link to Renamed\.md/);
    expect(links.message).not.toMatch(/both copies/);
  } finally { await rm(vault, { recursive: true, force: true }); }
});
