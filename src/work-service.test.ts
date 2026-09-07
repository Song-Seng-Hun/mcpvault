import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService, type ScopePrincipal } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-work-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault);
  const refs = new ReferenceService(fs, new ScopeAccessPolicy());
  const auth = new ScopeAuthService(vault, { moderatorAccounts: ['moderator'] });
  const tasks = new AgentTaskService(fs, refs, auth);
  const people: Record<string, ScopePrincipal> = {};
  for (const id of ['owner', 'peer', 'outsider', 'moderator']) {
    people[id] = (await auth.register({ accountId: id, modelId: id, password: 'fixture-password-only' })).principal;
  }
  return { vault, fs, refs, auth, tasks, owner: people.owner!, peer: people.peer!, outsider: people.outsider!, moderator: people.moderator! };
}

test('legacy task supports in_review without requiring a project', async () => {
  const { tasks, owner } = await fixture();
  const created = await tasks.create({ principal: owner, title: 'Research', description: 'Review evidence.' });
  const result = await tasks.update({ principal: owner, taskId: created.taskId, status: 'in_review', reason: 'Ready.', expectedRevision: created.revision });
  expect(result.status).toBe('in_review');
});

test('project task creation fails closed before WorkService attaches its shared guard', async () => {
  const { tasks, owner } = await fixture();
  await expect(tasks.create({ principal: owner, projectId: 'missing', title: 'Research', description: 'Review evidence.' } as any)).rejects.toThrow(/work service|project guard/i);
});

async function workFixture() {
  const f = await fixture();
  const module = await import('./work-service.js').catch(() => ({ WorkService: undefined }));
  expect(module.WorkService, 'WorkService implementation is available').toBeTypeOf('function');
  const work = new module.WorkService!(f.fs, f.refs, f.auth, f.tasks);
  await work.project({ op: 'create', principal: f.owner, projectId: 'alpha', title: 'Alpha', goal: 'Test peer work',
    allowedWork: ['general', 'security'], completionCriteria: ['Evidence verified'], participants: ['peer'], requestId: 'create-alpha' });
  const create = async (taskId: string, extra: Record<string, unknown> = {}) => f.tasks.create({ principal: f.owner,
    taskId, projectId: 'alpha', title: taskId, description: 'Check evidence', completionCriteria: ['Checks pass'], requestId: `create-${taskId}`, ...extra });
  const read = async (taskId: string) => f.fs.readNote(`Community/Tasks/${taskId}.md`);
  const update = async (taskId: string, extra: Record<string, unknown> = {}) => {
    const n = await read(taskId);
    return f.tasks.update({ principal: f.owner, taskId, expectedRevision: n.revision, expectedGeneration: n.frontmatter.claim_generation,
      requestId: `update-${taskId}-${n.revision}`, ...extra });
  };
  const claim = async (taskId: string, principal = f.owner, op: 'claim' | 'start' | 'release' = 'start') => {
    const n = await read(taskId);
    return work.claim({ principal, taskId, op, expectedRevision: n.revision, expectedGeneration: n.frontmatter.claim_generation,
      reason: 'Explicit work action', requestId: `${op}-${taskId}-${n.revision}` });
  };
  return { ...f, work, create, read, update, claim };
}

test('projects are opt-in Markdown with owner and conservative WIP defaults', async () => {
  const { fs, work, owner, outsider } = await workFixture();
  const n = await fs.readNote('Community/Projects/alpha.md');
  expect(n.frontmatter).toMatchObject({ project_id: 'alpha', owner_account_id: 'owner', participants: ['owner', 'peer'], wip_limit: 3, personal_wip_limit: 1 });
  await expect(work.project({ op: 'update', principal: outsider, projectId: 'alpha', participants: ['outsider'], expectedRevision: n.revision, requestId: 'takeover' })).rejects.toThrow(/owner|participant/i);
  await expect(work.project({ op: 'update', principal: owner, projectId: 'alpha', participants: ['absent'], expectedRevision: n.revision, requestId: 'unknown' })).rejects.toThrow(/account/i);
});

test.each(['COMPLETED', ' completed '])('normalized status %s cannot bypass high-risk completion', async status => {
  const { create, read, update } = await workFixture();
  await create('completion-case', { workKind: 'security', completionCriteria: [] });
  const before = await read('completion-case');
  await expect(update('completion-case', { status, reason: 'Premature completion', retrospective: 'A claimed lesson is not verification.' })).rejects.toThrow(/completionCriteria|verification|approval/i);
  expect((await read('completion-case')).revision).toBe(before.revision);
});

test('normalized in-progress status cannot bypass personal WIP admission', async () => {
  const { create, claim, update, read } = await workFixture();
  await create('active-case'); await claim('active-case'); await create('waiting-case');
  const before = await read('waiting-case');
  await expect(update('waiting-case', { status: 'IN_PROGRESS', assignee: 'owner', reason: 'Start second task' })).rejects.toThrow(/WIP/i);
  expect((await read('waiting-case')).revision).toBe(before.revision);
});

test.each(['wip_limit', 'personal_wip_limit'])('malformed %s cannot disable admission', async key => {
  const { fs, create, claim, read } = await workFixture();
  await create('active-invalid'); await claim('active-invalid'); await create('waiting-invalid');
  const project = await fs.readNote('Community/Projects/alpha.md');
  await fs.writeNote({ path: 'Community/Projects/alpha.md', content: project.content,
    frontmatter: { ...project.frontmatter, [key]: 'invalid', ...(key === 'wip_limit' ? { personal_wip_limit: 10 } : {}) }, expectedRevision: project.revision });
  const before = await read('waiting-invalid');
  await expect(claim('waiting-invalid')).rejects.toThrow(/integer|configuration/i);
  expect((await read('waiting-invalid')).revision).toBe(before.revision);
});

test('malformed personal WIP in another active project cannot poison cross-project admission', async () => {
  const { fs, create, claim, work, owner, read } = await workFixture();
  await create('alpha-active'); await claim('alpha-active');
  await work.project({ op: 'create', projectId: 'beta', principal: owner, title: 'Beta', goal: 'Other work',
    allowedWork: ['Research'], completionCriteria: ['Checked'], requestId: 'beta-project' });
  await create('beta-waiting', { projectId: 'beta' });
  const project = await fs.readNote('Community/Projects/alpha.md');
  await fs.writeNote({ path: 'Community/Projects/alpha.md', content: project.content,
    frontmatter: { ...project.frontmatter, personal_wip_limit: 'invalid' }, expectedRevision: project.revision });
  const before = await read('beta-waiting');
  await expect(claim('beta-waiting')).rejects.toThrow(/integer|configuration/i);
  expect((await read('beta-waiting')).revision).toBe(before.revision);
});

