import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
let root: string, base: string, client: Client, server: ReturnType<typeof createServer>;
let token: string;
async function setup(readOnly = false, enabled = true, paths = ['Guide.md']) {
  server = createServer(root, { readOnly, ...(enabled && { explanations: { sources: paths.map(path => ({ path })) }, workCollaboration: {
    executionProfiles: async () => [{ accountId: 'writer', family: 'gemini', version: 'test', hostVerified: true, tier: 'standard', capabilities: ['task'], tools: [] }],
  } }) } as any);
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'explanation-test', version: '1' });
  await Promise.all([client.connect(left), server.connect(right)]);
}
async function call(endpointId: string, args: Record<string, unknown> = {}, authenticated = true) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { ...args, ...(authenticated && token && { accessToken: token }) } } });
  if (result.isError) throw Error(JSON.stringify(result.content));
  return JSON.parse((result.content[0] as any).text);
}
beforeEach(async () => {
  base = await realpath(tmpdir()); root = await mkdtemp(join(base, 'mcpvault-explanation-mcp-')); token = '';
  await new FileSystemService(root).writeNote({ path: 'Guide.md', content: 'Never disclose passwords.\n', expectedRevision: 'missing' });
});
afterEach(async () => {
  await client?.close(); await server?.close();
  const actual = await realpath(root), rel = relative(base, actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('mcpvault-explanation-mcp-')) throw Error('Unsafe cleanup');
  await rm(actual, { recursive: true, force: true });
});
test('five-tool plane exposes bounded explanation endpoints with unchanged originals', async () => {
  await setup();
  expect((await client.listTools()).tools).toHaveLength(5);
  token = (await call('auth.register', { accountId: 'writer', agentId: 'writer', modelId: 'gemini', userId: 'owner', password: 'temporary-test-password-1' })).accessToken;
  const jobs = await call('explanations.list'); expect(jobs.items).toHaveLength(1);
  const j = jobs.items[0];
  const claimed = await call('explanations.claim', { sourcePath: j.sourcePath, expectedSourceRevision: j.sourceRevision, expectedRevision: j.revision, requestId: 'claim' });
  expect(claimed.status).toBe('claimed');
  const result = await call('explanations.read', { sourcePath: 'Guide.md', maxChars: 1500 }, false);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1500);
  expect((await new FileSystemService(root).readNote('Guide.md')).revision).toBe(j.sourceRevision);
});
test('unconfigured explanation capability fails closed', async () => {
  await setup(false, false);
  await expect(call('explanations.read', { sourcePath: 'Guide.md' }, false)).rejects.toThrow(/configured|disabled/i);
});
test('read-only server rejects explanation claims and permits original fallback', async () => {
  await setup(true);
  await expect(call('explanations.claim', { sourcePath: 'Guide.md', expectedSourceRevision: 'a'.repeat(64), expectedRevision: 'missing', requestId: 'claim' })).rejects.toThrow(/read.only/i);
  expect((await call('explanations.read', { sourcePath: 'Guide.md' }, false)).route.kind).toBe('original_source');
});
test('idle Gemini is offered explanation before unrelated browsing, never while hostBusy', async () => {
  await setup();
  token = (await call('auth.register', { accountId: 'writer', agentId: 'writer', modelId: 'gemini', userId: 'owner', password: 'temporary-test-password-1' })).accessToken;
  const pulse = await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: token, maxChars: 4000 } });
  expect(JSON.parse((pulse.content[0] as any).text).nextAction.tool).toBe('explanations.read');
  const busy = await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: token, maxChars: 4000, hostBusy: true } });
  expect(JSON.parse((busy.content[0] as any).text).nextAction.tool).not.toBe('explanations.read');
});
test('private scoped source is normalized once and never disclosed to anonymous callers', async () => {
  await new FileSystemService(root).writeNote({ path: '_scopes/models/gemini/Secret.md', content: 'Private instruction.', expectedRevision: 'missing' });
  await setup(false, true, ['_scopes/models/gemini/Secret.md']);
  token = (await call('auth.register', { accountId: 'writer', agentId: 'writer', modelId: 'gemini', userId: 'owner', password: 'temporary-test-password-1' })).accessToken;
  const sourcePath = 'scope://model/gemini/Secret.md';
  expect((await call('explanations.read', { sourcePath })).sourcePath).toBe(sourcePath);
  await expect(call('explanations.read', { sourcePath }, false)).rejects.toThrow(/private|unavailable|denied/i);
});
test('credential rotation does not change an idempotent claim payload', async () => {
  await setup();
  token = (await call('auth.register', { accountId: 'writer', agentId: 'writer', modelId: 'gemini', userId: 'owner', password: 'temporary-test-password-1' })).accessToken;
  const job = (await call('explanations.list')).items[0];
  const params = { sourcePath: job.sourcePath, expectedSourceRevision: job.sourceRevision, expectedRevision: job.revision, requestId: 'claim' };
  const claimed = await call('explanations.claim', params);
  await call('auth.logout');
  token = (await call('auth.login', { accountId: 'writer', password: 'temporary-test-password-1' }, false)).accessToken;
  expect((await call('explanations.claim', params)).revision).toBe(claimed.revision);
});

test('exact-note reflex skips discovery with identical current bytes and no stale/private bypass', async () => {
  await setup();
  let calls = 0;
  const counted = async (id: string, args: Record<string, unknown>) => { calls++; return call(id, args, false); };
  const direct = await counted('notes.read', { path: 'Guide.md', maxChars: 2000 });
  expect(calls).toBe(1);
  expect(direct.route).toMatchObject({ kind: 'exact_note', skipped: ['search', 'outline'] });
  calls = 0;
  await counted('wiki.search', { query: 'passwords', maxChars: 2000 });
  const discovered = await counted('notes.read', { path: 'Guide.md', expectedRevision: direct.revision, maxChars: 2000 });
  expect(calls).toBe(2);
  expect(discovered.content).toBe(direct.content);
  expect(discovered.revision).toBe(direct.revision);
  const unchanged = await call('notes.read', { path: 'Guide.md', knownRevision: direct.revision }, false);
  expect(unchanged.notModified).toBe(true); expect(unchanged.content).toBeUndefined();
  const fs = new FileSystemService(root);
  await fs.writeNote({ path: 'Guide.md', content: 'Changed source.', expectedRevision: direct.revision });
  const changed = await call('notes.read', { path: 'Guide.md', knownRevision: direct.revision }, false);
  expect(changed.content).toBe('Changed source.');
  await fs.writeNote({ path: '_scopes/models/gemini/Secret.md', content: 'hidden-value', expectedRevision: 'missing' });
  await expect(call('notes.read', { path: 'scope://model/gemini/Secret.md', knownRevision: direct.revision }, false)).rejects.toThrow(/private|denied|access/i);
});
