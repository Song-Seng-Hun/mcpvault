import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService, type ScopePrincipal } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';
import { WorkService } from './work-service.js';
import { IdeationService } from './ideation.js';
import { RoleplayService } from './roleplay-service.js';
import { RoleplayStore } from './roleplay-store.js';
import { roleplayRevision } from './roleplay-model.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-story-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const refs = new ReferenceService(fs, access), auth = new ScopeAuthService(root);
  const actors: Record<string, ScopePrincipal> = {};
  for (const id of ['owner', 'writer', 'outsider']) actors[id] = (await auth.register({ accountId: id, modelId: id, password: 'fixture-password-only' })).principal;
  const tasks = new AgentTaskService(fs, refs, auth), work = new WorkService(fs, refs, auth, tasks);
  const module = await import('./story-service.js').catch(() => ({ StoryService: undefined }));
  expect(module.StoryService, 'StoryService exists').toBeTypeOf('function');
  const service = new module.StoryService!(fs, access, refs, auth, work, tasks);
  let counter = 0;
  const execute = (endpoint: string, params: Record<string, unknown>, principal = actors.owner!) => service.execute(endpoint, params, principal);
  const project = async (projectId = 'novel') => execute('project', { op: 'create', projectId, title: '기억의 도서관',
    brief: { medium: 'novel', audience: 'adult', genre: 'mystery', theme: 'memory', style: 'concise', targetLength: 'three scenes', forbidden: ['gratuitous violence'] },
    participants: ['writer'], showrunnerAccountId: 'owner', expectedRevision: 'missing', requestId: `create-${projectId}` });
  const current = (projectId = 'novel') => execute('project', { projectId });
  const put = async (artifactId: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, principal = actors.writer!) => {
    const p = await current(String(extra.projectId || 'novel'));
    return execute('artifact', { op: 'create', projectId: 'novel', artifactId, ...(extra.op === 'update' ? {} : { kind: 'scene' }), title: artifactId,
      content: `# ${artifactId}\n장면 원고.`, branchId: 'main', data, expectedRevision: 'missing', expectedProjectRevision: p.revision,
      requestId: `put-${++counter}`, ...extra }, principal);
  };
  return { root, fs, access, refs, auth, tasks, work, actors, service, execute, project, current, put };
}

test('story creation explicitly opts in, reuses Work, verifies real participants, and rejects anonymous or spoofed ownership', async () => {
  const f = await fixture();
  await expect(f.service.execute('project', { op: 'create', projectId: 'bad', title: 'Bad' })).rejects.toThrow(/auth/i);
  const created = await f.project();
  expect(created).toMatchObject({ projectId: 'novel', enabled: true, showrunnerAccountId: 'owner' });
  const work = await f.work.project({ projectId: 'novel' });
  expect(work).toBeDefined();
  expect((await f.fs.readNote(created.path)).frontmatter.fiction_domain).toBe('story');
  expect(await f.project()).toMatchObject({ revision: created.revision, replayed: true });
  await expect(f.execute('project', { op: 'create', projectId: 'unknown', title: 'Unknown', participants: ['invented'],
    requestId: 'unknown', expectedRevision: 'missing', brief: { medium: 'novel' } })).rejects.toThrow(/registered|participant/i);
  await expect(f.execute('project', { op: 'update', projectId: 'novel', ownerAccountId: 'writer', expectedRevision: created.revision,
    requestId: 'spoof' }, f.actors.writer)).rejects.toThrow();
});

test('artifact writes are revision-safe, replayable and concurrent updates have one winner', async () => {
  const f = await fixture(); await f.project(); const scene = await f.put('opening'); const project = await f.current();
  const request = { op: 'update', projectId: 'novel', artifactId: 'opening', content: 'Changed scene',
    expectedRevision: scene.revision, expectedProjectRevision: project.revision, requestId: 'edit-opening' };
  const edited = await f.execute('artifact', request, f.actors.writer);
  expect(await f.execute('artifact', request, f.actors.writer)).toMatchObject({ revision: edited.revision, replayed: true });
  await expect(f.execute('artifact', { ...request, content: 'other payload' }, f.actors.writer)).rejects.toThrow(/requestId|payload/i);
  const race = await Promise.allSettled(['a', 'b'].map(requestId => f.execute('artifact', { ...request, requestId, expectedRevision: edited.revision }, f.actors.writer)));
  expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  await expect(f.put('outsider-scene', {}, {}, f.actors.outsider)).rejects.toThrow(/participant|member/i);
});

test('explicit committed TRPG turn import creates only a fictional Story draft with source pins', async () => {
  const f = await fixture(); await f.project();
  const hostPath = await mkdtemp(join(tmpdir(), 'story-trpg-host-')); roots.push(hostPath);
  const store = await RoleplayStore.open({ vaultPath: f.root, hostPath, policy: { administrators: ['owner'] } });
  const roleplay = new RoleplayService(f.fs, f.access, f.refs, store, { assertActor: async () => {} });
  (f.service.workspace.options as any).readRoleplayTurn = (source: any, actor: ScopePrincipal) => (roleplay as any).storyTurn(source, actor);
  const write = async (endpoint: string, args: Record<string, unknown>) => roleplay.execute(endpoint, { ...args, requestId: `turn-${(await store.snapshot()).sequence}`, expectedRevision: roleplayRevision(await store.snapshot()) }, f.actors.owner);
  try {
    await write('world', { op: 'initialize', title: 'Fictional hall', places: { hall: [] } });
    await f.fs.writeNote({ path: 'Community/ChatRooms/hall.md', content: 'Hall', frontmatter: { mcpvault_type: 'chat_room', status: 'open' } });
    for (const id of ['iris','moss']) await write('character', { op: 'character', id, name: id, controller: 'owner', location: 'hall' });
    await write('scene', { op: 'scene', roomId: 'hall', location: 'hall', title: 'Hall', gm: 'owner' });
    await write('trpg', { op: 'adopt', preset: 'mcpvault-adventure@1.0.0' });
    const turn = await write('trpg', { op: 'encounter_start', roomId: 'hall', participants: ['iris','moss'] });
    const before = roleplayRevision(await store.snapshot()), p = await f.current();
    const params = { op: 'create', projectId: 'novel', artifactId: 'turn-draft', kind: 'scene', title: 'Imported encounter',
      expectedRevision: 'missing', expectedProjectRevision: p.revision, requestId: 'import-turn',
      roleplayTurn: { turnId: turn.id, revision: turn.revision, noteRevision: turn.noteRevision, shareable: true } };
    const imported = await f.execute('artifact', params, f.actors.writer), note = await f.fs.readNote(imported.path);
    expect(note.frontmatter).toMatchObject({ fiction_domain: 'story', roleplay_source: params.roleplayTurn });
    expect(note.content).toContain('Fictional TRPG draft');
    expect(note.frontmatter.source_revisions).toContainEqual({ path: turn.path, expectedRevision: turn.noteRevision });
    expect(note.frontmatter.source_revisions).toContainEqual({ path: 'Community/ChatRooms/hall.md', expectedRevision: expect.any(String) });
    expect(note.frontmatter).not.toHaveProperty('accepted');
    expect(await f.execute('artifact', params, f.actors.writer)).toMatchObject({ revision: imported.revision, replayed: true });
    await expect(f.execute('artifact', { ...params, artifactId: 'stale-turn', requestId: 'stale', roleplayTurn: { ...params.roleplayTurn, noteRevision: '0'.repeat(64) } }, f.actors.writer)).rejects.toThrow(/revision|changed|unavailable/i);
    await expect(f.execute('artifact', { ...params, artifactId: 'unapproved', requestId: 'no-share', roleplayTurn: { ...params.roleplayTurn, shareable: false } }, f.actors.writer)).rejects.toThrow(/shareable/i);
    const room = await f.fs.readNote('Community/ChatRooms/hall.md');
    await f.fs.writeNote({ path: 'Community/ChatRooms/hall.md', content: room.content, frontmatter: { ...room.frontmatter, status: 'closed' }, expectedRevision: room.revision });
    await expect(f.execute('artifact', params, f.actors.writer)).rejects.toThrow(/room|unavailable/i);
    expect(roleplayRevision(await store.snapshot())).toBe(before);
  } finally { await store.close(); }
});