test('legacy project writes share membership, immutable ownership, dependency and generation checks', async () => {
  const { tasks, owner, outsider, create, read, update } = await workFixture();
  await expect(create('unauthorized', { principal: outsider })).rejects.toThrow(/participant/i);
  await create('a'); await create('b', { dependsOn: ['a'] });
  await expect(update('a', { dependsOn: ['b'] })).rejects.toThrow(/cycle/i);
  await expect(update('a', { projectId: 'other' })).rejects.toThrow(/immutable|project/i);
  const a = await read('a');
  await expect(tasks.update({ principal: owner, taskId: 'a', description: 'stale worker', expectedRevision: a.revision, requestId: 'no-generation' })).rejects.toThrow(/generation/i);
  await expect(update('a', { assignee: 'peer' })).rejects.toThrow(/handoff|self|assignee/i);
});

test('claims serialize WIP across projects and moving back retains started work', async () => {
  const { work, owner, create, read, claim, update, tasks } = await workFixture();
  await work.project({ op: 'create', principal: owner, projectId: 'beta', title: 'Beta', goal: 'Other', allowedWork: ['general'], completionCriteria: ['Done'], requestId: 'beta' });
  await create('one'); await create('two', { projectId: 'beta' });
  const results = await Promise.allSettled([claim('one'), claim('two')]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const started = (await read('one')).frontmatter.started_at ? 'one' : 'two';
  const waiting = started === 'one' ? 'two' : 'one';
  await update(started, { status: 'proposed', reason: 'Moved back' });
  await expect(claim(waiting)).rejects.toThrow(/WIP/i);
  const before = await read(started);
  await claim(started, owner, 'release');
  const after = await read(started);
  expect(after.frontmatter.claim_generation).toBeGreaterThan(before.frontmatter.claim_generation);
  await expect(tasks.update({ principal: owner, taskId: started, expectedRevision: after.revision, expectedGeneration: before.frontmatter.claim_generation, requestId: 'revoked', verification: 'Old worker' })).rejects.toThrow(/generation/i);
});

test('unresolved, cross-project and hidden dependencies cannot be started or disclosed', async () => {
  const { create, claim, update, read, fs } = await workFixture();
  await create('prerequisite'); await create('dependent', { dependsOn: ['prerequisite'] });
  await expect(claim('dependent')).rejects.toThrow(/dependenc/i);
  const n = await read('prerequisite');
  await fs.writeNote({ path: 'Community/Tasks/prerequisite.md', content: n.content, frontmatter: { ...n.frontmatter, moderation_status: 'hidden' }, expectedRevision: n.revision });
  await expect(update('dependent', { dependsOn: ['prerequisite'] })).rejects.toThrow(/unavailable|visible/i);
});

test('handoff is exact-account acceptance and revokes the old generation', async () => {
  const { create, claim, read, work, owner, peer, outsider } = await workFixture();
  await create('handoff'); await claim('handoff');
  const before = await read('handoff');
  await work.handoff({ op: 'propose', principal: owner, taskId: 'handoff', toAccountId: 'peer', completed: 'Inspected', remaining: 'Verify', nextAction: 'Run checks', expectedRevision: before.revision, expectedGeneration: before.frontmatter.claim_generation, requestId: 'offer' });
  const offered = await read('handoff');
  const accept = { op: 'accept' as const, taskId: 'handoff', expectedRevision: offered.revision, expectedGeneration: offered.frontmatter.claim_generation, requestId: 'accept' };
  await expect(work.handoff({ ...accept, principal: outsider })).rejects.toThrow(/participant|recipient/i);
  await work.handoff({ ...accept, principal: peer });
  const accepted = await read('handoff');
  expect(accepted.frontmatter.assignee_account_id).toBe('peer');
  expect(accepted.frontmatter.claim_generation).toBe(before.frontmatter.claim_generation + 1);
});

test('general completion requires verification and a knowledge disposition', async () => {
  const { create, claim, update } = await workFixture();
  await create('finish'); await claim('finish');
  await expect(update('finish', { status: 'completed', reason: 'Done', retrospective: 'Learned.' })).rejects.toThrow(/verification/i);
  await expect(update('finish', { status: 'completed', reason: 'Done', verification: 'All criteria checked' })).rejects.toThrow(/disposition/i);
  await expect(update('finish', { status: 'completed', reason: 'Done', verification: 'All criteria checked', retrospective: 'Learned.' })).resolves.toMatchObject({ status: 'completed' });
});

test('high-risk approval binds current public artifacts and cannot be self-approved or weakened', async () => {
  const { fs, create, claim, update, read, work, owner, peer } = await workFixture();
  await fs.writeNote({ path: 'Evidence.md', content: 'Checked', frontmatter: { title: 'Evidence' } });
  const artifact = await fs.readNote('Evidence.md');
  await create('risk', { workKind: 'security', artifacts: [{ path: 'Evidence.md', revision: artifact.revision }] });
  await claim('risk');
  await expect(update('risk', { workKind: 'general' })).rejects.toThrow(/risk|workKind/i);
  await update('risk', { verification: 'Criteria checked' });
  let n = await read('risk');
  const requested = await work.review({ op: 'request', principal: owner, taskId: 'risk', expectedRevision: n.revision, expectedGeneration: n.frontmatter.claim_generation, requestId: 'request-review' });
  n = await read('risk');
  const approval = { op: 'approve' as const, taskId: 'risk', expectedRevision: n.revision, artifactFingerprint: requested.artifactFingerprint, requestId: 'approve-review', reason: 'Checked evidence' };
  await expect(work.review({ ...approval, principal: owner })).rejects.toThrow(/independent|same|author/i);
  await work.review({ ...approval, principal: peer });
  await update('risk', { description: 'Changed basis' });
  await expect(update('risk', { status: 'completed', reason: 'Done', retrospective: 'Findings.' })).rejects.toThrow(/approval/i);
});

test('idempotency survives reconstruction and returns original result despite stale revisions', async () => {
  const { create, read, work, owner, fs, refs, auth, tasks } = await workFixture();
  await create('retry');
  const n = await read('retry');
  const params = { op: 'start' as const, taskId: 'retry', principal: owner, expectedRevision: n.revision, expectedGeneration: 0, reason: 'Starting', requestId: 'stable-id' };
  const result = await work.claim(params);
  const module = await import('./work-service.js');
  const restarted = new module.WorkService(fs, refs, auth, tasks);
  expect(await restarted.claim(params)).toEqual(result);
  await expect(restarted.claim({ ...params, reason: 'Different' })).rejects.toThrow(/requestId|payload/i);
  expect((await read('retry')).frontmatter.claim_generation).toBe(1);
});

test('board and packet are bounded, private-safe metadata projections with invalidating cursors', async () => {
  const { fs, create, work, owner, update } = await workFixture();
  for (const id of ['a', 'b', 'c']) await create(id);
  await fs.writeNote({ path: 'Question.md', content: 'DO NOT RETURN THIS BODY', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'question', project_id: 'alpha', next_action: 'Check evidence' } });
  await fs.writeNote({ path: '_scopes/users/owner/Secret.md', content: 'private', frontmatter: { project_id: 'alpha', next_action: 'secret' } });
  const board = await work.board({ projectId: 'alpha', principal: owner, limit: 1, maxChars: 1000 });
  expect(board.total).toBe(4);
  expect(board.cursor).toBeTruthy();
  expect(JSON.stringify(board).length).toBeLessThanOrEqual(1000);
  await update('a', { verification: 'Changed' });
  await expect(work.board({ projectId: 'alpha', principal: owner, cursor: board.cursor })).rejects.toThrow(/cursor|inventory/i);
  const packet = await work.packet({ taskId: 'a', principal: owner, maxChars: 1000 });
  expect(JSON.stringify(packet).length).toBeLessThanOrEqual(1000);
  expect(JSON.stringify(await work.board({ projectId: 'alpha' }))).not.toMatch(/DO NOT RETURN|Secret|private/);
});

