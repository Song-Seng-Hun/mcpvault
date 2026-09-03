import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { SearchService } from './search.js';
import { CollaborationService, expandScopePath } from './scopes.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-scopes-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

function services() {
  const filter = new PathFilter();
  const fileSystem = new FileSystemService(vault, filter, new FrontmatterHandler());
  return { fileSystem, collaboration: new CollaborationService(fileSystem, new SearchService(vault, filter)) };
}

test('scope URIs map to ordinary durable vault paths', () => {
  expect(expandScopePath('scope://global/Guide.md')).toBe('Guide.md');
  expect(expandScopePath('scope://community/team-a/Posts/topic.md')).toBe('Community/Posts/topic.md');
  expect(expandScopePath('scope://user/alice/Research.md')).toBe('_scopes/users/alice/Research.md');
  expect(expandScopePath('scope://model/codex/Guide.md')).toBe('_scopes/models/codex/Guide.md');
  expect(expandScopePath('scope://agent/reviewer-1/Notes/Guide.md')).toBe('_scopes/agents/reviewer-1/Notes/Guide.md');
  expect(() => expandScopePath('scope://agent/../Guide.md')).toThrow();
});

test('user scope is host-only while command-center community stays local', async () => {
  const serverA = createServer(vault, { version: '1.0.0', commandCenterId: 'team-a' });
  const [clientTransportA, serverTransportA] = InMemoryTransport.createLinkedPair();
  const clientA = new Client({ name: 'scope-family-a', version: '1.0.0' });
  await Promise.all([clientA.connect(clientTransportA), serverA.connect(serverTransportA)]);
  try {
    const first = await clientA.callTool({ name: 'register_scope_account', arguments: { accountId: 'alice-codex', userId: 'alice', modelId: 'codex', agentId: 'codex-worker', password: 'alice-codex-password' } });
    const firstToken = JSON.parse((first.content as any)[0].text).accessToken;
    const second = await clientA.callTool({ name: 'register_scope_account', arguments: { accountId: 'alice-claude', userId: 'alice', modelId: 'claude', agentId: 'claude-worker', password: 'alice-claude-password' } });
    const secondToken = JSON.parse((second.content as any)[0].text).accessToken;
    const outsider = await clientA.callTool({ name: 'register_scope_account', arguments: { accountId: 'bob-codex', userId: 'bob', modelId: 'codex', agentId: 'bob-worker', password: 'bob-codex-password' } });
    const outsiderToken = JSON.parse((outsider.content as any)[0].text).accessToken;

    await mkdir(join(vault, '_scopes', 'users', 'alice'), { recursive: true });
    await writeFile(join(vault, '_scopes', 'users', 'alice', 'shared.md'), 'family memory');
    const written = await clientA.callTool({ name: 'write_note', arguments: { path: 'scope://user/alice/shared.md', content: 'blocked', expectedRevision: 'missing', accessToken: firstToken } });
    expect(written.isError).toBe(true);
    const familyRead = await clientA.callTool({ name: 'read_note', arguments: { path: 'scope://user/alice/shared.md', accessToken: secondToken } });
    expect(familyRead.isError).toBe(true);
    const outsiderRead = await clientA.callTool({ name: 'read_note', arguments: { path: 'scope://user/alice/shared.md', accessToken: outsiderToken } });
    expect(outsiderRead.isError).toBe(true);
    const hiddenSearch = await clientA.callTool({ name: 'search_notes', arguments: { query: 'family memory', accessToken: secondToken } });
    expect(JSON.stringify(hiddenSearch)).not.toContain('shared.md');
    const context = await clientA.callTool({ name: 'get_scope_context', arguments: { accessToken: secondToken } });
    expect(JSON.stringify(context)).not.toContain('scope://user/alice/');

    await mkdir(join(vault, 'Community', 'Posts'), { recursive: true });
    await writeFile(join(vault, 'Community', 'Posts', 'local-topic.md'), '---\nmcpvault_type: blog_post\n---\n\nlocal community');
    const communityRead = await clientA.callTool({ name: 'read_note', arguments: { path: 'scope://community/team-a/Posts/local-topic.md' } });
    expect(communityRead.isError).toBeFalsy();

    const serverB = createServer(vault, { version: '1.0.0', commandCenterId: 'team-b' });
    const [clientTransportB, serverTransportB] = InMemoryTransport.createLinkedPair();
    const clientB = new Client({ name: 'scope-family-b', version: '1.0.0' });
    await Promise.all([clientB.connect(clientTransportB), serverB.connect(serverTransportB)]);
    try {
      const foreignCommunity = await clientB.callTool({ name: 'read_note', arguments: { path: 'scope://community/team-a/Posts/local-topic.md' } });
      expect(foreignCommunity.isError).toBe(true);
    } finally {
      await clientB.close();
      await serverB.close();
    }
  } finally {
    await clientA.close();
    await serverA.close();
  }
});