test('generic writes cannot forge story governance, accepted snapshots, reviews or ancestor moves', async () => {
  const f = await fixture(); const p = await f.project(); const scene = await f.put('scene');
  await expect(f.fs.writeNote({ path: p.path, content: 'forged', expectedRevision: p.revision })).rejects.toThrow(/story|managed/i);
  await expect(f.fs.updateFrontmatter({ path: scene.path, frontmatter: { accepted: true }, expectedRevision: scene.revision })).rejects.toThrow(/story|managed/i);
  await expect(f.fs.writeNote({ path: 'Community/Stories/novel/Adoptions/fake.md', content: 'fake', expectedRevision: 'missing' })).rejects.toThrow(/story|managed/i);
  await expect(f.fs.deleteNote({ path: scene.path, confirmPath: scene.path, expectedRevision: scene.revision })).rejects.toThrow(/story|managed/i);
  await expect(f.fs.moveFile({ oldPath: 'Community/Stories', newPath: 'MovedStories', confirmOldPath: 'Community/Stories', confirmNewPath: 'MovedStories' })).rejects.toThrow(/story|managed/i);
  await expect(f.fs.moveFile({ oldPath: 'Community', newPath: 'MovedCommunity', confirmOldPath: 'Community', confirmNewPath: 'MovedCommunity' })).rejects.toThrow(/story|managed|legacy|roleplay/i);
});

test('adoption retains an immutable snapshot, requires current showrunner and rejects stale source or review', async () => {
  const f = await fixture(); const p = await f.project(); const a = await f.put('scene');
  const review = await f.execute('review', { op: 'create', projectId: 'novel', reviewId: 'edit', artifactId: 'scene', sourceRevision: a.revision,
    content: 'Preserve the uncertain narrator.', findings: [{ classification: 'intentional_exception', text: 'The narrator is mistaken.' }],
    expectedProjectRevision: p.revision, expectedRevision: 'missing', requestId: 'review' }, f.actors.writer);
  const request = { projectId: 'novel', artifactId: 'scene', sourceRevision: a.revision, reviewIds: ['edit'], reason: 'Adopt this scene',
    expectedProjectRevision: p.revision, expectedRevision: 'missing', requestId: 'adopt' };
  await expect(f.execute('adopt', request, f.actors.writer)).rejects.toThrow(/showrunner/i);
  const adopted = await f.execute('adopt', request);
  expect((await f.fs.readNote(adopted.path)).content).toContain('장면 원고');
  expect(await f.execute('adopt', request)).toMatchObject({ revision: adopted.revision, replayed: true });
  await f.put('scene', {}, { op: 'update', content: 'An entirely different ending.', expectedRevision: a.revision });
  expect((await f.fs.readNote(adopted.path)).revision).toBe(adopted.revision);
  expect(await f.execute('review', { projectId: 'novel', reviewId: 'edit' })).toMatchObject({ stale: true });
  await expect(f.execute('adopt', { ...request, requestId: 'stale-adopt' })).rejects.toThrow(/stale|revision/i);
  expect(review.revision).toMatch(/^[a-f0-9]{64}$/);
});

test('owner can revoke delegation and the former showrunner cannot adopt or restore itself', async () => {
  const f = await fixture(); const p = await f.project(); const a = await f.put('scene');
  const delegated = await f.execute('project', { op: 'update', projectId: 'novel', showrunnerAccountId: 'writer',
    expectedRevision: p.revision, requestId: 'delegate' });
  const revoked = await f.execute('project', { op: 'update', projectId: 'novel', showrunnerAccountId: 'owner',
    expectedRevision: delegated.revision, requestId: 'revoke' });
  await expect(f.execute('adopt', { projectId: 'novel', artifactId: 'scene', sourceRevision: a.revision, reason: 'old delegate',
    expectedProjectRevision: revoked.revision, expectedRevision: 'missing', requestId: 'old-adopt' }, f.actors.writer)).rejects.toThrow(/showrunner/i);
});

test('context separates branches and character knowledge, and dependency changes mark summaries stale', async () => {
  const f = await fixture(); await f.project();
  const secret = await f.put('secret', { knownBy: ['iris'], layer: 'belief' }, { kind: 'character', content: 'SECRET-MOONFLOWER' });
  const summary = await f.put('summary', { knownBy: ['iris'], layer: 'belief' }, { kind: 'summary', content: 'Derived detail', sources: [{ artifactId: 'secret', revision: secret.revision }] });
  await f.put('alternate', {}, { branchId: 'alternate', content: 'ALTERNATE-END' });
  const actor = await f.execute('context', { projectId: 'novel', characterId: 'moss', maxChars: 1000 });
  expect(JSON.stringify(actor)).not.toContain('SECRET-MOONFLOWER');
  expect(JSON.stringify(actor)).not.toContain('ALTERNATE-END');
  expect(JSON.stringify(actor).length).toBeLessThanOrEqual(1000);
  const iris = await f.execute('context', { projectId: 'novel', characterId: 'iris', maxChars: 6000 });
  expect(JSON.stringify(iris)).toContain('SECRET-MOONFLOWER');
  await f.put('secret', {}, { op: 'update', content: 'Different fact', expectedRevision: secret.revision });
  expect(await f.execute('artifact', { projectId: 'novel', artifactId: 'summary' })).toMatchObject({ stale: true });
  expect(summary.path).toContain('Artifacts');
});