test('pulse suggests work without joining or claiming', async () => {
  const { work, peer, create, read } = await workFixture();
  await create('ready');
  expect(await work.pulse(peer, 5, 1000)).toMatchObject({ nextAction: expect.anything() });
  expect((await read('ready')).frontmatter.assignee_account_id).toBeUndefined();
});

test('pulse follows the existing tool/arguments next-action convention', async () => {
  const { work, peer, create } = await workFixture();
  await create('ready');
  expect((await work.pulse(peer)).nextAction).toEqual({ tool: 'work.packet', arguments: { taskId: 'ready' } });
});

test('host moderator and project owner may release another account with a reason', async () => {
  const { work, create, claim, read, peer, owner, moderator } = await workFixture();
  await create('delegated', { principal: peer }); await claim('delegated', peer);
  for (const principal of [owner, moderator]) {
    const n = await read('delegated');
    await work.claim({ op: 'release', principal, taskId: 'delegated', reason: 'Owner-approved pause', expectedRevision: n.revision, requestId: `release-${principal.accountId}` });
    expect((await read('delegated')).frontmatter.assignee_account_id).toBeUndefined();
    if (principal === owner) await claim('delegated', peer);
  }
});

test('legacy self-claim uses account authority and exact retry does not mutate caller params', async () => {
  const { tasks, create, read, peer } = await workFixture();
  await create('self-claim');
  const n = await read('self-claim');
  const params = { principal: peer, taskId: 'self-claim', assignee: 'peer', status: 'in_progress', reason: 'Start', expectedRevision: n.revision, expectedGeneration: 0, requestId: 'self-claim' };
  const before = structuredClone(params);
  const result = await tasks.update(params);
  expect(params).toEqual(before);
  expect(await tasks.update(params)).toEqual(result);
});

test('project create retries with a generated task id preserve the caller payload', async () => {
  const { tasks, owner } = await workFixture();
  const params = { principal: owner, projectId: 'alpha', title: 'Generated', description: 'A generated task', completionCriteria: ['Done'], requestId: 'generated' };
  const before = structuredClone(params);
  const result = await tasks.create(params);
  expect(params).toEqual(before);
  expect(await tasks.create(params)).toEqual(result);
});

test('packet removes newly hidden artifact and dependency locators and invalidates continuation', async () => {
  const { fs, create, read, work } = await workFixture();
  await fs.writeNote({ path: 'Visible.md', content: 'A source', frontmatter: {} });
  const artifact = await fs.readNote('Visible.md');
  await create('dependency');
  await create('context', { artifacts: [{ path: 'Visible.md', revision: artifact.revision }], dependsOn: ['dependency'] });
  const first = await work.packet({ taskId: 'context', limit: 1 });
  const dep = await read('dependency');
  await fs.writeNote({ path: 'Community/Tasks/dependency.md', content: dep.content, frontmatter: { ...dep.frontmatter, moderation_status: 'hidden' }, expectedRevision: dep.revision });
  await fs.writeNote({ path: 'Visible.md', content: artifact.content, frontmatter: { moderation_status: 'hidden' }, expectedRevision: artifact.revision });
  const packet = await work.packet({ taskId: 'context', maxChars: 12000 });
  expect(JSON.stringify(packet)).not.toContain('Visible.md');
  expect(packet.items.filter((x: any) => x.kind === 'dependency')).toEqual([]);
  await expect(work.packet({ taskId: 'context', cursor: first.cursor })).rejects.toThrow(/cursor/i);
});

test('completion review is independently approved, invalidated by release, and needs current artifact revision', async () => {
  const { fs, work, create, claim, update, read, owner, peer } = await workFixture();
  await fs.writeNote({ path: 'Proof.md', content: 'Proof', frontmatter: {} });
  const artifact = await fs.readNote('Proof.md');
  await create('secure', { workKind: 'security', artifacts: [{ path: 'Proof.md', revision: artifact.revision }] });
  await claim('secure'); await update('secure', { verification: 'Verified' });
  let n = await read('secure');
  const requested = await work.review({ op: 'request', principal: owner, taskId: 'secure', expectedRevision: n.revision, expectedGeneration: n.frontmatter.claim_generation, requestId: 'review' });
  n = await read('secure');
  await work.review({ op: 'approve', principal: peer, taskId: 'secure', expectedRevision: n.revision, artifactFingerprint: requested.artifactFingerprint, reason: 'Verified independently', requestId: 'approval' });
  await claim('secure', owner, 'release'); await claim('secure');
  await expect(update('secure', { status: 'completed', reason: 'Done', retrospective: 'Lesson' })).rejects.toThrow(/approval/i);
});

test('in-lock actor callback runs again immediately before persistence', async () => {
  const { fs, refs, auth, tasks, owner } = await fixture();
  const { WorkService } = await import('./work-service.js');
  let checks = 0;
  const work = new WorkService(fs, refs, auth, tasks, { assertActor: async () => { if (++checks === 2) throw new Error('Actor now banned'); } });
  await expect(work.project({ op: 'create', principal: owner, projectId: 'blocked', title: 'Blocked', goal: 'Goal', allowedWork: ['general'], completionCriteria: ['Done'], requestId: 'blocked' })).rejects.toThrow(/banned/i);
  expect(await fs.noteExists('Community/Projects/blocked.md')).toBe(false);
});

