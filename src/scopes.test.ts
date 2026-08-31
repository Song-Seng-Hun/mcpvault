import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
  expect(expandScopePath('scope://model/codex/Guide.md')).toBe('_scopes/models/codex/Guide.md');
  expect(expandScopePath('scope://agent/reviewer-1/Notes/Guide.md')).toBe('_scopes/agents/reviewer-1/Notes/Guide.md');
  expect(() => expandScopePath('scope://agent/../Guide.md')).toThrow();
});

test('ordinary tools accept scope URIs and scoped reads use agent-model-global precedence', async () => {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scope-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await client.callTool({ name: 'write_note', arguments: { path: 'Guide.md', content: 'global answer' } });
    await client.callTool({ name: 'write_note', arguments: { path: 'scope://model/codex/Guide.md', content: 'model answer' } });
    await client.callTool({ name: 'create_agent_scope', arguments: { agentId: 'reviewer', modelId: 'codex', sessionId: 'scope-test-session' } });

    const inherited = await client.callTool({ name: 'read_scoped_note', arguments: { path: 'Guide.md', agentId: 'reviewer' } });
    expect(JSON.parse((inherited.content as any)[0].text)).toMatchObject({ scope: 'model', content: 'model answer' });

    await client.callTool({ name: 'write_note', arguments: { path: 'scope://agent/reviewer/Guide.md', content: 'agent answer' } });

    const read = await client.callTool({ name: 'read_note', arguments: { path: 'scope://model/codex/Guide.md' } });
    expect(JSON.parse((read.content as any)[0].text)).toMatchObject({ content: 'model answer' });

    const scoped = await client.callTool({ name: 'read_scoped_note', arguments: { path: 'Guide.md', agentId: 'reviewer' } });
    expect(JSON.parse((scoped.content as any)[0].text)).toMatchObject({ scope: 'agent', content: 'agent answer' });
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
    const initialized = await client.callTool({ name: 'initialize_revision_history', arguments: { confirm: true } });
    expect(initialized.isError).toBeFalsy();
    const scopedPath = 'scope://model/gemini/Shared Policy.md';
    await client.callTool({ name: 'write_note', arguments: { path: scopedPath, content: 'Initial shared policy' } });
    const committed = await client.callTool({ name: 'commit_changes', arguments: {
      reason: 'Establish Gemini model policy', paths: [scopedPath], authorName: 'Gemini Agent', authorEmail: 'gemini@example.test',
    } });
    expect(committed.isError).toBeFalsy();
    const history = await client.callTool({ name: 'get_note_history', arguments: { path: scopedPath } });
    expect(JSON.parse((history.content as any)[0].text)[0]).toMatchObject({ reason: 'Establish Gemini model policy', authorName: 'Gemini Agent' });
  } finally {
    await client.close();
    await server.close();
  }
});
