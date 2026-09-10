import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService, type ScopePrincipal } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';
import { WorkService } from './work-service.js';
import { StoryService } from './story-service.js';
import { withStoryWrite } from './story-boundary.js';
import { GitHistoryService } from './git-history.js';
import { FrontmatterHandler } from './frontmatter.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-story-reconnect-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy(), refs = new ReferenceService(fs, access), auth = new ScopeAuthService(root);
  const actors: Record<string, ScopePrincipal> = {};
  for (const id of ['owner', 'alice', 'bob', 'carol']) actors[id] = (await auth.register({ accountId: id, modelId: id, password: 'fixture-password-only' })).principal;
  const tasks = new AgentTaskService(fs, refs, auth), work = new WorkService(fs, refs, auth, tasks);
  const service = new StoryService(fs, access, refs, auth, work, tasks);
  const execute = (params: Record<string, unknown>, actor = actors.owner!) => service.execute('session', { projectId: 'novel', sessionId: 'drafting', ...params }, actor);
  const project = await service.execute('project', { op: 'create', projectId: 'novel', title: 'Novel', brief: { medium: 'novel' },
    participants: ['alice', 'bob', 'carol'], showrunnerAccountId: 'owner', expectedRevision: 'missing', requestId: 'project' }, actors.owner);
  const artifact = await service.execute('artifact', { op: 'create', projectId: 'novel', artifactId: 'scene', kind: 'scene', title: 'Scene',
    content: 'Original scene.', data: {}, branchId: 'main', expectedRevision: 'missing', expectedProjectRevision: project.revision, requestId: 'scene' }, actors.alice);
  const session = await execute({ op: 'start', artifactId: 'scene', writerAccountId: 'alice', editorAccountId: 'owner',
    expectedRevision: 'missing', expectedProjectRevision: project.revision, requestId: 'session' });
  const taskPath = `Community/Tasks/${session.taskId}.md`;
  const task = () => fs.readNote(taskPath);
  const claim = async (account: string, op: 'claim' | 'release' = 'claim') => {
    const current = await task(); return work.claim({ op, taskId: session.taskId, principal: actors[account], reason: 'Explicit assignment change.',
      expectedRevision: current.revision, expectedGeneration: current.frontmatter.claim_generation, requestId: `${op}-${current.frontmatter.claim_generation}` });
  };
  const handoff = async (from: string, to: string) => {
    let current = await task();
    await work.handoff({ op: 'propose', taskId: session.taskId, principal: actors[from], toAccountId: to, nextAction: 'Continue the scene.',
      expectedRevision: current.revision, expectedGeneration: current.frontmatter.claim_generation, requestId: `offer-${current.frontmatter.claim_generation}` });
    current = await task(); const proposalRevision = current.revision;
    await work.handoff({ op: 'accept', taskId: session.taskId, principal: actors[to], expectedRevision: current.revision,
      expectedGeneration: current.frontmatter.claim_generation, requestId: `accept-${current.frontmatter.claim_generation}` });
    return proposalRevision;
  };
  await claim('alice');
  const paused = await execute({ op: 'pause', reason: 'Transfer drafting.', expectedRevision: session.revision,
    expectedProjectRevision: project.revision, requestId: 'pause' });
  const preview = (extra = {}) => execute({ op: 'reconnect_preview', ...extra });
  const resume = async (proof: Record<string, any>, extra = {}) => execute({ op: 'resume', reconnectWriter: true,
    expectedRevision: paused.revision, expectedProjectRevision: project.revision,
    expectedWorkRevision: proof.expectedWorkRevision, expectedWorkGeneration: proof.expectedWorkGeneration,
    reconnectProofFingerprint: proof.reconnectProofFingerprint, requestId: 'reconnect', ...extra });
  return { root, fs, access, refs, auth, tasks, work, service, actors, project, artifact, session, paused, task, taskPath, claim, handoff, execute, preview, resume };
}