test('artifact scope aliases and traversal cannot disclose private notes', async () => {
  const { fs, create } = await workFixture();
  await fs.writeNote({ path: '_scopes/models/owner/Secret.md', content: 'Secret', frontmatter: {} });
  for (const path of ['_scopes/models/owner/Secret.md', 'Notes/../_scopes/models/owner/Secret.md', 'scope://model/owner/Secret.md']) {
    await expect(create(`private-${path.length}`, { artifacts: [{ path }] })).rejects.toThrow(/private|public|canonical/i);
  }
});

test('new unprojected tasks authorize accounts instead of a colliding display identity', async () => {
  const { tasks, owner } = await fixture();
  const created = await tasks.create({ principal: owner, title: 'Legacy-compatible', description: 'Unprojected work' });
  const impostor = { ...owner, accountId: 'different-account' };
  await expect(tasks.update({ principal: impostor, taskId: created.taskId, description: 'Same model is not same account', expectedRevision: created.revision })).rejects.toThrow(/account|requester|assignee/i);
});

test('high-risk completion succeeds only after independent current-basis approval', async () => {
  const { work, create, claim, update, read, owner, peer } = await workFixture();
  await create('finish-risk', { workKind: 'security' }); await claim('finish-risk');
  await update('finish-risk', { verification: 'Criteria checked' });
  let n = await read('finish-risk');
  const request = await work.review({ op: 'request', principal: owner, taskId: 'finish-risk', expectedRevision: n.revision, expectedGeneration: n.frontmatter.claim_generation, requestId: 'review-risk' });
  n = await read('finish-risk');
  await work.review({ op: 'approve', principal: peer, taskId: 'finish-risk', expectedRevision: n.revision, artifactFingerprint: request.artifactFingerprint, reason: 'Independent checks', requestId: 'approve-risk' });
  await expect(update('finish-risk', { status: 'completed', reason: 'Done', retrospective: 'Preserved result' })).resolves.toMatchObject({ status: 'completed' });
});

test('packet carries project work scope, parent and discussion context without hydrating linked notes', async () => {
  const { work, create, fs } = await workFixture();
  await fs.writeNote({ path: 'Community/Posts/work-discussion.md', content: 'Discussion body stays out of the packet', frontmatter: { mcpvault_type: 'blog_post', post_id: 'work-discussion', status: 'published' } });
  await create('parent'); await create('child', { parentTaskId: 'parent', discussionSlug: 'work-discussion' });
  const packet = await work.packet({ taskId: 'child', maxChars: 12000 });
  expect(packet.items).toContainEqual(expect.objectContaining({ kind: 'allowedWork', text: 'general' }));
  expect(packet.items).toContainEqual(expect.objectContaining({ kind: 'parent', taskId: 'parent' }));
  expect(packet.items).toContainEqual(expect.objectContaining({ kind: 'discussion', slug: 'work-discussion' }));
});

test('bounded receipts persist at most sixteen recent operations and replay older retained results', async () => {
  const { create, update, tasks, owner, read } = await workFixture();
  await create('bounded');
  const before = await read('bounded');
  const first = { principal: owner, taskId: 'bounded', expectedRevision: before.revision, expectedGeneration: 0, verification: 'First', requestId: 'first-retry' };
  const result = await tasks.update(first);
  for (let i = 0; i < 10; i++) await update('bounded', { verification: `Progress ${i}` });
  expect(await tasks.update(first)).toEqual(result);
  for (let i = 10; i < 20; i++) await update('bounded', { verification: `Progress ${i}` });
  expect((await read('bounded')).frontmatter.work_receipts).toHaveLength(16);
});

test('board continuation invalidates when actionable note content changes', async () => {
  const { fs, work, create } = await workFixture();
  await create('task');
  await fs.writeNote({ path: 'Action.md', content: 'Before', frontmatter: { project_id: 'alpha', next_action: 'Do it' } });
  const first = await work.board({ projectId: 'alpha', limit: 1 });
  const note = await fs.readNote('Action.md');
  await fs.writeNote({ path: 'Action.md', content: 'After', frontmatter: note.frontmatter, expectedRevision: note.revision });
  await expect(work.board({ projectId: 'alpha', cursor: first.cursor })).rejects.toThrow(/cursor/i);
});

test('pulse quietly withholds work guidance from revoked or banned accounts', async () => {
  const { fs, refs, auth, tasks, owner } = await workFixture();
  const { WorkService } = await import('./work-service.js');
  const work = new WorkService(fs, refs, auth, tasks, { assertActor: async () => { throw new Error('Banned'); } });
  expect(await work.pulse(owner)).toEqual({});
  expect(await work.pulse({ ...owner, capabilities: ['write'] })).toEqual({});
});

test('packet supplies a revision and generation bound action for unclaimed work', async () => {
  const { work, create, peer } = await workFixture();
  await create('action');
  const packet = await work.packet({ principal: peer, taskId: 'action', maxChars: 12000 });
  expect(packet.items).toContainEqual(expect.objectContaining({ kind: 'nextAction', tool: 'work.claim', arguments: expect.objectContaining({
    op: 'claim', taskId: 'action', expectedRevision: packet.revision, expectedGeneration: 0, requestId: expect.any(String),
  }) }));
});

test('packet progress action names the actual registered legacy task endpoint', async () => {
  const { work, create, claim, owner } = await workFixture();
  await create('progress'); await claim('progress');
  const packet = await work.packet({ principal: owner, taskId: 'progress', maxChars: 12000 });
  const { endpointIdForTool } = await import('./endpoint-registry.js');
  expect(packet.items).toContainEqual(expect.objectContaining({ kind: 'nextAction', tool: endpointIdForTool('update_agent_task') }));
});

test('lowering WIP limits does not prohibit progress or release of already started work', async () => {
  const { work, create, claim, read, update, owner, peer, fs } = await workFixture();
  await create('one'); await create('two', { principal: peer });
  await claim('one'); await claim('two', peer);
  const p = await fs.readNote('Community/Projects/alpha.md');
  await work.project({ op: 'update', principal: owner, projectId: 'alpha', expectedRevision: p.revision, wipLimit: 1, requestId: 'lower-wip' });
  await expect(update('one', { verification: 'Progress while over limit' })).resolves.toMatchObject({ status: 'in_progress' });
  await claim('two', peer, 'release');
  expect((await read('two')).frontmatter.assignee_account_id).toBeUndefined();
});

