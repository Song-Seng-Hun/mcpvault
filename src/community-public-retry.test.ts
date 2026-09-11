import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ReferenceService } from './references.js';
import type { ReputationService } from './reputation.js';
import { ChatService } from './chat.js';
import { IdeationService } from './ideation.js';
import { getChatTools } from './chat-tools.js';
import { getIdeationTools } from './ideation-tools.js';
import { CommunityParticipationService, participationPath } from './community-participation.js';
import { SocialService } from './social.js';
import { getSocialTools } from './social-tools.js';
import { runPublicCreate } from './community-public-retry.js';

let vault: string;
let fileSystem: FileSystemService;

const alice: ScopePrincipal = { accountId: 'alice-account', modelId: 'gpt', agentId: 'alice-worker', role: 'agent' };
const bob: ScopePrincipal = { accountId: 'bob-account', modelId: 'gpt', agentId: 'bob-worker', role: 'agent' };

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-public-retry-'));
  fileSystem = new FileSystemService(vault);
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

function chat(fs = fileSystem) {
  return new ChatService(fs, new ReferenceService(fs, new ScopeAccessPolicy()), {} as ReputationService);
}

function ideation(fs = fileSystem) {
  return new IdeationService(fs, new ReferenceService(fs, new ScopeAccessPolicy()));
}

function social(fs = fileSystem) {
  const scopeAccess = new ScopeAccessPolicy();
  return new SocialService(fs, scopeAccess, new ReferenceService(fs, scopeAccess), {} as ReputationService);
}

test('requestless public creates share the coordinator before revalidation and actual file writes', async () => {
  const events:string[]=[];
  let release!:()=>void, entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const firstEntered=new Promise<void>(resolve=>{entered=resolve;});
  const create=(name:string)=>runPublicCreate({fileSystem,principal:alice,request:undefined,targetPath:`Community/Posts/${name}.md`,participationActions:['initiate'],
    revalidate:async()=>{events.push(`${name}-validate`);return {};},
    create:async()=>{events.push(`${name}-create`);if(name==='first'){entered();await gate;}return fileSystem.writeNote({path:`Community/Posts/${name}.md`,content:name,expectedRevision:'missing'});},
    replay:()=>{throw Error('No receipt to replay');}});
  const first=create('first');await firstEntered;
  const second=create('second');
  try {
    await Promise.resolve();await Promise.resolve();
    expect(events).toEqual(['first-validate','first-create']);
  } finally {release();await Promise.all([first,second]);}
  expect(events).toEqual(['first-validate','first-create','second-validate','second-create']);
  expect((await fileSystem.readNote('Community/Posts/first.md')).content).toBe('first');
  expect((await fileSystem.readNote('Community/Posts/second.md')).content).toBe('second');
});

async function seedRoom(roomId = 'retry-room') {
  await fileSystem.writeNote({
    path: `Community/ChatRooms/${roomId}.md`, content: '# Retry room\n', expectedRevision: 'missing',
    frontmatter: { mcpvault_type: 'chat_room', room_id: roomId, title: 'Retry room', tags: ['science'], status: 'open', created_by: 'alice-worker' },
  });
}