test('Work accepts record exact generation edges and Story pins its observed initial Work binding', async () => {
  const f = await fixture();
  const proposal = await f.handoff('alice', 'bob');
  const current = await f.task();
  expect(current.frontmatter.work_changes.at(-1)).toMatchObject({ action: 'handoff.accept', actor: 'bob',
    fromAccountId: 'alice', toAccountId: 'bob', fromGeneration: 1, toGeneration: 2, proposalRevision: proposal, acceptorAccountId: 'bob' });
  const saved = await f.fs.readNote(f.session.path);
  expect(saved.frontmatter.work_binding).toMatchObject({ generation: 0, assigneeAccountId: null });
  expect(saved.frontmatter.work_binding.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(current.frontmatter.work_changes).toHaveLength(4);
});

test('current records prove Alice to Bob to Carol; explicit proof reconnect preserves Work, editor and artifacts', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); await f.handoff('bob', 'carol');
  const current = await f.task();
  const proof = await f.preview();
  expect(proof).toMatchObject({ hopCount: 2, writerAccountId: 'carol', gitHistoryUsed: false,
    expectedWorkRevision: current.revision, expectedWorkGeneration: 3 });
  expect(proof.reconnectProofFingerprint).toMatch(/^[a-f0-9]{64}$/);
  await expect(f.resume(proof, { reconnectProofFingerprint: undefined })).rejects.toThrow(/proof/i);
  const resumed = await f.resume(proof);
  expect(resumed).toMatchObject({ stage: 'draft', writerAccountId: 'carol', editorAccountId: 'owner', taskId: f.session.taskId });
  expect(await f.resume(proof)).toMatchObject({ revision: resumed.revision, replayed: true });
  expect((await f.task()).revision).toBe(current.revision);
  expect((await f.fs.readNote(f.artifact.path)).revision).toBe(f.artifact.revision);
  expect((await f.fs.readNote(f.session.path)).frontmatter.work_binding).toMatchObject({ revision: current.revision, generation: 3, assigneeAccountId: 'carol' });
});

test('preview is authenticated showrunner-only but allowed on a read-only Story server', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob');
  const readonly = new StoryService(f.fs, f.access, f.refs, f.auth, f.work, f.tasks, { readOnly: true });
  const params = { projectId: 'novel', sessionId: 'drafting', op: 'reconnect_preview' };
  expect(await readonly.execute('session', params, f.actors.owner)).toMatchObject({ writerAccountId: 'bob' });
  await expect(readonly.execute('session', params)).rejects.toThrow(/auth/i);
  await expect(readonly.execute('session', params, f.actors.alice)).rejects.toThrow(/showrunner/i);
  const proof = await f.preview();
  await expect(readonly.execute('session', { ...params, op: 'resume', reconnectWriter: true, expectedRevision: f.paused.revision,
    expectedProjectRevision: f.project.revision, expectedWorkRevision: proof.expectedWorkRevision,
    expectedWorkGeneration: proof.expectedWorkGeneration, requestId: 'readonly' }, f.actors.owner)).rejects.toThrow(/read-only/i);
});

test('release and reclaim break continuity even when the final accepted handoff names the original writer', async () => {
  const f = await fixture(); await f.claim('alice', 'release'); await f.claim('alice'); await f.handoff('alice', 'bob');
  await expect(f.preview()).rejects.toThrow(/continuity|proven|new session/i);
  const task = await f.task();
  await expect(f.execute({ op: 'resume', reconnectWriter: true, expectedRevision: f.paused.revision, expectedProjectRevision: f.project.revision,
    expectedWorkRevision: task.revision, expectedWorkGeneration: task.frontmatter.claim_generation, requestId: 'gap' })).rejects.toThrow(/continuity|proven|new session/i);
  expect((await f.fs.readNote(f.session.path)).revision).toBe(f.paused.revision);
});