test('transport tokens and formatting are excluded from durable retry identity', async () => {
  const { work, create, read, owner } = await workFixture();
  await create('transport');
  const n = await read('transport');
  const params = { op: 'start' as const, principal: owner, taskId: 'transport', expectedRevision: n.revision, expectedGeneration: 0, requestId: 'transport-retry' };
  const result = await work.claim({ ...params, accessToken: 'test-token-before' } as any);
  expect(await work.claim({ ...params, accessToken: 'test-token-after', prettyPrint: true } as any)).toEqual(result);
  expect(JSON.stringify((await read('transport')).frontmatter)).not.toContain('test-token');
});

test('artifact repository locators reject embedded credentials', async () => {
  const { create } = await workFixture();
  await expect(create('credential', { artifacts: [{ repository: 'https://test-token@example.test/repo', commit: 'a'.repeat(40) }] })).rejects.toThrow(/credential/i);
});

test('external artifacts require full immutable SHA-1 or SHA-256 commit locators', async () => {
  const { create, read } = await workFixture();
  const invalid = ['main', 'HEAD', 'refs/heads/main', 'v1.0', 'abc', 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(40)];
  for (const [i, commit] of invalid.entries()) {
    await expect(create(`invalid-${i}`, { artifacts: [{ repository: 'https://example.test/repo', commit }] })).rejects.toThrow(/commit.*40.*64|immutable/i);
  }
  for (const length of [40, 64]) {
    const commit = 'aB09'.repeat(length / 4);
    await create(`valid-${length}`, { artifacts: [{ repository: 'https://example.test/repo', branch: 'main', commit }] });
    expect((await read(`valid-${length}`)).frontmatter.artifacts[0].commit).toBe(commit);
  }
});

test('review question permits an answer and renewed independent approval while preserving history', async () => {
  const { create, claim, update, read, work, owner, peer } = await workFixture();
  await create('question', { workKind: 'security' }); await claim('question');
  await update('question', { verification: 'Initial checks' });
  const review = async (op: 'request' | 'question' | 'approve', principal: ScopePrincipal, artifactFingerprint?: string) => {
    const n = await read('question');
    return work.review({ taskId: 'question', op, principal, expectedRevision: n.revision, expectedGeneration: n.frontmatter.claim_generation,
      requestId: `${op}-${n.revision}`, reason: 'How was isolation verified?', ...(artifactFingerprint && { artifactFingerprint }) });
  };
  const requested = await review('request', owner);
  await review('question', peer, requested.artifactFingerprint);
  expect((await read('question')).frontmatter.status).toBe('in_progress');
  const packet = await work.packet({ taskId: 'question', principal: owner });
  const clarification = packet.items.find((item: any) => item.kind === 'nextAction');
  expect(clarification).toMatchObject({ tool: 'mcp.update_agent_task', requiredInput: ['verification'],
    question: 'How was isolation verified?' });
  expect(clarification.reason).toMatch(/answer|clarif/i);
  expect(packet.items.some((item: any) => item.tool === 'work.review' && item.arguments?.op === 'request')).toBe(false);
  await update('question', { verification: 'Answer: isolated fixture checks passed' });
  expect((await work.packet({ taskId: 'question', principal: owner })).items).toContainEqual(expect.objectContaining({ tool: 'work.review', arguments: expect.objectContaining({ op: 'request' }) }));
  const renewed = await review('request', owner);
  expect(renewed.artifactFingerprint).not.toBe(requested.artifactFingerprint);
  await review('approve', peer, renewed.artifactFingerprint);
  await update('question', { status: 'completed', reason: 'Verified', retrospective: 'Check isolation explicitly.' });
  expect((await read('question')).frontmatter.work_reviews).toContainEqual(expect.objectContaining({ decision: 'question', reason: 'How was isolation verified?' }));
});

test.each(['general', 'approve', 'override'] as const)('packet offers explicit completion for verified work with %s risk disposition', async disposition => {
  const { create, claim, update, read, work, tasks, owner, peer, moderator } = await workFixture();
  await create('complete-action', { workKind: disposition === 'general' ? 'general' : 'security' });
  await claim('complete-action');
  await update('complete-action', { verification: 'All criteria checked' });
  if (disposition !== 'general') {
    const before = await read('complete-action');
    const requested = await work.review({ taskId: 'complete-action', op: 'request', principal: owner,
      expectedRevision: before.revision, expectedGeneration: before.frontmatter.claim_generation, requestId: 'request-completion' });
    const waiting = await work.packet({ taskId: 'complete-action', principal: owner });
    expect(waiting.items.some((item: any) => item.arguments?.status === 'completed')).toBe(false);
    const current = await read('complete-action');
    await work.review({ taskId: 'complete-action', op: disposition, principal: disposition === 'approve' ? peer : moderator,
      expectedRevision: current.revision, artifactFingerprint: requested.artifactFingerprint, reason: 'Explicit independent checks or host override', requestId: 'review-completion' });
  }
  const current = await read('complete-action');
  const packet = await work.packet({ taskId: 'complete-action', principal: owner });
  const action = packet.items.find((item: any) => item.kind === 'nextAction');
  expect(action).toMatchObject({ tool: 'mcp.update_agent_task', arguments: { taskId: 'complete-action', status: 'completed',
    expectedRevision: current.revision, expectedGeneration: current.frontmatter.claim_generation, requestId: expect.any(String) } });
  expect(action.requiredInput).toContain('reason');
  expect(action.reason).toMatch(/knowledge disposition/i);
  await expect(tasks.update({ ...action.arguments, principal: owner, reason: 'Done', retrospective: 'Checked every completion criterion.' })).resolves.toMatchObject({ status: 'completed' });
});

