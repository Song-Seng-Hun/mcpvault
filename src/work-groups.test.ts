import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService, type ScopePrincipal } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { WorkGroupService } from './work-groups.js';

const vaults: string[] = [];

test('leave succeeds despite a now-hidden reference and does not rewrite that reference', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  await fs.writeNote({ path: 'Knowledge/source.md', content: 'source' });
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'leave-hidden', references: ['Knowledge/source.md'], requestId: 'new' });
  const joined = await groups.group({ op: 'join', principal: people.peer, groupId: 'leave-hidden', expectedRevision: created.revision, requestId: 'join' });
  const n = await fs.readNote('Knowledge/source.md');
  await fs.writeNote({ path: 'Knowledge/source.md', content: n.content, frontmatter: { moderation_status: 'hidden' }, expectedRevision: n.revision });
  await groups.group({ op: 'leave', principal: people.peer, groupId: 'leave-hidden', expectedRevision: joined.revision, requestId: 'leave' });
  const current = await fs.readNote('Community/Groups/leave-hidden.md');
  expect(current.frontmatter.members).not.toContain('peer');
  expect(current.frontmatter.references).toEqual(['Knowledge/source.md']);
});

test('omitted large group arrays have progressing revision-bound field pagination', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'large-page',
    topics: Array.from({ length: 20 }, (_, i) => `${i} ${'t'.repeat(490)}`), requestId: 'new-large' });
  const n = await fs.readNote('Community/Groups/large-page.md');
  await fs.writeNote({ path: 'Community/Groups/large-page.md', content: n.content, frontmatter: { ...n.frontmatter, members: Array.from({ length: 100 }, (_, i) => `member-${i}-${'x'.repeat(50)}`) }, expectedRevision: created.revision });
  const first = await groups.group({ groupId: 'large-page', maxChars: 12000 });
  expect(first.nextAction.arguments.field).toBe('members');
  const page1 = await groups.group({ ...first.nextAction.arguments, limit: 10 } as any);
  expect(page1.items).toHaveLength(10);
  const page2 = await groups.group({ ...first.nextAction.arguments, limit: 10, cursor: page1.cursor } as any);
  expect(page2.items[0]).not.toEqual(page1.items[0]);
  const current = await fs.readNote('Community/Groups/large-page.md');
  await fs.writeNote({ path: 'Community/Groups/large-page.md', content: 'changed', frontmatter: current.frontmatter, expectedRevision: current.revision });
  await expect(groups.group({ ...first.nextAction.arguments, cursor: page2.cursor } as any)).rejects.toThrow(/revision|changed|cursor/i);
});

test('reference mutation between validated read and guarded write fails closed', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  await fs.writeNote({ path: 'Knowledge/race.md', content: 'source' });
  const original = fs.readNote.bind(fs);
  let fired = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async (path, ...rest) => {
    const n = await original(path, ...rest);
    if (path === 'Knowledge/race.md' && !fired) {
      fired = true;
      await fs.writeNote({ path, content: n.content, frontmatter: { ...n.frontmatter, moderation_status: 'hidden' }, expectedRevision: n.revision });
    }
    return n;
  });
  await expect(groups.group({ op: 'create', principal: people.owner, groupId: 'race', references: ['Knowledge/race.md'], requestId: 'race' })).rejects.toThrow(/revision|hidden|changed/i);
  expect(await fs.noteExists('Community/Groups/race.md')).toBe(false);
});
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-groups-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault);
  const refs = new ReferenceService(fs, new ScopeAccessPolicy());
  const auth = new ScopeAuthService(vault);
  const principals: Record<string, ScopePrincipal> = {};
  for (const id of ['owner', 'peer', 'other']) {
    principals[id] = (await auth.register({ accountId: id, modelId: id, agentId: `${id}-agent`, password: 'fixture-password-only' })).principal;
  }
  return { fs, refs, auth, people: principals as Record<'owner' | 'peer' | 'other', ScopePrincipal> };
}

test('creates and reads a persistent Community work group with bounded metadata', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'evidence-circle', title: 'Evidence Circle', purpose: 'Compare sources', topics: ['research'], references: [], requestId: 'create-1' });
  expect(created).toMatchObject({ groupId: 'evidence-circle', path: 'Community/Groups/evidence-circle.md', revision: expect.any(String), requestId: 'create-1', operation: 'create' });
  expect((await fs.readNote('Community/Groups/evidence-circle.md')).frontmatter.members).toEqual(['owner']);
  expect(JSON.stringify(created).length).toBeLessThanOrEqual(4000);
  expect((await groups.group({ op: 'read', groupId: 'evidence-circle' })).group).toMatchObject({ title: 'Evidence Circle', purpose: 'Compare sources' });
});