test('preview fingerprints and replay revalidate Work assignment and generation', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); const proof = await f.preview();
  await f.handoff('bob', 'carol');
  await expect(f.resume(proof)).rejects.toThrow(/Work|proof|revision/i);
  const fresh = await f.preview(); await f.resume(fresh);
  await f.claim('carol', 'release');
  await expect(f.resume(fresh)).rejects.toThrow(/Work|binding|assignment|replay/i);
});

test('legacy session requires a unique writer origin and never guesses across a repeated writer', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); await f.handoff('bob', 'alice'); await f.handoff('alice', 'carol');
  const current = await f.fs.readNote(f.session.path); const frontmatter = { ...current.frontmatter }; delete frontmatter.work_binding;
  await withStoryWrite(f.session.path, () => f.fs.writeNote({ path: f.session.path, content: current.content, frontmatter, expectedRevision: current.revision }));
  await expect(f.preview()).rejects.toThrow(/continuity|proven|new session/i);
});

async function gitFixture(commitMiddle = true) {
  const f = await fixture(); const history = new GitHistoryService(f.root);
  (f.service.workspace.options as any).gitHistory = history;
  await history.initialize();
  const commit = (reason: string) => history.commitChanges({ reason, paths: [f.taskPath], authorName: 'Fixture', authorEmail: 'fixture@example.invalid' });
  await commit('Actual first claim');
  await f.handoff('alice', 'bob'); if (commitMiddle) await commit('Actual Alice to Bob acceptance');
  await f.handoff('bob', 'carol'); await commit('Actual Bob to Carol acceptance');
  // Expire all old current events through real unrelated task mutations. A
  // retained old receipt in a later committed state is not an accepted state.
  for (let index = 0; index < 17; index++) {
    const task = await f.task();
    await f.tasks.update({ taskId: f.session.taskId, principal: f.actors.carol, description: `Progress ${index}`,
      expectedRevision: task.revision, expectedGeneration: task.frontmatter.claim_generation, requestId: `progress-${index}` });
  }
  await commit('Later progress does not prove any missing acceptance');
  return { ...f, history, commit };
}

test('explicit Git history recovers evicted accepted states and pins HEAD without changing Work or artifacts', async () => {
  const f = await gitFixture(); const current = await f.task();
  expect(current.frontmatter.work_changes).toHaveLength(16);
  const read = vi.spyOn(f.history, 'taskHandoffHistory' as any);
  await expect(f.preview()).rejects.toThrow(/continuity|proven|new session/i);
  expect(read).not.toHaveBeenCalled();
  const proof = await f.preview({ includeGitHistory: true });
  expect(proof).toMatchObject({ hopCount: 2, writerAccountId: 'carol', gitHistoryUsed: true });
  const resumed = await f.resume(proof, { includeGitHistory: true });
  expect(resumed.writerAccountId).toBe('carol');
  expect(await f.resume(proof, { includeGitHistory: true })).toMatchObject({ replayed: true, revision: resumed.revision });
  expect((await f.task()).revision).toBe(current.revision);
  expect((await f.fs.readNote(f.artifact.path)).revision).toBe(f.artifact.revision);
}, 30000);

test('Git cannot invent an uncommitted middle handoff from copied old events in a later snapshot', async () => {
  const f = await gitFixture(false);
  await expect(f.preview({ includeGitHistory: true })).rejects.toThrow(/continuity|proven|new session/i);
  expect((await f.fs.readNote(f.session.path)).revision).toBe(f.paused.revision);
}, 30000);

test('a new Git HEAD invalidates a previously previewed reconnect proof', async () => {
  const f = await gitFixture(); const proof = await f.preview({ includeGitHistory: true });
  await f.fs.writeNote({ path: 'Unrelated.md', content: 'A new committed observation.', expectedRevision: 'missing' });
  await f.history.commitChanges({ reason: 'New HEAD', paths: ['Unrelated.md'], authorName: 'Fixture', authorEmail: 'fixture@example.invalid' });
  await expect(f.resume(proof, { includeGitHistory: true })).rejects.toThrow(/proof|changed/i);
  expect((await f.fs.readNote(f.session.path)).revision).toBe(f.paused.revision);
}, 30000);