test('task metadata mutations preserve manually authored Markdown until description is explicitly replaced', async () => {
  const { create, claim, read, update, work, fs, owner, peer } = await workFixture();
  await create('manual-body');
  const n = await read('manual-body');
  const path = 'Community/Tasks/manual-body.md';
  await fs.writeNote({ path, content: '# Host heading\n\nHandwritten [[Evidence]]\n\n## Decisions\n\n- Keep this prose.\n', frontmatter: n.frontmatter, expectedRevision: n.revision });
  const body = (await read('manual-body')).content;
  await claim('manual-body');
  expect((await read('manual-body')).content).toBe(body);
  await update('manual-body', { verification: 'Checked by hand' });
  expect((await read('manual-body')).content).toBe(body);
  let current = await read('manual-body');
  await work.review({ taskId: 'manual-body', op: 'request', principal: owner, expectedRevision: current.revision,
    expectedGeneration: current.frontmatter.claim_generation, requestId: 'manual-review' });
  expect((await read('manual-body')).content).toBe(body);
  current = await read('manual-body');
  await work.handoff({ taskId: 'manual-body', op: 'propose', principal: owner, toAccountId: 'peer', completed: 'Inspected', remaining: 'Verify', nextAction: 'Read the manual decisions',
    expectedRevision: current.revision, expectedGeneration: current.frontmatter.claim_generation, requestId: 'manual-handoff' });
  expect((await read('manual-body')).content).toBe(body);
  current = await read('manual-body');
  await work.handoff({ taskId: 'manual-body', op: 'accept', principal: peer, expectedRevision: current.revision,
    expectedGeneration: current.frontmatter.claim_generation, requestId: 'manual-accept' });
  expect((await read('manual-body')).content).toBe(body);
  await update('manual-body', { principal: peer, description: 'Explicit replacement' });
  expect((await read('manual-body')).content.trim()).toBe('# manual-body\n\nExplicit replacement');
});

test('legacy unprojected metadata updates preserve manual task bodies', async () => {
  const { tasks, fs, owner } = await fixture();
  const task = await tasks.create({ principal: owner, title: 'Legacy prose', description: 'Original' });
  const note = await fs.readNote(task.path);
  await fs.writeNote({ path: task.path, content: '# Hand edited\n\nKeep manual decisions.\n', frontmatter: note.frontmatter, expectedRevision: note.revision });
  const edited = await fs.readNote(task.path);
  await tasks.update({ taskId: task.taskId, principal: owner, status: 'accepted', reason: 'Acknowledged', expectedRevision: edited.revision });
  expect((await fs.readNote(task.path)).content).toBe(edited.content);
});

test('dependency validation bounds active depth as well as completed traversal', async () => {
  const { fs, create } = await workFixture();
  for (let i = 0; i < 101; i++) {
    await fs.writeNote({ path: `Community/Tasks/depth-${i}.md`, content: 'Fixture dependency', frontmatter: {
      mcpvault_type: 'agent_task', task_id: `depth-${i}`, project_id: 'alpha', status: 'completed',
      depends_on: i < 100 ? [`depth-${i + 1}`] : [],
    } });
  }
  await expect(create('deep-root', { dependsOn: ['depth-0'] })).rejects.toThrow(/graph.*bounded validation/i);
});

test('project projection reports malformed recognized fields without leaking suppressed rooms', async () => {
  const { fs, work } = await workFixture();
  const path = 'Community/Projects/alpha.md';
  const n = await fs.readNote(path);
  await fs.writeNote({ path, content: n.content, expectedRevision: n.revision,
    frontmatter: { ...n.frontmatter, title: 42, allowed_work: 'invalid', participants: null, wip_limit: 'three', personal_wip_limit: -1, room_id: 'hidden-room' } });
  const projection = await work.project({ projectId: 'alpha' });
  expect(projection.omittedFields).toEqual(expect.arrayContaining(['title', 'allowed_work', 'participants', 'wip_limit', 'personal_wip_limit']));
  expect(projection.omittedFields).not.toContain('room_id');
  expect(projection.project.room_id).toBeUndefined();
});

test('legacy project task read gives exact worker generation and required mutation fields', async () => {
  const { create, tasks, claim } = await workFixture();
  await create('context'); await claim('context');
  expect(await tasks.read({ taskId: 'context', includeContent: false })).toMatchObject({
    workContext: { projectId: 'alpha', expectedGeneration: 1, mutationRequires: ['requestId', 'expectedGeneration'] },
  });
});

test('normalized project identifiers cannot strand tasks outside their project board', async () => {
  const { work, create, read, update } = await workFixture();
  await create('normalized', { projectId: ' ALPHA ' });
  expect((await read('normalized')).frontmatter.project_id).toBe('alpha');
  await expect(update('normalized', { projectId: 'ALPHA', verification: 'Same project' })).resolves.toMatchObject({ success: true });
  expect((await work.board({ projectId: 'alpha' })).total).toBe(1);
});

test('cosmetic external Markdown edits cannot fabricate the original retry revision', async () => {
  const { work, create, read, fs, owner } = await workFixture();
  await create('cosmetic');
  const n = await read('cosmetic');
  const params = { op: 'start' as const, principal: owner, taskId: 'cosmetic', expectedRevision: n.revision, expectedGeneration: 0, requestId: 'cosmetic' };
  await work.claim(params);
  const written = await read('cosmetic');
  await fs.writeNote({ path: 'Community/Tasks/cosmetic.md', content: written.originalContent.replace('title: cosmetic', 'title:  cosmetic'), expectedRevision: written.revision });
  await expect(work.claim(params)).rejects.toThrow(/receipt revision unavailable|external/i);
});

test('spec release frees project WIP while preserving the released claim start in history', async () => {
  const { work, fs, owner, create, claim, read } = await workFixture();
  const p = await fs.readNote('Community/Projects/alpha.md');
  await work.project({ op: 'update', principal: owner, projectId: 'alpha', wipLimit: 1, expectedRevision: p.revision, requestId: 'one-slot' });
  await create('old'); await create('next'); await claim('old');
  const before = await read('old');
  await claim('old', owner, 'release');
  const released = await read('old');
  expect(released.frontmatter.started_at).toBeUndefined();
  expect(JSON.stringify(released.frontmatter.work_changes)).toContain(before.frontmatter.started_at);
  await expect(claim('next')).resolves.toMatchObject({ status: 'in_progress' });
});

test('spec started legacy task cannot add an unfinished dependency and completion rechecks readiness', async () => {
  const { create, claim, update, read, fs } = await workFixture();
  await create('running'); await create('unfinished'); await claim('running');
  await expect(update('running', { dependsOn: ['unfinished'] })).rejects.toThrow(/dependenc/i);
  const current = await read('running');
  await fs.writeNote({ path: 'Community/Tasks/running.md', content: current.content, frontmatter: { ...current.frontmatter, depends_on: ['unfinished'] }, expectedRevision: current.revision });
  await expect(update('running', { status: 'completed', reason: 'Done', verification: 'Checked', retrospective: 'Lesson' })).rejects.toThrow(/dependenc/i);
});