test('agents voluntarily join and leave, while membership grants no project or scope authority', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'shared', requestId: 'create-2' });
  const joined = await groups.group({ op: 'join', principal: people.peer, groupId: 'shared', expectedRevision: created.revision, requestId: 'join-1' });
  expect((await groups.group({ groupId: 'shared' })).group.members).toEqual(['owner', 'peer']);
  const left = await groups.group({ op: 'leave', principal: people.peer, groupId: 'shared', expectedRevision: joined.revision, requestId: 'leave-1' });
  expect((await groups.group({ groupId: 'shared' })).group.members).toEqual(['owner']);
  expect((await fs.readNote('Community/Groups/shared.md')).frontmatter.project_id).toBeUndefined();
});

test('only the immutable owner configures or archives, and archived groups retain read and leave history but reject join', async () => {
  const { refs, fs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'closed', requestId: 'create-3' });
  await expect(groups.group({ op: 'update', principal: people.peer, groupId: 'closed', title: 'takeover', expectedRevision: created.revision, requestId: 'bad-update' })).rejects.toThrow(/owner|configure/i);
  const archived = await groups.group({ op: 'archive', principal: people.owner, groupId: 'closed', expectedRevision: created.revision, requestId: 'archive-1' });
  await expect(groups.group({ op: 'join', principal: people.peer, groupId: 'closed', expectedRevision: archived.revision, requestId: 'bad-join' })).rejects.toThrow(/archiv/i);
  expect((await groups.group({ op: 'read', groupId: 'closed' })).group.status).toBe('archived');
  expect((await groups.group({ op: 'leave', principal: people.owner, groupId: 'closed', expectedRevision: archived.revision, requestId: 'leave-owner' })).operation).toBe('leave');
  expect((await groups.group({ op: 'read', groupId: 'closed' })).group.members).toEqual([]);
  expect(fs).toBeDefined();
});

test('mutations require exact request reuse and current revisions, and validate shared references', async () => {
  const { fs, refs, auth, people } = await fixture();
  await fs.writeNote({ path: 'Knowledge/Public.md', content: 'Public source', frontmatter: { title: 'Public source' } });
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'refs', references: ['Knowledge/Public.md'], requestId: 'create-4' });
  expect((await groups.group({ op: 'update', principal: people.owner, groupId: 'refs', purpose: 'updated', expectedRevision: created.revision, requestId: 'update-1' })).operation).toBe('update');
  const current = await groups.group({ op: 'read', groupId: 'refs' });
  await expect(groups.group({ op: 'update', principal: people.owner, groupId: 'refs', purpose: 'different', expectedRevision: created.revision, requestId: 'update-2' })).rejects.toThrow(/revision/i);
  const retry = await groups.group({ op: 'update', principal: people.owner, groupId: 'refs', purpose: 'updated', expectedRevision: created.revision, requestId: 'update-1' });
  expect(retry.revision).toBe(current.revision);
  await expect(groups.group({ op: 'update', principal: people.owner, groupId: 'refs', purpose: 'tampered', expectedRevision: current.revision, requestId: 'update-1' })).rejects.toThrow(/requestId|payload/i);
});

test('preserves authored body content and rejects unknown operations or non-missing create revisions', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  await expect(groups.group({ op: 'wat' as any, groupId: 'bad' })).rejects.toThrow(/operation/i);
  await expect(groups.group({ op: 'create', principal: people.owner, groupId: 'wrong-revision', expectedRevision: 'stale', requestId: 'create-wrong' })).rejects.toThrow(/missing/i);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'body', requestId: 'create-body' });
  await fs.writeNote({ path: 'Community/Groups/body.md', content: 'Authored description', frontmatter: (await fs.readNote('Community/Groups/body.md')).frontmatter, expectedRevision: created.revision });
  const current = await fs.readNote('Community/Groups/body.md');
  await groups.group({ op: 'update', principal: people.owner, groupId: 'body', purpose: 'updated', expectedRevision: current.revision, requestId: 'update-body' });
  expect((await fs.readNote('Community/Groups/body.md')).content.trim()).toBe('Authored description');
  expect(refs).toBeDefined();
});

test('bounds oversized reads before exposing fields and returns a small mutation receipt', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'large', requestId: 'create-large', maxChars: 200 });
  const note = await fs.readNote('Community/Groups/large.md');
  await fs.writeNote({ path: 'Community/Groups/large.md', content: 'body', frontmatter: { ...note.frontmatter, members: ['owner', ...Array.from({ length: 99 }, (_, i) => `member-${String(i).padStart(2, '0')}-${'x'.repeat(54)}`)] }, expectedRevision: note.revision });
  const read = await groups.group({ groupId: 'large' });
  expect(read.truncated).toBe(true);
  expect(read.omittedFields).toContain('members');
  expect(JSON.stringify(read).length).toBeLessThanOrEqual(4000);
  expect(JSON.stringify(created)).not.toContain('members');
  expect(JSON.stringify(created).length).toBeLessThanOrEqual(200);
  expect(refs).toBeDefined();
});