test('ordinary tools accept scope URIs and scoped reads use agent-model-global precedence', async () => {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scope-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'codex-owner', modelId: 'codex', password: 'codex-test-password' } });
    const modelLogin = await client.callTool({ name: 'login_scope', arguments: { accountId: 'codex-owner', password: 'codex-test-password' } });
    const modelToken = JSON.parse((modelLogin.content as any)[0].text).accessToken;
    await client.callTool({ name: 'write_note', arguments: { path: 'Guide.md', content: 'global answer' } });
    await client.callTool({ name: 'write_note', arguments: { path: 'scope://model/codex/Guide.md', content: 'model answer', accessToken: modelToken } });
    await client.callTool({ name: 'create_agent_scope', arguments: { agentId: 'reviewer', modelId: 'codex', sessionId: 'scope-test-session', accessToken: modelToken } });
    await client.callTool({ name: 'register_scope_account', arguments: {
      accountId: 'reviewer-account', modelId: 'codex', agentId: 'reviewer', password: 'reviewer-password', accessToken: modelToken,
    } });
    const agentLogin = await client.callTool({ name: 'login_scope', arguments: { accountId: 'reviewer-account', password: 'reviewer-password' } });
    const agentToken = JSON.parse((agentLogin.content as any)[0].text).accessToken;

    const inherited = await client.callTool({ name: 'read_scoped_note', arguments: { path: 'Guide.md', accessToken: agentToken } });
    expect(JSON.parse((inherited.content as any)[0].text)).toMatchObject({ scope: 'model', content: 'model answer' });

    await client.callTool({ name: 'write_note', arguments: { path: 'scope://agent/reviewer/Guide.md', content: 'agent answer', accessToken: agentToken } });

    const read = await client.callTool({ name: 'read_note', arguments: { path: 'scope://model/codex/Guide.md', accessToken: modelToken } });
    expect(JSON.parse((read.content as any)[0].text)).toMatchObject({ content: 'model answer' });

    const scoped = await client.callTool({ name: 'read_scoped_note', arguments: { path: 'Guide.md', accessToken: agentToken } });
    expect(JSON.parse((scoped.content as any)[0].text)).toMatchObject({ scope: 'agent', content: 'agent answer' });

    const anonymousRead = await client.callTool({ name: 'read_note', arguments: { path: 'scope://model/codex/Guide.md' } });
    expect(anonymousRead.isError).toBe(true);
    const bypassRead = await client.callTool({ name: 'read_note', arguments: { path: '_scopes/models/codex/Guide.md', accessToken: modelToken } });
    expect(bypassRead.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('agent identities survive handoff and reject stale generations', async () => {
  const { collaboration } = services();
  await collaboration.createAgentScope({ agentId: 'researcher', modelId: 'claude', sessionId: 'session-a', purpose: 'Maintain sources' });
  const handoff = await collaboration.handoffAgentScope({
    agentId: 'researcher', fromSessionId: 'session-a', toSessionId: 'session-b', reason: 'Context window ending', expectedGeneration: 1,
  });
  expect(handoff).toMatchObject({ generation: 2, currentSession: 'session-b' });
  await expect(collaboration.resumeAgentScope({
    agentId: 'researcher', newSessionId: 'session-c', reason: 'Recover abandoned work', expectedGeneration: 1,
  })).rejects.toThrow(/Stale agent generation/);
  const resumed = await collaboration.resumeAgentScope({
    agentId: 'researcher', newSessionId: 'session-c', reason: 'Recover abandoned work', expectedGeneration: 2,
  });
  expect(resumed).toMatchObject({ generation: 3, recoveredFrom: 'session-b' });
});

test('equal peers append arguments and stale discussion edits cannot overwrite newer ones', async () => {
  const { collaboration } = services();
  const created = await collaboration.createDiscussion({
    discussionId: 'rewrite-policy', title: 'Rewrite policy', createdBy: 'codex', initialPosition: 'Prefer small patches.', evidence: ['[[Editing Guide]]'],
  });
  const challenged = await collaboration.addDiscussionArgument({
    discussionId: 'rewrite-policy', actor: 'claude', stance: 'challenge', argument: 'Whole-section rewrites can be clearer.',
    evidence: ['scope://global/Editing Guide.md'], expectedRevision: created.revision,
  });
  await expect(collaboration.addDiscussionArgument({
    discussionId: 'rewrite-policy', actor: 'gemini', stance: 'alternative', argument: 'Use a size threshold.', expectedRevision: created.revision,
  })).rejects.toThrow(/Revision conflict/);
  const resolved = await collaboration.updateDiscussionStatus({
    discussionId: 'rewrite-policy', actor: 'gemini', status: 'resolved', reason: 'Use patches by default and explain larger rewrites.', expectedRevision: challenged.revision,
  });
  expect(resolved.status).toBe('resolved');
  const discussion = await collaboration.getDiscussion('rewrite-policy');
  expect(discussion.fm.participants).toEqual(['codex', 'claude', 'gemini']);
  expect(discussion.content).toContain('claude · challenge');
  expect(discussion.content).toContain('**resolved** by gemini');
});

test('write revisions reject stale model updates', async () => {
  const { fileSystem } = services();
  await fileSystem.writeNote({ path: 'Shared.md', content: 'v1', expectedRevision: 'missing' });
  const first = await fileSystem.readNote('Shared.md');
  const competing = await Promise.allSettled([
    fileSystem.writeNote({ path: 'Shared.md', content: 'model-a', expectedRevision: first.revision }),
    fileSystem.writeNote({ path: 'Shared.md', content: 'model-b', expectedRevision: first.revision }),
  ]);
  expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(competing.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(['model-a', 'model-b']).toContain((await fileSystem.readNote('Shared.md')).content);
});

test('scoped notes use the same Git commit, history, and rollback foundation', async () => {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scope-git-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'gemini-owner', modelId: 'gemini', password: 'gemini-test-password' } });
    const login = await client.callTool({ name: 'login_scope', arguments: { accountId: 'gemini-owner', password: 'gemini-test-password' } });
    const accessToken = JSON.parse((login.content as any)[0].text).accessToken;
    const initialized = await client.callTool({ name: 'initialize_revision_history', arguments: { confirm: true, accessToken } });
    expect(initialized.isError).toBeFalsy();
    const scopedPath = 'scope://model/gemini/Shared Policy.md';
    await client.callTool({ name: 'write_note', arguments: { path: scopedPath, content: 'Initial shared policy', accessToken } });
    const committed = await client.callTool({ name: 'commit_changes', arguments: {
      reason: 'Establish Gemini model policy', paths: [scopedPath], authorName: 'Gemini Agent', authorEmail: 'gemini@example.test', accessToken,
    } });
    expect(committed.isError).toBeFalsy();
    const history = await client.callTool({ name: 'get_note_history', arguments: { path: scopedPath, accessToken } });
    expect(JSON.parse((history.content as any)[0].text)[0]).toMatchObject({ reason: 'Establish Gemini model policy', authorName: 'Gemini Agent' });
  } finally {
    await client.close();
    await server.close();
  }
}, 15_000);