test('spec changed verification invalidates independent approval', async () => {
  const { create, claim, update, work, read, owner, peer } = await workFixture();
  await create('basis', { workKind: 'security' }); await claim('basis'); await update('basis', { verification: 'Initial results' });
  let n = await read('basis');
  const requested = await work.review({ op: 'request', principal: owner, taskId: 'basis', expectedRevision: n.revision, expectedGeneration: n.frontmatter.claim_generation, requestId: 'request-basis' });
  n = await read('basis');
  await work.review({ op: 'approve', principal: peer, taskId: 'basis', expectedRevision: n.revision, artifactFingerprint: requested.artifactFingerprint, reason: 'Verified initial results', requestId: 'approve-basis' });
  await update('basis', { verification: 'Actually the check failed' });
  expect((await read('basis')).frontmatter.work_review).toBeUndefined();
  await expect(update('basis', { status: 'completed', reason: 'Done', retrospective: 'Lesson' })).rejects.toThrow(/approval/i);
});

test.each([false, true])('spec every completed result needs a current disposition, project=%s', async projected => {
  const { fs, tasks, owner, create, read, update } = await workFixture();
  if (projected) await create('corrupted');
  else await tasks.create({ principal: owner, taskId: 'corrupted', title: 'Corrupted', description: 'Old completion' });
  const n = await read('corrupted');
  await fs.writeNote({ path: 'Community/Tasks/corrupted.md', content: n.content, frontmatter: { ...n.frontmatter, status: 'completed', verification: 'Checked', knowledge_dispositions: ['retrospective'] }, expectedRevision: n.revision });
  await expect(update('corrupted', { description: 'Still completed' })).rejects.toThrow(/disposition/i);
});

test('spec project config edits preserve manually authored Markdown bodies', async () => {
  const { work, fs, owner } = await workFixture();
  const n = await fs.readNote('Community/Projects/alpha.md');
  const body = '# Authored project\n\n## Decisions\n- Preserve [[Evidence]] and this rationale.\n';
  await fs.writeNote({ path: 'Community/Projects/alpha.md', content: body, frontmatter: n.frontmatter, expectedRevision: n.revision });
  const manual = await fs.readNote('Community/Projects/alpha.md');
  await work.project({ op: 'update', projectId: 'alpha', principal: owner, title: 'New property title', goal: 'Updated goal', wipLimit: 2, expectedRevision: manual.revision, requestId: 'preserve-body' });
  expect((await fs.readNote('Community/Projects/alpha.md')).content).toBe(body);
});

test('spec legacy lists exclude moderated tasks before counts and selection', async () => {
  const { fs, tasks, owner } = await fixture();
  await tasks.create({ principal: owner, taskId: 'visible', title: 'Visible', description: 'Visible', assignee: 'owner' });
  for (const state of ['hidden', 'quarantined', 'removed']) {
    const created = await tasks.create({ principal: owner, taskId: state, title: `SECRET-${state}`, description: 'Hidden', assignee: 'owner' });
    const n = await fs.readNote(created.path);
    await fs.writeNote({ path: created.path, content: n.content, frontmatter: { ...n.frontmatter, moderation_status: state, updated_at: '2999-01-01T00:00:00Z' }, expectedRevision: n.revision });
  }
  const listed = await tasks.list({ limit: 1 });
  expect(listed.total).toBe(1);
  expect(listed.tasks[0]?.taskId).toBe('visible');
  expect(listed.truncated).toBe(false);
  const assigned = await tasks.listAssignedOpen({ assignee: 'owner', limit: 1 });
  expect(assigned.total).toBe(1);
  expect(assigned.statusCounts.proposed).toBe(1);
  expect(JSON.stringify({ listed, assigned })).not.toContain('SECRET');
});

test('spec project reads use an explicit bounded projection with no internal metadata', async () => {
  const { work, fs } = await workFixture();
  const n = await fs.readNote('Community/Projects/alpha.md');
  await fs.writeNote({ path: 'Community/Projects/alpha.md', content: n.content,
    frontmatter: { ...n.frontmatter, internal_secret: 'NEVER-RETURN', arbitrary: 'X'.repeat(20000), goal: 'G'.repeat(2000), allowed_work: Array.from({ length: 20 }, (_, i) => `${i}${'A'.repeat(490)}`), completion_criteria: Array.from({ length: 20 }, (_, i) => `${i}${'C'.repeat(490)}`) }, expectedRevision: n.revision });
  for (const maxChars of [512, 1000, 4000, 12000]) {
    const result = await work.project({ op: 'read', projectId: 'alpha', maxChars });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    expect(result.project.project_id).toBe('alpha');
    expect(JSON.stringify(result)).not.toMatch(/NEVER-RETURN|work_receipts|arbitrary/);
  }
  expect(JSON.stringify(await work.project({ projectId: 'alpha' })).length).toBeLessThanOrEqual(4000);
});

test('spec board exposes authorized WIP and blockers/review; packet has an explicit blocker', async () => {
  const { work, owner, outsider, create, claim, update, read } = await workFixture();
  await create('blocked'); await claim('blocked'); await update('blocked', { status: 'blocked', reason: 'Waiting for evidence' });
  const board = await work.board({ principal: owner, projectId: 'alpha' });
  expect(board.wip).toMatchObject({ project: { used: 1, limit: 3 }, personal: { used: 1, limit: 1 } });
  expect(board.items).toContainEqual(expect.objectContaining({ taskId: 'blocked', blockedReason: 'Waiting for evidence' }));
  expect((await work.board({ projectId: 'alpha' })).wip).toBeUndefined();
  expect((await work.board({ projectId: 'alpha', principal: outsider })).wip).toBeUndefined();
  expect((await work.packet({ taskId: 'blocked' })).items).toContainEqual({ kind: 'blocker', text: 'Waiting for evidence' });
  await update('blocked', { verification: 'Checked' });
  const n = await read('blocked');
  await work.review({ op: 'request', principal: owner, taskId: 'blocked', expectedRevision: n.revision, expectedGeneration: n.frontmatter.claim_generation, requestId: 'board-review' });
  expect((await work.board({ projectId: 'alpha' })).items).toContainEqual(expect.objectContaining({ review: expect.objectContaining({ decision: 'request' }) }));
});

test('spec shared guard does not overwrite newly normalized task disposition or status metadata', async () => {
  const { create, claim, update, read } = await workFixture();
  await create('metadata'); await claim('metadata');
  await update('metadata', { retrospective: 'Old lesson' });
  await update('metadata', { status: 'completed', reason: 'Completed with evidence', verification: 'Checked', retrospective: 'Current lesson' });
  const n = await read('metadata');
  expect(n.frontmatter.retrospective).toBe('Current lesson');
  expect(n.frontmatter.knowledge_dispositions).toEqual(['retrospective']);
  expect(n.frontmatter.status_reason).toBe('Completed with evidence');
});