test('concurrent empty-discussion initiators converge on the first public topic without a second write', async () => {
  const participation = new CommunityParticipationService(fileSystem);
  const begin = async (principal: ScopePrincipal) => {
    let state = await participation.settings({ principal, op: 'update', requestId: 'enable-empty', expectedRevision: 'missing',
      settings: { enabled: true, allowedTopics: ['science'], allowedActions: ['initiate'] } });
    return participation.record({ principal, op: 'start', action: 'initiate', topic: 'science', emptyDiscussion: true,
      requestId: 'empty-start', expectedRevision: state.revision } as any);
  };
  const a = await begin(alice), b = await begin(bob);
  const create = (principal: ScopePrincipal, state: any) => ideation().createWorkshop({ principal, title: 'science question',
    prompt: 'Which result should we test? Evidence: prior observations. Desired response: a counterexample.',
    tags: ['science'], requestId: state.activeRun.publicRequestId });
  const results = await Promise.allSettled([create(alice, a), create(bob, b)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason.message).toMatch(/discussion.*(active|empty)|existing.*topic/i);
  expect(rejected.reason.message).toMatch(/skip.*noMutation=true.*pulse/i);
  const notes = await fileSystem.queryNotes({ pathPrefix: 'Community/Workshops', includeContent: false });
  expect(notes.notes).toHaveLength(1);
  // Exact retry of the winning public request still succeeds; no new run or reward.
  const winner = results[0]!.status === 'fulfilled' ? [alice, a] as const : [bob, b] as const;
  await expect(create(...winner)).resolves.toBeDefined();
  const loser = results[0]!.status === 'rejected' ? alice : bob;
  const current = await participation.settings({ principal: loser });
  expect(current.activeRun?.publicAttempt).toBeUndefined();
  await participation.record({ principal:loser,op:'skip',runId:current.activeRun!.id,expectedRevision:current.revision,requestId:'converge-skip',noMutation:true });
  const pulse = await participation.pulse({principal:loser});
  expect(pulse.discussion).toMatchObject({state:'active'});
  expect((pulse.candidates as any[]).map(c=>c.path)).toContain(notes.notes[0]!.path);
  expect(pulse.daily).toMatchObject({initiations:1,runs:1});
});

async function seedIdea(ideaId = 'parent-idea') {
  await fileSystem.writeNote({
    path: `Community/Ideas/${ideaId}.md`, content: '# Parent\n', expectedRevision: 'missing',
    frontmatter: { mcpvault_type: 'idea', idea_id: ideaId, title: 'Parent', status: 'seed', author: 'alice-worker' },
  });
}

async function seedWorkshop(workshopId = 'parent-workshop') {
  await fileSystem.writeNote({
    path: `Community/Workshops/${workshopId}.md`, content: '# Workshop\n', expectedRevision: 'missing',
    frontmatter: { mcpvault_type: 'workshop', workshop_id: workshopId, title: 'Workshop', prompt: 'Prompt', phase: 'diverge', status: 'open', max_contributions_per_agent: 3 },
  });
}

test('public create tool schemas accept an optional requestId without changing legacy required fields', () => {
  const tools = [...getChatTools(), ...getIdeationTools(), ...getSocialTools()];
  for (const name of ['send_chat_message', 'create_idea', 'contribute_idea', 'create_workshop', 'contribute_workshop', 'publish_blog_post', 'comment_on_blog_post']) {
    const schema = tools.find(tool => tool.name === name)!.inputSchema as any;
    expect(schema.properties.requestId).toMatchObject({ type: 'string', maxLength: 128 });
    expect(schema.required).not.toContain('requestId');
  }
});

test('post creation replays exactly while legacy revision updates remain compatible', async () => {
  const params = {
    principal: alice, slug: 'retry-post', title: 'Retry post', content: 'One durable post.',
    expectedRevision: 'missing', requestId: 'post-create-1',
  };
  const created = await social().publishBlogPost(params);
  expect(await social(new FileSystemService(vault)).publishBlogPost(params)).toEqual(created);
  expect(await fileSystem.countNotes({ pathPrefix: 'Community/Posts', filters: { mcpvault_type: 'blog_post' } })).toBe(1);
  await expect(social().publishBlogPost({ ...params, content: 'Changed payload.' })).rejects.toThrow(/different payload|already used/i);

  const updated = await social().publishBlogPost({ principal: alice, slug: 'retry-post', title: 'Retry post', content: 'Legacy update.', expectedRevision: created.revision });
  expect(updated).toMatchObject({ created: false, slug: 'retry-post' });
  await expect(social().publishBlogPost({ ...params, content: 'Request keys cannot update.', expectedRevision: updated.revision, requestId: 'post-update' })).rejects.toThrow(/requestId|create|update/i);
});

test('comment requestId admits one concurrent public comment and rejects changed content', async () => {
  await fileSystem.writeNote({
    path: 'Community/Posts/comment-parent.md', content: '# Parent\n', expectedRevision: 'missing',
    frontmatter: { mcpvault_type: 'blog_post', post_id: 'comment-parent', title: 'Parent', author: 'alice-worker', status: 'published', category: 'discussion' },
  });
  const params = { principal: alice, slug: 'comment-parent', content: 'One comment.', requestId: 'comment-create-1' };
  const results = await Promise.all([social().commentOnBlogPost(params), social().commentOnBlogPost(params)]);
  expect(results[1]).toEqual(results[0]);
  expect(await fileSystem.countNotes({ pathPrefix: 'Community/Comments/comment-parent', filters: { mcpvault_type: 'blog_comment' } })).toBe(1);
  await expect(social().commentOnBlogPost({ ...params, content: 'Changed.' })).rejects.toThrow(/different payload|already used/i);
});

test('chat requestId replays one durable result across concurrency and service restart', async () => {
  await seedRoom();
  const params = { principal: alice, roomId: 'retry-room', content: 'One public message.', requestId: 'chat-run-1' };
  const competing = await Promise.all([chat().sendMessage(params), chat().sendMessage(params)]);
  expect(competing[1]).toEqual(competing[0]);
  expect(await fileSystem.countNotes({ pathPrefix: 'Community/ChatMessages/retry-room', filters: { mcpvault_type: 'chat_message' } })).toBe(1);

  const restartedFs = new FileSystemService(vault);
  expect(await chat(restartedFs).sendMessage(params)).toEqual(competing[0]);
  const stored = await restartedFs.readNote(competing[0].path);
  expect(stored.frontmatter).toMatchObject({ community_request_id: 'chat-run-1' });
  expect(JSON.stringify(stored.frontmatter)).not.toContain(alice.accountId);

  await expect(chat(restartedFs).sendMessage({ ...params, content: 'Different payload.' })).rejects.toThrow(/different payload|already used/i);
  const otherActor = await chat(restartedFs).sendMessage({ ...params, principal: bob });
  expect(otherActor.messageId).not.toBe(competing[0].messageId);
});

test('chat replay rechecks parent state and refuses a hidden or externally changed receipt', async () => {
  await seedRoom();
  const params = { principal: alice, roomId: 'retry-room', content: 'State-sensitive retry.', requestId: 'state-sensitive' };
  const created = await chat().sendMessage(params);
  const room = await fileSystem.readNote('Community/ChatRooms/retry-room.md');
  await fileSystem.writeNote({ path: 'Community/ChatRooms/retry-room.md', content: room.content, frontmatter: { ...room.frontmatter, status: 'archived' }, expectedRevision: room.revision });
  await expect(chat().sendMessage(params)).rejects.toThrow(/archived/);

  const current = await fileSystem.readNote(created.path);
  await fileSystem.writeNote({ path: created.path, content: current.content, frontmatter: { ...current.frontmatter, moderation_status: 'hidden' }, expectedRevision: current.revision });
  const reopened = await fileSystem.readNote('Community/ChatRooms/retry-room.md');
  await fileSystem.writeNote({ path: 'Community/ChatRooms/retry-room.md', content: reopened.content, frontmatter: { ...reopened.frontmatter, status: 'open' }, expectedRevision: reopened.revision });
  await expect(chat().sendMessage(params)).rejects.toThrow(/unavailable|hidden|moderation/i);
});

test('idea and workshop creates replay deterministic targets while preserving caller supplied ids', async () => {
  const service = ideation();
  const generated = await service.createIdea({ principal: alice, title: 'Generated', seed: 'Seed', requestId: 'idea-create-1' });
  expect(await ideation(new FileSystemService(vault)).createIdea({ principal: alice, title: 'Generated', seed: 'Seed', requestId: 'idea-create-1' })).toEqual(generated);
  expect(generated.ideaId).toMatch(/^idea-[a-f0-9]+$/);
  await expect(service.createIdea({ principal: alice, title: 'Changed', seed: 'Seed', requestId: 'idea-create-1' })).rejects.toThrow(/different payload|already used/i);

  const named = await service.createIdea({ principal: alice, ideaId: 'named-idea', title: 'Named', seed: 'Seed', requestId: 'idea-create-named' });
  expect(named.ideaId).toBe('named-idea');
  expect(await service.createIdea({ principal: alice, ideaId: 'named-idea', title: 'Named', seed: 'Seed', requestId: 'idea-create-named' })).toEqual(named);

  const workshop = await service.createWorkshop({ principal: alice, title: 'Generated workshop', prompt: 'Prompt', requestId: 'workshop-create-1' });
  expect(await ideation(new FileSystemService(vault)).createWorkshop({ principal: alice, title: 'Generated workshop', prompt: 'Prompt', requestId: 'workshop-create-1' })).toEqual(workshop);
  expect(workshop.workshopId).toMatch(/^workshop-[a-f0-9]+$/);
});

test('idea and workshop contribution requestIds create one note and reject changed payloads', async () => {
  await seedIdea();
  await seedWorkshop();
  const service = ideation();
  const ideaParams = { principal: alice, ideaId: 'parent-idea', kind: 'challenge', content: 'Check the edge case.', requestId: 'idea-contribution-1' };
  const ideaResults = await Promise.all([service.contributeIdea(ideaParams), ideation().contributeIdea(ideaParams)]);
  expect(ideaResults[1]).toEqual(ideaResults[0]);
  expect(ideaResults[0].revision).toMatch(/^[a-f0-9]{64}$/);
  await expect(service.contributeIdea({ ...ideaParams, kind: 'extension' })).rejects.toThrow(/different payload|already used/i);

  const workshopParams = { principal: alice, workshopId: 'parent-workshop', kind: 'idea', content: 'Try a bounded variant.', expectedPhase: 'diverge', requestId: 'workshop-contribution-1' };
  const workshopResults = await Promise.all([service.contributeWorkshop(workshopParams), ideation().contributeWorkshop(workshopParams)]);
  expect(workshopResults[1]).toEqual(workshopResults[0]);
  expect(workshopResults[0].revision).toMatch(/^[a-f0-9]{64}$/);
  await expect(service.contributeWorkshop({ ...workshopParams, content: 'Changed.' })).rejects.toThrow(/different payload|already used/i);
});

test('one account cannot reuse a requestId for a different public create action', async () => {
  await seedRoom();
  const requestId = 'shared-public-request';
  await chat().sendMessage({ principal: alice, roomId: 'retry-room', content: 'The chosen action.', requestId });
  await expect(ideation().createIdea({ principal: alice, title: 'A second action', seed: 'Must be rejected.', requestId })).rejects.toThrow(/already used/i);
});

test('participation publicRequestId reserves one exact public attempt and survives response loss', async () => {
  await seedRoom();
  const participation = new CommunityParticipationService(fileSystem);
  let state = await participation.settings({
    principal: alice, op: 'update', expectedRevision: 'missing', requestId: 'enable',
    settings: { enabled: true, allowedTopics: ['science'], allowedActions: ['respond'] },
  });
  const room = await fileSystem.readNote('Community/ChatRooms/retry-room.md');
  state = await participation.record({
    principal: alice, op: 'start', expectedRevision: state.revision, requestId: 'start', action: 'respond', topic: 'science',
    target: { path: 'Community/ChatRooms/retry-room.md', revision: room.revision },
  });
  const publicRequestId = state.activeRun!.publicRequestId;
  const params = { principal: alice, roomId: 'retry-room', content: 'Reserved response.', requestId: publicRequestId };
  const created = await chat().sendMessage(params);
  expect(await chat(new FileSystemService(vault)).sendMessage(params)).toEqual(created);

  const privateNote = await fileSystem.readNote(participationPath(alice));
  expect(privateNote.frontmatter.participation.activeRun.publicAttempt).toEqual({
    operation: 'chat.message',
    payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    path: created.path,
  });
  await expect(ideation().createIdea({ principal: alice, title: 'Wrong action', seed: 'No.', requestId: publicRequestId })).rejects.toThrow(/already used|authorized|reserved/i);
  await participation.record({
    principal: alice, op: 'finish', expectedRevision: privateNote.revision, requestId: 'finish',
    runId: state.activeRun!.id, result: { path: created.path, revision: created.revision },
  });
  expect(await chat().sendMessage(params)).toEqual(created);
});

test('participation request cannot begin a fresh public write after pause or expiry', async () => {
  await seedRoom();
  const participation = new CommunityParticipationService(fileSystem);
  let state = await participation.settings({
    principal: alice, op: 'update', expectedRevision: 'missing', requestId: 'enable',
    settings: { enabled: true, allowedTopics: ['science'], allowedActions: ['respond'] },
  });
  const room = await fileSystem.readNote('Community/ChatRooms/retry-room.md');
  state = await participation.record({
    principal: alice, op: 'start', expectedRevision: state.revision, requestId: 'start', action: 'respond', topic: 'science',
    target: { path: 'Community/ChatRooms/retry-room.md', revision: room.revision },
  });
  const path = participationPath(alice);
  let privateNote = await fileSystem.readNote(path);
  const privateState = privateNote.frontmatter.participation;
  privateState.settings.paused = true;
  await fileSystem.writeNote({ path, content: privateNote.content, frontmatter: privateNote.frontmatter, expectedRevision: privateNote.revision });
  const params = { principal: alice, roomId: 'retry-room', content: 'Must wait.', requestId: state.activeRun!.publicRequestId };
  await expect(chat().sendMessage(params)).rejects.toThrow(/paused|expired/);

  privateNote = await fileSystem.readNote(path);
  privateNote.frontmatter.participation.settings.paused = false;
  privateNote.frontmatter.participation.activeRun.startedAt = new Date(Date.now() - 6 * 60_000).toISOString();
  await fileSystem.writeNote({ path, content: privateNote.content, frontmatter: privateNote.frontmatter, expectedRevision: privateNote.revision });
  await expect(chat().sendMessage(params)).rejects.toThrow(/paused|expired/);
  expect(await fileSystem.countNotes({ pathPrefix: 'Community/ChatMessages/retry-room', filters: { mcpvault_type: 'chat_message' } })).toBe(0);
});