async function editTask(f: Awaited<ReturnType<typeof fixture>>, change: (fm: Record<string, any>) => void) {
  const task = await f.task(); const fm = structuredClone(task.frontmatter); change(fm);
  await writeFile(join(f.root, f.taskPath), new FrontmatterHandler().stringify(fm, task.content));
}

test('a contradictory current accepted state fails closed without consulting Git', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob');
  await editTask(f, fm => { fm.work_handoff.generation = 99; });
  const history = new GitHistoryService(f.root); (f.service.workspace.options as any).gitHistory = history;
  const read = vi.spyOn(history, 'taskHandoffHistory');
  await expect(f.preview({ includeGitHistory: true })).rejects.toThrow(/continuity|proven/i);
  expect(read).not.toHaveBeenCalled();
});

test('known release gaps are not retried against Git when an initial claim event is missing', async () => {
  const f = await fixture(); await f.claim('alice', 'release'); await f.claim('alice'); await f.handoff('alice', 'bob');
  await editTask(f, fm => { fm.work_changes = fm.work_changes.filter((event: any) => !(event.action === 'claim.claim' && event.generation === 1)); });
  const history = new GitHistoryService(f.root); (f.service.workspace.options as any).gitHistory = history;
  const read = vi.spyOn(history, 'taskHandoffHistory');
  await expect(f.preview({ includeGitHistory: true })).rejects.toThrow(/continuity|proven/i);
  expect(read).not.toHaveBeenCalled();
});

test('an old reconnect receipt cannot replay after the stored binding changes while Work stays unchanged', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); const proof = await f.preview(); const resumed = await f.resume(proof);
  await f.execute({ op: 'pause', reason: 'Pause again.', expectedRevision: resumed.revision, expectedProjectRevision: f.project.revision, requestId: 'pause-again' });
  const saved = await f.fs.readNote(f.session.path); const fm = structuredClone(saved.frontmatter); fm.work_binding.generation++;
  await withStoryWrite(f.session.path, () => f.fs.writeNote({ path: f.session.path, content: saved.content, frontmatter: fm, expectedRevision: saved.revision }));
  await expect(f.resume(proof)).rejects.toThrow(/binding/i);
  expect((await f.task()).revision).toBe(proof.expectedWorkRevision);
});

test('Work drift at the actual guarded writer leaves the Story session untouched', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); await f.handoff('bob', 'carol'); const proof = await f.preview();
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs); let injected = false;
  vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    if (args[0].path === f.session.path && !injected) { injected = true; await editTask(f, fm => { fm.claim_generation++; }); }
    return original(...args);
  });
  await expect(f.resume(proof)).rejects.toThrow(/revision|proof|continuity|changed/i);
  expect(injected).toBe(true); expect((await f.fs.readNote(f.session.path)).revision).toBe(f.paused.revision);
});

test('token revocation after real writer access checking blocks the final Story mutation', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); const proof = await f.preview();
  const login = await f.auth.login({ accountId: 'owner', password: 'fixture-password-only' });
  f.service.workspace.options.assertActor = async principal => {
    if (f.auth.authenticate(login.accessToken)?.accountId !== principal.accountId) throw new Error('Story account revoked');
  };
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs); let revoked = false;
  vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (write, guards, options) => original(write, guards, {
    ...options, assertAccess: async () => { await options?.assertAccess?.(); if (!revoked) { f.auth.logout(login.accessToken); revoked = true; } },
  }));
  await expect(f.resume(proof)).rejects.toThrow(/revoked|access token/i);
  expect(revoked).toBe(true); expect((await f.fs.readNote(f.session.path)).revision).toBe(f.paused.revision);
});