test('spec packet filters newly hidden and author-private discussions and invalidates continuations', async () => {
  const { fs, work, create } = await workFixture();
  const path = 'Community/Posts/existing-topic.md';
  await fs.writeNote({ path, content: 'Never hydrate this body', frontmatter: { mcpvault_type: 'blog_post', post_id: 'existing-topic', status: 'published' } });
  await create('discussion', { discussionSlug: 'existing-topic' });
  for (const patch of [{ moderation_status: 'hidden' }, { moderation_status: 'visible', status: 'draft' }]) {
    const first = await work.packet({ taskId: 'discussion', limit: 1 });
    const n = await fs.readNote(path);
    await fs.writeNote({ path, content: n.content, frontmatter: { ...n.frontmatter, ...patch }, expectedRevision: n.revision });
    const packet = await work.packet({ taskId: 'discussion', maxChars: 12000 });
    expect(JSON.stringify(packet)).not.toContain('existing-topic');
    if (patch.moderation_status === 'hidden') await expect(work.packet({ taskId: 'discussion', cursor: first.cursor })).rejects.toThrow(/cursor/i);
  }
});

test('spec project room configuration requires an existing visible room and guards its revision', async () => {
  const { fs, work, owner, refs, auth, tasks } = await workFixture();
  const p = await fs.readNote('Community/Projects/alpha.md');
  const params = { op: 'update' as const, projectId: 'alpha', principal: owner, expectedRevision: p.revision, requestId: 'room-config' };
  await expect(work.project({ ...params, roomId: 'absent' })).rejects.toThrow(/room|unavailable/i);
  const path = 'Community/ChatRooms/team.md';
  await fs.writeNote({ path, content: 'Team', frontmatter: { mcpvault_type: 'chat_room', room_id: 'team', status: 'open', moderation_status: 'hidden' } });
  await expect(work.project({ ...params, roomId: 'team' })).rejects.toThrow(/room|unavailable/i);
  let room = await fs.readNote(path);
  await fs.writeNote({ path, content: room.content, frontmatter: { ...room.frontmatter, moderation_status: 'visible' }, expectedRevision: room.revision });
  await work.project({ ...params, roomId: 'team' });
  expect((await work.project({ projectId: 'alpha' })).project.room_id).toBe('team');
  const { WorkService } = await import('./work-service.js');
  let checks = 0;
  const guarded = new WorkService(fs, refs, auth, tasks, { assertActor: async () => {
    if (++checks === 2) {
      room = await fs.readNote(path);
      await fs.writeNote({ path, content: room.content, frontmatter: { ...room.frontmatter, moderation_status: 'hidden' }, expectedRevision: room.revision });
    }
  } });
  const current = await fs.readNote('Community/Projects/alpha.md');
  await expect(guarded.project({ ...params, roomId: 'team', expectedRevision: current.revision, wipLimit: 2, requestId: 'room-race' })).rejects.toThrow(/revision|unavailable/i);
  expect((await fs.readNote('Community/Projects/alpha.md')).revision).toBe(current.revision);
  expect((await work.project({ projectId: 'alpha' })).project.room_id).toBeUndefined();
});

test('spec task discussion writes reject missing or private posts', async () => {
  const { fs, create } = await workFixture();
  await expect(create('missing-discussion', { discussionSlug: 'absent' })).rejects.toThrow(/post|unavailable/i);
  await fs.writeNote({ path: 'Community/Posts/private.md', content: 'Private author draft', frontmatter: { mcpvault_type: 'blog_post', post_id: 'private', status: 'draft', author: 'owner' } });
  await expect(create('private-discussion', { discussionSlug: 'private' })).rejects.toThrow(/post|public|unavailable/i);
});

test('spec legacy direct read and update reject hidden unprojected tasks without an attached guard', async () => {
  const { tasks, owner, fs } = await fixture();
  const task = await tasks.create({ principal: owner, taskId: 'hidden-direct', title: 'Hidden', description: 'Hidden body' });
  const n = await fs.readNote(task.path);
  await fs.writeNote({ path: task.path, content: n.content, frontmatter: { ...n.frontmatter, moderation_status: 'hidden' }, expectedRevision: n.revision });
  const hidden = await fs.readNote(task.path);
  await expect(tasks.read({ taskId: task.taskId })).rejects.toThrow(/unavailable|moderation|hidden/i);
  await expect(tasks.update({ principal: owner, taskId: task.taskId, description: 'Must not write', expectedRevision: hidden.revision })).rejects.toThrow(/unavailable|moderation|hidden/i);
});

test('spec project truncation preserves exact identifiers and returns omitted fields plus a callable continuation', async () => {
  const { fs, work } = await workFixture();
  const path = 'Community/Projects/alpha.md';
  const n = await fs.readNote(path);
  const ownerId = 'o'.repeat(64);
  await fs.writeNote({ path, content: n.content, frontmatter: { ...n.frontmatter, owner_account_id: ownerId, created_at: 'c'.repeat(64), updated_at: 'u'.repeat(64), goal: 'G'.repeat(2000), allowed_work: Array.from({ length: 20 }, () => 'A'.repeat(500)), completion_criteria: Array.from({ length: 20 }, () => 'C'.repeat(500)) }, expectedRevision: n.revision });
  const small = await work.project({ projectId: 'alpha', maxChars: 512 });
  expect(JSON.stringify(small).length).toBeLessThanOrEqual(512);
  expect(small.omittedFields.length).toBeGreaterThan(0);
  if (small.project.owner_account_id !== undefined) expect(small.project.owner_account_id).toBe(ownerId);
  else expect(small.omittedFields).toContain('owner_account_id');
  expect(small.nextAction).toEqual({ tool: 'work.project', arguments: { op: 'read', projectId: 'alpha', maxChars: 12000 } });
  const large = await work.project(small.nextAction.arguments);
  expect(large.nextAction).toEqual({ tool: 'notes.read', arguments: { path, expectedRevision: large.revision, maxChars: 12000 } });
});

test('overlap warnings compare resource occurrences and do not warn for duplicate locators in one task', async () => {
  const { create, work } = await workFixture();
  const artifact = { repository: 'https://example.test/repo', commit: 'a'.repeat(40), files: ['shared.ts'] };
  await create('first', { artifacts: [artifact, artifact] });
  expect((await work.board({ projectId: 'alpha' })).items[0]?.warning).toBeUndefined();
  await create('second', { artifacts: [artifact] });
  await create('unrelated', { artifacts: [{ ...artifact, files: ['other.ts'] }] });
  const board = await work.board({ projectId: 'alpha' });
  expect(board.items.filter((item: any) => item.warning).map((item: any) => item.taskId)).toEqual(['first', 'second']);
});