test('checks hidden references before every write and filters them from public reads', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  await fs.writeNote({ path: 'Knowledge/Hidden.md', content: 'secret', frontmatter: { title: 'Hidden' } });
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'hidden-ref', references: ['Knowledge/Hidden.md'], requestId: 'create-hidden' });
  const source = await fs.readNote('Knowledge/Hidden.md');
  await fs.writeNote({ path: 'Knowledge/Hidden.md', content: source.content, frontmatter: { ...source.frontmatter, moderation_status: 'hidden' }, expectedRevision: source.revision });
  expect((await groups.group({ groupId: 'hidden-ref' })).group.references).toEqual([]);
  const current = await fs.readNote('Community/Groups/hidden-ref.md');
  await expect(groups.group({ op: 'update', principal: people.owner, groupId: 'hidden-ref', purpose: 'blocked', expectedRevision: current.revision, requestId: 'update-hidden' })).rejects.toThrow(/hidden/i);
  expect(refs).toBeDefined();
  expect(created).toBeDefined();
});

test('removed accounts in historical membership do not block another verified member leaving', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'stale-member', requestId: 'create-stale' });
  const joined = await groups.group({ op: 'join', principal: people.peer, groupId: 'stale-member', expectedRevision: created.revision, requestId: 'join-stale' });
  const note = await fs.readNote('Community/Groups/stale-member.md');
  await fs.writeNote({ path: 'Community/Groups/stale-member.md', content: note.content, frontmatter: { ...note.frontmatter, members: ['owner', 'peer', 'removed-account'] }, expectedRevision: note.revision });
  const changed = await fs.readNote('Community/Groups/stale-member.md');
  await groups.group({ op: 'leave', principal: people.peer, groupId: 'stale-member', expectedRevision: changed.revision, requestId: 'leave-stale' });
  expect((await groups.group({ groupId: 'stale-member' })).group.members).toEqual(['owner', 'removed-account']);
  expect(refs).toBeDefined();
  expect(joined).toBeDefined();
});

test('checks owner permission before replaying a matching mutation receipt', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'owner-first', requestId: 'create-owner-first' });
  const updated = await groups.group({ op: 'update', principal: people.owner, groupId: 'owner-first', purpose: 'owner change', expectedRevision: created.revision, requestId: 'owner-receipt' });
  await expect(groups.group({ op: 'update', principal: people.peer, groupId: 'owner-first', purpose: 'takeover', expectedRevision: updated.revision, requestId: 'owner-receipt' })).rejects.toThrow(/owner/i);
  expect(fs).toBeDefined();
  expect(refs).toBeDefined();
  expect(auth).toBeDefined();
});

test('rechecks the original principal restrictions before committing', async () => {
  const { fs, refs, auth, people } = await fixture();
  const seen: ScopePrincipal[] = [];
  const groups = new WorkGroupService(fs, refs, auth, { assertActor: async principal => { seen.push(principal); } });
  await groups.group({ op: 'create', principal: people.owner, groupId: 'principal-recheck', requestId: 'create-recheck' });
  expect(seen.length).toBeGreaterThanOrEqual(2);
  expect(seen.every(principal => principal === people.owner)).toBe(true);
});

test('does not replay an old create receipt after the group snapshot changes', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  await groups.group({ op: 'create', principal: people.owner, groupId: 'create-retry-change', title: 'Original', requestId: 'create-retry-change' });
  const beforeJoin = await fs.readNote('Community/Groups/create-retry-change.md');
  await groups.group({ op: 'join', principal: people.peer, groupId: 'create-retry-change', expectedRevision: beforeJoin.revision, requestId: 'join-after-create' });
  await expect(groups.group({ op: 'create', principal: people.owner, groupId: 'create-retry-change', title: 'Original', requestId: 'create-retry-change' })).rejects.toThrow(/exists|receipt|replay/i);
  expect(refs).toBeDefined();
  expect(auth).toBeDefined();
});

test('malformed direct edits fail closed instead of granting owner or membership authority', async () => {
  const { fs, refs, auth, people } = await fixture();
  const groups = new WorkGroupService(fs, refs, auth);
  const created = await groups.group({ op: 'create', principal: people.owner, groupId: 'malformed', requestId: 'create-5' });
  const note = await fs.readNote('Community/Groups/malformed.md');
  await fs.writeNote({ path: 'Community/Groups/malformed.md', content: note.content, frontmatter: { ...note.frontmatter, owner_account_id: 'ghost', members: ['ghost'] }, expectedRevision: note.revision });
  await expect(groups.group({ op: 'update', principal: people.owner, groupId: 'malformed', title: 'unsafe', expectedRevision: created.revision, requestId: 'bad-edit' })).rejects.toThrow(/unavailable|owner|member/i);
  await expect(groups.group({ op: 'join', principal: people.peer, groupId: 'malformed', expectedRevision: note.revision, requestId: 'bad-join-2' })).rejects.toThrow(/revision|unavailable|owner|member/i);
});