test('all-legacy accept events plus a create marker cannot hide a repeated original writer', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); await f.handoff('bob', 'alice'); await f.handoff('alice', 'carol');
  const saved = await f.fs.readNote(f.session.path); const fm = structuredClone(saved.frontmatter); delete fm.work_binding;
  await withStoryWrite(f.session.path, () => f.fs.writeNote({ path: f.session.path, content: saved.content, frontmatter: fm, expectedRevision: saved.revision }));
  await editTask(f, task => {
    for (const event of task.work_changes) for (const key of ['fromAccountId', 'toAccountId', 'fromGeneration', 'toGeneration', 'proposalRevision', 'acceptorAccountId']) delete event[key];
  });
  await expect(f.preview()).rejects.toThrow(/continuity|proven/i);
});

test('Git history cannot legitimize live Work rolled back behind a committed assignment', async () => {
  const f = await gitFixture();
  const history = await f.history.taskHandoffHistory(f.taskPath, () => true);
  const previous = history.observations.map(o => new FrontmatterHandler().parse(o.content)).find(n => n.frontmatter.claim_generation === 2)!;
  previous.frontmatter.work_changes = previous.frontmatter.work_changes.filter((event: any) => event.action !== 'claim.claim');
  await writeFile(join(f.root, f.taskPath), new FrontmatterHandler().stringify(previous.frontmatter, previous.content));
  await expect(f.preview({ includeGitHistory: true })).rejects.toThrow(/continuity|proven/i);
  expect((await f.fs.readNote(f.session.path)).revision).toBe(f.paused.revision);
}, 30000);

test('reconnect replay rejects a writer removed from Work membership without changing task or Story revision', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); const proof = await f.preview(); await f.resume(proof);
  const project = await f.fs.readNote('Community/Projects/novel.md');
  await f.work.project({ op: 'update', projectId: 'novel', participants: ['owner', 'alice', 'carol'], principal: f.actors.owner,
    expectedRevision: project.revision, requestId: 'remove-work-writer' });
  await expect(f.resume(proof)).rejects.toThrow(/member|participant|delegate/i);
  expect((await f.task()).revision).toBe(proof.expectedWorkRevision);
});

test('claimed bindings reject known later release gaps before a missing edge can trigger Git', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob'); const proof = await f.preview(); const resumed = await f.resume(proof);
  await f.execute({ op: 'pause', reason: 'Pause again.', expectedRevision: resumed.revision, expectedProjectRevision: f.project.revision, requestId: 'pause-again' });
  await f.handoff('bob', 'carol'); await f.claim('carol', 'release'); await f.claim('carol'); await f.handoff('carol', 'alice');
  await editTask(f, fm => { fm.work_changes = fm.work_changes.filter((event: any) => !(event.action === 'handoff.accept' && event.fromGeneration === 2)); });
  const history = new GitHistoryService(f.root); (f.service.workspace.options as any).gitHistory = history;
  const read = vi.spyOn(history, 'taskHandoffHistory');
  await expect(f.preview({ includeGitHistory: true })).rejects.toThrow(/continuity|proven/i);
  expect(read).not.toHaveBeenCalled();
});

test('a uniquely proven all-legacy single handoff retains explicit resume compatibility', async () => {
  const f = await fixture(); await f.handoff('alice', 'bob');
  const saved = await f.fs.readNote(f.session.path); const fm = structuredClone(saved.frontmatter); delete fm.work_binding;
  await withStoryWrite(f.session.path, () => f.fs.writeNote({ path: f.session.path, content: saved.content, frontmatter: fm, expectedRevision: saved.revision }));
  await editTask(f, task => {
    for (const event of task.work_changes) for (const key of ['fromAccountId', 'toAccountId', 'fromGeneration', 'toGeneration', 'proposalRevision', 'acceptorAccountId']) delete event[key];
  });
  const proof = await f.preview();
  expect(proof).toMatchObject({ hopCount: 1, writerAccountId: 'bob', gitHistoryUsed: false });
  expect(await f.resume(proof, { expectedRevision: await f.fs.readNoteRevision(f.session.path), reconnectProofFingerprint: undefined })).toMatchObject({ writerAccountId: 'bob', editorAccountId: 'owner' });
});