test('foreign and private sources cannot enter a public story through references or nested fields', async () => {
  const f = await fixture(); await f.project(); await f.project('other');
  const foreign = await f.put('foreign', {}, { projectId: 'other' });
  await expect(f.put('bad', {}, { sources: [{ path: foreign.path, revision: foreign.revision }] })).rejects.toThrow(/project|source|field/i);
  await f.fs.writeNote({ path: '_scopes/models/owner/private.md', content: 'PRIVATE-STORY-SECRET' });
  await expect(f.put('private-copy', {}, { references: ['_scopes/models/owner/private.md'] }, f.actors.owner)).rejects.toThrow(/scope|reference|public|unavailable/i);
  await expect(f.put('../escape')).rejects.toThrow(/id|path/i);
});

test('explicit sequences distinguish presentation from chronology and reject alternative contamination', async () => {
  const f = await fixture(); const p = await f.project(); await f.put('first'); await f.put('flashback'); await f.put('alt', {}, { branchId: 'alternate' });
  const ordered = await f.execute('sequence', { op: 'update', projectId: 'novel', branchId: 'main', presentation: ['first', 'flashback'],
    chronology: ['flashback', 'first'], expectedRevision: p.revision, requestId: 'order' });
  expect(ordered.presentation).toEqual(['first', 'flashback']);
  expect(ordered.chronology).toEqual(['flashback', 'first']);
  await expect(f.execute('sequence', { op: 'update', projectId: 'novel', branchId: 'main', presentation: ['alt'], chronology: ['alt'],
    expectedRevision: ordered.revision, requestId: 'bad-order' })).rejects.toThrow(/branch/i);
});

test('external Markdown edits invalidate stale receipts instead of replaying false success', async () => {
  const f = await fixture(); await f.project(); const p = await f.current();
  const request = { op: 'create', projectId: 'novel', artifactId: 'edited', kind: 'scene', title: 'Edited', content: 'Original',
    expectedRevision: 'missing', expectedProjectRevision: p.revision, requestId: 'external-edit' };
  const a = await f.execute('artifact', request);
  const physical = join(f.root, a.path); const raw = await readFile(physical, 'utf8');
  await writeFile(physical, raw.replace('Original', 'Manually edited'), 'utf8');
  await expect(f.execute('artifact', request)).rejects.toThrow(/external|receipt|changed/i);
});

test.each(['adopt', 'reject'])('writer sessions preserve exact %s evidence in Work without automatically completing it', async decision => {
  const f = await fixture(); await f.project(); await f.put('scene');
  let p = await f.current();
  let s = await f.execute('session', { op: 'start', projectId: 'novel', sessionId: 'room', artifactId: 'scene',
    writerAccountId: 'writer', editorAccountId: 'owner', expectedRevision: 'missing', expectedProjectRevision: p.revision, requestId: 'session-start' });
  expect(s.stage).toBe('draft');
  expect((await f.fs.readNote(`Community/Tasks/${s.taskId}.md`)).frontmatter.assignee_account_id).toBeUndefined();
  const change = async (op: string, extra: Record<string, unknown> = {}, actor = f.actors.owner!) => {
    p = await f.current();
    s = await f.execute('session', { op, projectId: 'novel', sessionId: 'room', expectedRevision: s.revision,
      expectedProjectRevision: p.revision, requestId: `session-${op}-${s.revision.slice(0, 32)}`, ...extra }, actor);
    return s;
  };
  for (let round = 0; round < 3; round++) {
    const a = await f.execute('artifact', { projectId: 'novel', artifactId: 'scene' });
    await change('submit', { sourceRevision: a.revision }, f.actors.writer);
    expect(s.stage).toBe('review');
    expect((await f.fs.readNote(`Community/Tasks/${s.taskId}.md`)).frontmatter.assignee_account_id).toBe('writer');
    const review = await f.execute('review', { op: 'create', projectId: 'novel', artifactId: 'scene', reviewId: `pass-${round}`,
      sourceRevision: a.revision, content: 'Consider a sharper ending.', expectedRevision: 'missing', expectedProjectRevision: p.revision, requestId: `pass-${round}` });
    await change('review', { reviewId: `pass-${round}`, sourceRevision: a.revision, decision: 'changes_requested' });
    expect(s.stage).toBe(round === 2 ? 'decision' : 'revise');
    if (round < 2) await f.put('scene', {}, { op: 'update', content: `Revision ${round + 1}`, expectedRevision: a.revision });
    expect(review.revision).toBeTruthy();
  }
  expect(s.revisionRound).toBe(2);
  await expect(change('submit', { sourceRevision: (await f.execute('artifact', { projectId: 'novel', artifactId: 'scene' })).revision }, f.actors.writer)).rejects.toThrow(/stage|decision/i);
  await change('pause', { reason: 'User direction needed.' }); expect(s.stage).toBe('waiting');
  await change('resume', { reason: 'Continue the decision.' }); expect(s.stage).toBe('decision');
  const scene = await f.execute('artifact', { projectId: 'novel', artifactId: 'scene' });
  await f.execute('adopt', { projectId: 'novel', artifactId: 'scene', sourceRevision: scene.revision, reviewIds: ['pass-2'],
    reason: 'Approved final revision.', expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'session-adopt' });
  await change('decide', { decision, sourceRevision: scene.revision, reason: 'Selected snapshot verified.' });
  expect(s.stage).toBe(decision === 'adopt' ? 'completed' : 'rejected');
  expect(s.hostExecutionOnly).toBe(true);
  const packet = await f.work.packet({ taskId: s.taskId, principal: f.actors.writer, maxChars: 12000, limit: 100 });
  const result = packet.items.find((item: any) => item.kind === 'storyResult');
  expect(result, JSON.stringify(packet)).toMatchObject({ path: s.path, revision: s.revision, decision, workStatusIndependent: true,
    artifacts: expect.arrayContaining([{ kind: 'manuscript', path: scene.path, revision: scene.revision, currentRevision: scene.revision, stale: false },
      expect.objectContaining({ kind: 'review', path: 'Community/Stories/novel/Reviews/pass-2.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) })]) });
  if (decision === 'adopt') expect(result.artifacts).toContainEqual(expect.objectContaining({ kind: 'adoption', revision: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  expect((await f.fs.readNote(`Community/Tasks/${s.taskId}.md`)).frontmatter.status).not.toBe('completed');
  const raw = await readFile(join(f.root, scene.path), 'utf8');
  await writeFile(join(f.root, scene.path), raw.replace('Revision 2', 'Changed after decision'));
  const changed = await f.work.packet({ taskId: s.taskId, maxChars: 12000, limit: 100 });
  expect(changed.items.find((item: any) => item.kind === 'storyResult').artifacts).toContainEqual(expect.objectContaining({ kind: 'manuscript', stale: true }));
  await writeFile(join(f.root, scene.path), raw.replace('mcpvault_type:', 'moderation_status: hidden\nmcpvault_type:'));
  const hidden = await f.work.packet({ taskId: s.taskId, maxChars: 12000, limit: 100 });
  expect(hidden.items.some((item: any) => item.kind === 'storyResult')).toBe(false);
});

async function handedOffSession(accept = true) {
  const f = await fixture(); await f.project();
  const workProject = await f.fs.readNote('Community/Projects/novel.md');
  await f.work.project({ op: 'update', projectId: 'novel', participants: ['owner', 'writer', 'outsider'],
    principal: f.actors.owner, expectedRevision: workProject.revision, requestId: 'add-recipient' });
  await f.execute('project', { op: 'update', projectId: 'novel', participants: ['writer', 'outsider'],
    expectedRevision: (await f.current()).revision, requestId: 'story-recipient' });
  const artifact = await f.put('handoff-scene'); const p = await f.current();
  let session = await f.execute('session', { op: 'start', projectId: 'novel', sessionId: 'handoff', artifactId: 'handoff-scene',
    writerAccountId: 'writer', editorAccountId: 'owner', expectedRevision: 'missing', expectedProjectRevision: p.revision, requestId: 'handoff-start' });
  const taskPath = `Community/Tasks/${session.taskId}.md`;
  let task = await f.fs.readNote(taskPath);
  await f.work.claim({ op: 'claim', taskId: session.taskId, principal: f.actors.writer,
    expectedRevision: task.revision, expectedGeneration: task.frontmatter.claim_generation, requestId: 'writer-claim' });
  session = await f.execute('session', { op: 'pause', projectId: 'novel', sessionId: 'handoff', reason: 'Transfer drafting responsibility.',
    expectedRevision: session.revision, expectedProjectRevision: p.revision, requestId: 'handoff-pause' });
  task = await f.fs.readNote(taskPath);
  await f.work.handoff({ op: 'propose', taskId: session.taskId, principal: f.actors.writer, toAccountId: 'outsider',
    nextAction: 'Continue the pinned scene.', expectedRevision: task.revision, expectedGeneration: task.frontmatter.claim_generation, requestId: 'offer' });
  task = await f.fs.readNote(taskPath);
  if (accept) {
    await f.work.handoff({ op: 'accept', taskId: session.taskId, principal: f.actors.outsider,
      expectedRevision: task.revision, expectedGeneration: task.frontmatter.claim_generation, requestId: 'accept-offer' });
    task = await f.fs.readNote(taskPath);
  }
  const resume = { op: 'resume', projectId: 'novel', sessionId: 'handoff', reconnectWriter: true,
    expectedWorkRevision: task.revision, expectedWorkGeneration: task.frontmatter.claim_generation,
    expectedRevision: session.revision, expectedProjectRevision: p.revision, requestId: 'reconnect' };
  return { ...f, artifact, session, task, resume };
}

test('showrunner explicitly reconnects a paused Story to accepted Work handoff without changing editor or artifacts', async () => {
  const f = await handedOffSession();
  await expect(f.execute('session', { ...f.resume, reconnectWriter: false })).rejects.toThrow(/assignment|closed/i);
  const resumed = await f.execute('session', f.resume);
  expect(resumed).toMatchObject({ stage: 'draft', writerAccountId: 'outsider', editorAccountId: 'owner', taskId: f.session.taskId });
  expect(await f.execute('session', f.resume)).toMatchObject({ revision: resumed.revision, replayed: true });
  expect((await f.fs.readNote(f.artifact.path)).revision).toBe(f.artifact.revision);
  const submit = { op: 'submit', projectId: 'novel', sessionId: 'handoff', sourceRevision: f.artifact.revision,
    expectedRevision: resumed.revision, expectedProjectRevision: f.resume.expectedProjectRevision, requestId: 'new-writer-submit' };
  await expect(f.execute('session', submit, f.actors.writer)).rejects.toThrow(/role|writer/i);
  expect(await f.execute('session', submit, f.actors.outsider)).toMatchObject({ stage: 'review', writerAccountId: 'outsider' });
});

test('Story reconnection rejects unaccepted handoff, non-showrunner and stale Work bindings', async () => {
  const pending = await handedOffSession(false);
  await expect(pending.execute('session', pending.resume)).rejects.toThrow(/accepted.*handoff/i);
  const f = await handedOffSession();
  await expect(f.execute('session', f.resume, f.actors.writer)).rejects.toThrow(/showrunner/i);
  for (const change of [{ expectedWorkRevision: 'a'.repeat(64) }, { expectedWorkGeneration: 99 }, { expectedWorkRevision: undefined }]) {
    await expect(f.execute('session', { ...f.resume, ...change })).rejects.toThrow(/Work|revision|generation/i);
  }
  expect((await f.fs.readNote(f.session.path)).revision).toBe(f.session.revision);
});

test('Story reconnection rejects a recipient removed from creative membership after accepting Work', async () => {
  const f = await handedOffSession();
  const updated = await f.execute('project', { op: 'update', projectId: 'novel', participants: ['writer'],
    expectedRevision: (await f.current()).revision, requestId: 'remove-recipient' });
  await expect(f.execute('session', { ...f.resume, expectedProjectRevision: updated.revision })).rejects.toThrow(/membership|participant/i);
  expect((await f.fs.readNote(f.session.path)).revision).toBe(f.session.revision);
});

test('concurrent Story reconnections have one revision-guarded winner', async () => {
  const f = await handedOffSession();
  const results = await Promise.allSettled(['reconnect-a', 'reconnect-b'].map(requestId => f.execute('session', { ...f.resume, requestId })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect((await f.fs.readNote(f.session.path)).frontmatter.writer_account_id).toBe('outsider');
  expect((await f.fs.readNote(`Community/Tasks/${f.session.taskId}.md`)).revision).toBe(f.task.revision);
});

test('selected manuscript exports retain exact sources and old output becomes stale after upstream edit', async () => {
  const f = await fixture(); await f.project();
  await f.put('idea-a', {}, { kind: 'alternative', content: 'A missing book.' });
  await f.put('idea-b', {}, { kind: 'alternative', content: 'A missing author.' });
  await f.put('outline', {}, { kind: 'outline', content: 'Arrival, search, revelation.' });
  for (const id of ['arrival', 'search', 'revelation']) await f.put(id, { blocks: [
    { type: 'heading', text: '도서관 - 밤' }, { type: 'character', text: '아이리스' }, { type: 'dialogue', text: '기억나.' },
  ] });
  let p = await f.current();
  await f.execute('sequence', { op: 'update', projectId: 'novel', presentation: ['arrival', 'search', 'revelation'], chronology: ['arrival', 'search', 'revelation'],
    expectedRevision: p.revision, requestId: 'sequence' });
  for (const id of ['arrival', 'search', 'revelation']) {
    p = await f.current(); const a = await f.execute('artifact', { projectId: 'novel', artifactId: id });
    await f.execute('adopt', { projectId: 'novel', artifactId: id, sourceRevision: a.revision, reason: 'Chosen scene.',
      expectedProjectRevision: p.revision, expectedRevision: 'missing', requestId: `choose-${id}` });
  }
  const preview = await f.execute('export', { projectId: 'novel', format: 'fountain', maxChars: 12000 });
  expect(preview.content).toContain('@아이리스'); expect(preview.sources).toHaveLength(3);
  const output = await f.execute('export', { op: 'write', projectId: 'novel', format: 'markdown', exportId: 'manuscript',
    expectedProjectRevision: (await f.current()).revision, expectedRevision: 'missing', requestId: 'export-manuscript' });
  expect(await f.execute('export', { op: 'read', projectId: 'novel', exportId: 'manuscript' })).toMatchObject({ stale: false });
  const first = await f.execute('artifact', { projectId: 'novel', artifactId: 'arrival' });
  await f.put('arrival', {}, { op: 'update', content: 'Edited arrival', expectedRevision: first.revision });
  expect(await f.execute('export', { op: 'read', projectId: 'novel', exportId: 'manuscript' })).toMatchObject({ stale: true });
  expect((await f.fs.readNote(output.path)).revision).toBe(output.revision);
  expect((await f.execute('export', { projectId: 'novel', format: 'markdown', maxChars: 12000 })).content).not.toContain('Edited arrival');
}, 30000);

test('storyboards link existing or missing assets, persist file-only Canvas and reject unmanaged overwrite', async () => {
  const f = await fixture(); await f.project(); const scene = await f.put('scene');
  await f.put('shot', { sourceSceneId: 'scene', sourceSceneRevision: scene.revision, order: 1, camera: '와이드', action: 'Walk.',
    durationSeconds: 3, images: [{ path: 'Images/missing.png' }] }, { kind: 'shot' });
  const p = await f.current();
  await f.execute('sequence', { op: 'update', projectId: 'novel', presentation: ['scene'], chronology: ['scene'], shots: ['shot'], expectedRevision: p.revision, requestId: 'shots-order' });
  const board = await f.execute('export', { projectId: 'novel', format: 'storyboard', selection: 'draft', maxChars: 12000 });
  expect(JSON.stringify(board.diagnostics)).toContain('missing_image');
  const canvas = await f.execute('export', { op: 'write', projectId: 'novel', exportId: 'board', format: 'canvas', selection: 'draft',
    expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'canvas' });
  const doc = JSON.parse(await readFile(join(f.root, canvas.outputPath), 'utf8'));
  expect(doc.nodes.every((node: any) => node.type === 'file')).toBe(true);
  await writeFile(join(f.root, canvas.outputPath), JSON.stringify({ nodes: [], edges: [] }), 'utf8');
  await expect(f.execute('export', { op: 'write', projectId: 'novel', exportId: 'board', format: 'canvas', selection: 'draft',
    expectedRevision: canvas.revision, expectedProjectRevision: (await f.current()).revision, requestId: 'overwrite-user-canvas' })).rejects.toThrow(/unmanaged|changed|output/i);
});

test('rehearsal uses a pinned declarative graph and never mutates the shared roleplay world', async () => {
  const f = await fixture(); await f.project();
  const graph = await f.put('choice', { graph: { revision: 'definition', startNodeId: 'start', variables: [], nodes: [
    { id: 'start', choices: [{ id: 'go', label: 'Continue', targetId: 'end' }] }, { id: 'end', end: true, choices: [] },
  ] } }, { kind: 'branch_graph' });
  const r = await f.execute('session', { op: 'rehearse', projectId: 'novel', sessionId: 'run', artifactId: 'choice', sourceRevision: graph.revision,
    choiceIds: ['go'], initialState: {}, expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'run' });
  expect(r.result.ended).toBe(true);
  expect(await f.fs.noteExists('Community/Roleplay/World.md')).toBe(false);
  await expect(f.execute('session', { op: 'rehearse', projectId: 'novel', sessionId: 'stale', artifactId: 'choice', sourceRevision: '0'.repeat(64),
    choiceIds: ['go'], initialState: {}, expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'stale' })).rejects.toThrow(/revision/i);
});

test('transitive context dependencies become stale when an indirect story source changes', async () => {
  const f = await fixture(); await f.project();
  const fact = await f.put('fact', { layer: 'world_fact' }, { kind: 'bible' });
  const summary = await f.put('summary', {}, { kind: 'summary', sources: [{ artifactId: 'fact', revision: fact.revision }] });
  await f.put('later', {}, { sources: [{ artifactId: 'summary', revision: summary.revision }] });
  await f.put('fact', { layer: 'world_fact' }, { op: 'update', content: 'The key changed.', expectedRevision: fact.revision });
  expect(await f.execute('artifact', { projectId: 'novel', artifactId: 'later' })).toMatchObject({ stale: true });
  const later = await f.execute('artifact', { projectId: 'novel', artifactId: 'later' });
  await expect(f.execute('adopt', { projectId: 'novel', artifactId: 'later', sourceRevision: later.revision, reason: 'unsafe',
    expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'transitive-adopt' })).rejects.toThrow(/stale/i);
});

test('conflicting source guards cannot silently replace an earlier revision pin', async () => {
  const f = await fixture(); await f.project(); const a = await f.put('scene');
  const w = f.service.workspace, actor = f.actors.owner!;
  await expect(w.store.write('Community/Stories/novel/Artifacts/conflict.md', { project_id: 'novel' }, 'conflicting pins', 'missing',
    w.store.request('test.conflict', { requestId: 'conflict' }, actor), {},
    [{ path: a.path, expectedRevision: '0'.repeat(64) }, { path: a.path, expectedRevision: a.revision }], async () => {})).rejects.toThrow(/conflict|revision/i);
});

test('session budget exhaustion persists a recoverable waiting state and rejects role spoofing', async () => {
  const f = await fixture(); const p = await f.project(); const a = await f.put('scene');
  await f.execute('project', { op: 'update', projectId: 'novel', maxSteps: 1, expectedRevision: p.revision, requestId: 'budget' });
  let s = await f.execute('session', { op: 'start', projectId: 'novel', sessionId: 'budget', artifactId: 'scene', writerAccountId: 'writer', editorAccountId: 'owner',
    expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'budget-start' });
  s = await f.execute('session', { op: 'submit', projectId: 'novel', sessionId: 'budget', sourceRevision: a.revision,
    expectedRevision: s.revision, expectedProjectRevision: (await f.current()).revision, requestId: 'budget-submit' }, f.actors.writer);
  expect(s).toMatchObject({ stage: 'waiting' }); expect(s.waitingFor).toMatch(/budget/i);
  await f.execute('project', { op: 'update', projectId: 'novel', maxSteps: 12, expectedRevision: (await f.current()).revision, requestId: 'raise-budget' });
  s = await f.execute('session', { op: 'resume', projectId: 'novel', sessionId: 'budget', expectedRevision: s.revision,
    expectedProjectRevision: (await f.current()).revision, requestId: 'resume-budget' });
  expect(s.stage).toBe('draft');
  await expect(f.execute('session', { op: 'submit', projectId: 'novel', sessionId: 'budget', sourceRevision: a.revision,
    expectedRevision: s.revision, expectedProjectRevision: (await f.current()).revision, requestId: 'spoof-submit' })).rejects.toThrow(/writer|stage/i);
});

test('story reads reject public symlink aliases for private scope bytes', async () => {
  const f = await fixture(); await f.project();
  await f.fs.writeNote({ path: '_scopes/models/owner/Private.md', content: 'PRIVATE-ALIAS-CANARY' });
  await symlink(join(f.root, '_scopes/models/owner'), join(f.root, 'PublicAlias'), 'junction');
  await expect(f.service.workspace.store.read('PublicAlias/Private.md', f.actors.owner)).rejects.toThrow(/alias|scope|canonical|unavailable/i);
});

test('read pagination still works beyond the first 100 artifacts without losing records', async () => {
  const f = await fixture(); await f.project();
  const directory = join(f.root, 'Community/Stories/novel/Artifacts'); await mkdir(directory, { recursive: true });
  for (let i = 0; i < 105; i++) {
    const id = `scene-${String(i).padStart(3, '0')}`;
    await writeFile(join(directory, `${id}.md`), `---\nmcpvault_type: story_artifact\nfiction_domain: story\nproject_id: novel\nartifact_id: ${id}\nbranch_id: main\nkind: scene\ntitle: ${id}\nsource_revisions: []\n---\nScene ${i}\n`);
  }
  const seen = new Set<string>(); let cursor: string | undefined;
  do {
    const response = await f.execute('artifact', { op: 'list', projectId: 'novel', maxChars: 4000, limit: 20, ...(cursor && { cursor }) });
    expect(JSON.stringify(response).length).toBeLessThanOrEqual(4000);
    for (const item of response.items) { expect(seen.has(item.artifactId)).toBe(false); seen.add(item.artifactId); }
    cursor = response.cursor;
  } while (cursor);
  expect(seen.size).toBe(105);
}, 60000);

test('current-scene context includes preceding events and exact card instructions with continuation', async () => {
  const f = await fixture(); const project = await f.project();
  await f.put('prior', {}, { content: 'PREVIOUS-EVENT-CANARY' });
  await f.put('focus', { purpose: 'INSTRUCTION-CANARY', setupIds: ['key'], payoffIds: ['door'] });
  await f.execute('sequence', { op: 'update', projectId: 'novel', presentation: ['prior', 'focus'], chronology: ['prior', 'focus'], expectedRevision: project.revision, requestId: 'context-order' });
  const context = await f.execute('context', { projectId: 'novel', artifactId: 'focus', maxChars: 12000 });
  expect(JSON.stringify(context)).toContain('PREVIOUS-EVENT-CANARY');
  expect(JSON.stringify(context)).toContain('INSTRUCTION-CANARY');
});

test('write-time authorization rejects delegation changed after the initial project read', async () => {
  const f = await fixture(); await f.project(); const a = await f.put('scene');
  const project = await f.service.workspace.project('novel', f.actors.owner);
  await f.execute('project', { op: 'update', projectId: 'novel', showrunnerAccountId: 'writer', expectedRevision: project.revision, requestId: 'revoked-live' });
  await expect(f.service.workspace.authorize(project, f.actors.owner, 'showrunner')).rejects.toThrow(/revision|delegation|changed/i);
  expect(a.revision).toBeTruthy();
});

test.each([511, 12001, '1000', null])('invalid response budget %s is rejected before any story or Work mutation', async maxChars => {
  const f = await fixture();
  await expect(f.execute('project', { op: 'create', projectId: 'budget-invalid', title: 'No write', brief: { medium: 'novel' },
    expectedRevision: 'missing', requestId: 'budget-invalid', maxChars })).rejects.toThrow(/maxChars|budget/i);
  expect(await f.fs.noteExists('Community/Stories/budget-invalid/Project.md')).toBe(false);
  expect(await f.fs.noteExists('Community/Projects/budget-invalid.md')).toBe(false);
});

test('direct service validates operation and pinned read revisions, not only the MCP schema', async () => {
  const f = await fixture(); await f.project(); const a = await f.put('scene');
  await expect(f.execute('context', { op: 'write', projectId: 'novel' })).rejects.toThrow(/operation/i);
  await expect(f.execute('artifact', { projectId: 'novel', artifactId: 'scene', expectedRevision: '0'.repeat(64) })).rejects.toThrow(/revision/i);
  expect((await f.execute('artifact', { projectId: 'novel', artifactId: 'scene', expectedRevision: a.revision })).revision).toBe(a.revision);
});

test('large rehearsal mutations return bounded continuations without losing a readable record', async () => {
  const f = await fixture(); await f.project();
  const graph = await f.put('choice', { graph: { revision: 'definition', startNodeId: 'start', variables: [
    { id: 'memo', type: 'string', initialValue: '긴 기억 '.repeat(100) },
  ], nodes: [{ id: 'start', choices: [{ id: 'go', label: 'Continue', targetId: 'end' }] }, { id: 'end', end: true, choices: [] }] } }, { kind: 'branch_graph' });
  const result = await f.execute('session', { op: 'rehearse', projectId: 'novel', sessionId: 'large', artifactId: 'choice', sourceRevision: graph.revision,
    choiceIds: ['go'], expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'large', maxChars: 512 });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.path).toBeTruthy(); expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  expect((await f.fs.readNote(result.path)).frontmatter.result.ended).toBe(true);
});

test('project entry provides native Obsidian scene and editorial queue views', async () => {
  const f = await fixture(); const project = await f.project();
  const entry = await f.fs.readNote(project.path);
  expect(entry.content).toContain('```base');
  expect(entry.content).toContain('Editorial queue');
  expect(entry.content).toContain('story_session');
  expect(entry.content).toContain('story_artifact');
});

test.each([{ order: 0.5 }, { durationSeconds: 86401 }])('shot data %s is rejected before an unexportable artifact is stored', async invalid => {
  const f = await fixture(); await f.project(); const scene = await f.put('scene');
  await expect(f.put('shot', { sourceSceneId: 'scene', sourceSceneRevision: scene.revision, ...invalid }, { kind: 'shot' })).rejects.toThrow(/order|duration/i);
  expect(await f.fs.noteExists('Community/Stories/novel/Artifacts/shot.md')).toBe(false);
});

test('context expectedRevision pins the project context before reading artifacts', async () => {
  const f = await fixture(); const p = await f.project();
  await expect(f.execute('context', { projectId: 'novel', expectedRevision: '0'.repeat(64) })).rejects.toThrow(/revision/i);
  expect((await f.execute('context', { projectId: 'novel', expectedRevision: p.revision })).revision).toBe(p.revision);
});

test('story storage refuses records exceeding its own readable byte budget before writing', async () => {
  const f = await fixture(); await f.project(); const w = f.service.workspace;
  const path = 'Community/Stories/novel/Rehearsals/oversized.md';
  await expect(w.store.write(path, { project_id: 'novel', result: '큰'.repeat(180000) }, 'trace', 'missing',
    w.store.request('test.byte-budget', { requestId: 'byte-budget' }, f.actors.owner), {}, [], async () => {})).rejects.toThrow(/byte|budget|size/i);
  expect(await f.fs.noteExists(path)).toBe(false);
});

test('project brief private links are rejected before creating its Work project', async () => {
  const f = await fixture();
  await f.fs.writeNote({ path: '_scopes/models/owner/Secret.md', content: 'PRIVATE-PROJECT-CANARY' });
  await expect(f.execute('project', { op: 'create', projectId: 'private-brief', title: 'Public story',
    brief: { medium: 'novel', theme: '[[_scopes/models/owner/Secret]]' }, expectedRevision: 'missing', requestId: 'private-brief' })).rejects.toThrow(/reference|scope|private|public/i);
  expect(await f.fs.noteExists('Community/Projects/private-brief.md')).toBe(false);
});

test('aggregate project brief reference budget is rejected before its Work project is created', async () => {
  const f = await fixture();
  const paths = Array.from({ length: 129 }, (_, i) => `r${String(i).padStart(3, '0')}.md`);
  await Promise.all(paths.map(path => writeFile(join(f.root, path), 'Public reference.')));
  const links = (start: number) => paths.slice(start, start + 43).map(path => `[[${path}]]`).join(' ');
  await expect(f.execute('project', { op: 'create', projectId: 'many-refs', title: 'Public story',
    brief: { medium: 'novel', audience: links(0), genre: links(43), theme: links(86) }, expectedRevision: 'missing', requestId: 'many-refs' })).rejects.toThrow(/reference|guard|limit/i);
  expect(await f.fs.noteExists('Community/Projects/many-refs.md')).toBe(false);
  expect(await f.fs.noteExists('Community/Stories/many-refs/Project.md')).toBe(false);
}, 60000);

test('multiline project title cannot turn a fenced private link into a public heading body', async () => {
  const f = await fixture();
  await f.fs.writeNote({ path: '_scopes/models/owner/Secret.md', content: 'PRIVATE-TITLE-CANARY' });
  await expect(f.execute('project', { op: 'create', projectId: 'fenced-title', title: '~~~\n[[_scopes/models/owner/Secret]]\n~~~',
    brief: { medium: 'novel' }, expectedRevision: 'missing', requestId: 'fenced-title' })).rejects.toThrow(/title|line|reference|scope/i);
  expect(await f.fs.noteExists('Community/Projects/fenced-title.md')).toBe(false);
});

test('session waiting reasons reject private references without changing the session', async () => {
  const f = await fixture(); const p = await f.project(); await f.put('scene');
  await f.fs.writeNote({ path: '_scopes/models/owner/Secret.md', content: 'PRIVATE-SESSION-CANARY' });
  const s = await f.execute('session', { op: 'start', projectId: 'novel', sessionId: 'private-reason', artifactId: 'scene',
    writerAccountId: 'writer', editorAccountId: 'owner', expectedRevision: 'missing', expectedProjectRevision: p.revision, requestId: 'private-start' });
  await expect(f.execute('session', { op: 'pause', projectId: 'novel', sessionId: 'private-reason', reason: '[[_scopes/models/owner/Secret]]',
    expectedRevision: s.revision, expectedProjectRevision: p.revision, requestId: 'private-pause' })).rejects.toThrow(/reference|scope|private|public/i);
  expect((await f.fs.readNote(s.path)).revision).toBe(s.revision);
});

test('complete creative workflow keeps Workshop discussion, two edits, selected media and upstream refresh connected', async () => {
  const f = await fixture(); await f.project();
  const ideas = [];
  for (const id of ['idea-a', 'idea-b']) ideas.push(await f.put(id, {}, { kind: 'alternative', branchId: id, content: id === 'idea-a' ? 'A librarian loses one memory per book.' : 'Books remember their missing authors.' }));
  const outline = await f.put('outline', {}, { kind: 'outline', content: 'Arrival: a blank return slip. Search: a borrowed memory. Revelation: choose who remembers.' });
  const discussion = new IdeationService(f.fs, f.refs);
  const workshop = await discussion.createWorkshop({ principal: f.actors.owner, workshopId: 'story-direction', title: 'Story direction', prompt: 'Choose a premise inside the existing brief.', references: ideas.map(i => i.path) });
  const comment = await discussion.contributeWorkshop({ principal: f.actors.writer, workshopId: 'story-direction', kind: 'idea',
    content: `Develop the librarian premise; retain the other alternative. Source revision ${ideas[0].revision}.`, references: [ideas[0].path], expectedRevision: workshop.revision, requestId: 'direction-note' });
  expect(comment).toBeDefined();
  const sceneIds = ['arrival', 'search', 'revelation'];
  const scenes: Record<string, any> = {};
  for (const id of sceneIds) scenes[id] = await f.put(id, { purpose: `Deliver ${id}`, blocks: [
    { type: 'heading', text: '도서관 - 밤' }, { type: 'action', text: '반납함에서 이름 없는 책을 꺼낸다.' },
    { type: 'character', text: '아이리스' }, { type: 'dialogue', text: '이 이름은 내가 기억할게.' },
  ] }, { content: `${id}\n${'그녀는 빈 대출증에 남은 손자국을 따라 기억을 되짚었다. '.repeat(80)}`, sources: [{ artifactId: 'outline', revision: outline.revision }] });
  await f.execute('sequence', { op: 'update', projectId: 'novel', presentation: sceneIds, chronology: ['search', 'arrival', 'revelation'], expectedRevision: (await f.current()).revision, requestId: 'e2e-order' });
  let session = await f.execute('session', { op: 'start', projectId: 'novel', sessionId: 'e2e-room', artifactId: 'arrival', writerAccountId: 'writer', editorAccountId: 'owner',
    expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'e2e-start' });
  const advance = async (op: string, extra: Record<string, unknown>, principal = f.actors.owner) => {
    session = await f.execute('session', { op, projectId: 'novel', sessionId: 'e2e-room', expectedRevision: session.revision,
      expectedProjectRevision: (await f.current()).revision, requestId: `e2e-${op}-${session.revision.slice(0, 24)}`, ...extra }, principal);
  };
  for (let round = 0; round < 3; round++) {
    await advance('submit', { sourceRevision: scenes.arrival.revision }, f.actors.writer);
    const review = await f.execute('review', { op: 'create', projectId: 'novel', artifactId: 'arrival', reviewId: `e2e-review-${round}`, pass: round === 0 ? 'structure' : 'line',
      sourceRevision: scenes.arrival.revision, content: round === 0 ? 'Tie the return slip to the later choice.' : 'Keep the voice specific; remove explanatory repetition.',
      findings: [{ classification: 'intentional_exception', text: 'The flashback order is intentional, not a continuity error.' }],
      expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: `e2e-review-${round}` });
    await advance('review', { sourceRevision: scenes.arrival.revision, reviewId: `e2e-review-${round}`, decision: round < 2 ? 'changes_requested' : 'ready' });
    expect(review.revision).toBeTruthy();
    if (round < 2) scenes.arrival = await f.put('arrival', (await f.fs.readNote(scenes.arrival.path)).frontmatter.data,
      { op: 'update', expectedRevision: scenes.arrival.revision, content: `Revision ${round + 1}: the handprint belongs to her forgotten sister.\n${'빈 이름 칸을 손끝으로 가렸다. '.repeat(80)}` });
  }
  expect(session.revisionRound).toBe(2);
  const select = async (id: string, suffix: string, reviewIds: string[] = []) => f.execute('adopt', { projectId: 'novel', artifactId: id, sourceRevision: scenes[id].revision,
    reviewIds, reason: 'Select the exact reviewed manuscript revision.', expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: `e2e-adopt-${id}-${suffix}` });
  for (const id of sceneIds) await select(id, 'first', id === 'arrival' ? ['e2e-review-2'] : []);
  await advance('decide', { sourceRevision: scenes.arrival.revision, decision: 'adopt', reason: 'The selected snapshot preserves both revision rounds.' });
  expect(session.stage).toBe('completed');
  await mkdir(join(f.root, 'Images'), { recursive: true });
  await writeFile(join(f.root, 'Images/library.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7gAAAABJRU5ErkJggg==', 'base64'));
  let shot = await f.put('opening-shot', { sourceSceneId: 'arrival', sourceSceneRevision: scenes.arrival.revision, order: 0, camera: 'Close-up', action: 'Hide the empty name.', durationSeconds: 4, images: [{ path: 'Images/library.png' }] }, { kind: 'shot' });
  scenes['opening-shot'] = shot; await select('opening-shot', 'first');
  await f.execute('sequence', { op: 'update', projectId: 'novel', presentation: sceneIds, chronology: ['search', 'arrival', 'revelation'], shots: ['opening-shot'], expectedRevision: (await f.current()).revision, requestId: 'e2e-shots' });
  const outputs: Record<string, any> = {};
  for (const format of ['markdown', 'fountain', 'storyboard', 'canvas']) {
    outputs[format] = await f.execute('export', { op: 'write', projectId: 'novel', format, exportId: `e2e-${format}`, expectedRevision: 'missing',
      expectedProjectRevision: (await f.current()).revision, requestId: `e2e-export-${format}` });
    expect((await f.execute('export', { op: 'health', projectId: 'novel', exportId: `e2e-${format}` })).stale).toBe(false);
  }
  expect(await readFile(join(f.root, outputs.fountain.outputPath), 'utf8')).toContain('@아이리스');
  const canvas = JSON.parse(await readFile(join(f.root, outputs.canvas.outputPath), 'utf8'));
  expect(canvas.nodes.every((n: any) => n.type === 'file')).toBe(true);
  const graph = await f.put('choice-path', { graph: { revision: 'definition', startNodeId: 'start', variables: [], nodes: [
    { id: 'start', choices: [{ id: 'keep', label: 'Keep the memory', targetId: 'end' }, { id: 'return', label: 'Return the memory', targetId: 'end' }] }, { id: 'end', end: true, choices: [] },
  ] } }, { kind: 'branch_graph', sources: [{ artifactId: 'arrival', revision: scenes.arrival.revision }] });
  const rehearsal = await f.execute('session', { op: 'rehearse', projectId: 'novel', sessionId: 'e2e-path', artifactId: 'choice-path', sourceRevision: graph.revision, choiceIds: ['keep'],
    expectedRevision: 'missing', expectedProjectRevision: (await f.current()).revision, requestId: 'e2e-path' });
  expect(rehearsal.result.ended).toBe(true); expect(rehearsal.proposalOnly).toBe(true);
  const summary = await f.put('memory-summary', {}, { kind: 'summary', sources: [{ artifactId: 'arrival', revision: scenes.arrival.revision }] });
  scenes.arrival = await f.put('arrival', (await f.fs.readNote(scenes.arrival.path)).frontmatter.data, { op: 'update', expectedRevision: scenes.arrival.revision, content: 'Upstream revision: the forgotten name belongs to the narrator.' });
  for (const artifactId of ['opening-shot', 'memory-summary', 'choice-path']) expect((await f.execute('artifact', { projectId: 'novel', artifactId })).stale).toBe(true);
  for (const format of Object.keys(outputs)) expect((await f.execute('export', { op: 'health', projectId: 'novel', exportId: `e2e-${format}` })).stale).toBe(true);
  expect((await f.fs.readNote(summary.path)).revision).toBe(summary.revision);
  await select('arrival', 'refreshed');
  const shotData = (await f.fs.readNote(shot.path)).frontmatter.data;
  shot = await f.put('opening-shot', { ...shotData, sourceSceneRevision: scenes.arrival.revision }, { op: 'update', expectedRevision: shot.revision, sources: [{ artifactId: 'arrival', revision: scenes.arrival.revision }] });
  scenes['opening-shot'] = shot; await select('opening-shot', 'refreshed');
  for (const format of Object.keys(outputs)) {
    const refreshed = await f.execute('export', { op: 'write', projectId: 'novel', format, exportId: `e2e-${format}`, expectedRevision: outputs[format].revision,
      expectedProjectRevision: (await f.current()).revision, requestId: `e2e-refresh-${format}` });
    expect((await f.execute('export', { op: 'health', projectId: 'novel', exportId: `e2e-${format}` })).stale).toBe(false);
    expect(refreshed.revision).not.toBe(outputs[format].revision);
  }
  expect(await f.fs.noteExists('Community/Roleplay/World.md')).toBe(false);
  expect((await f.fs.readNote(ideas[1].path)).content).toContain('missing authors');
}, 60000);
