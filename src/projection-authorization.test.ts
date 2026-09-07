import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { endpointIdForTool } from './endpoint-registry.js';
import { ScopeAuthService } from './scope-auth.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(readOnly = false, seededPassword?: string) {
  const root = await mkdtemp(join(tmpdir(), 'projection-auth-')); roots.push(root);
  const fs = new FileSystemService(root);
  await fs.writeNote({ path: 'Knowledge/Claim.md', content: '# Claim\nOriginal conditional statement.', frontmatter: { note_kind: 'atomic' } });
  const revision = await fs.readNoteRevision('Knowledge/Claim.md');
  if (seededPassword) await new ScopeAuthService(root).register({ accountId: 'seeded', modelId: 'codex', userId: 'fixture', password: seededPassword });
  const server = createServer(root, { version: 'test', readOnly });
  const client = new Client({ name: 'projection-auth', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: Record<string, unknown>, accessToken?: string) => client.callTool({
    name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) },
  });
  return { fs, revision, client, server, call };
}

test.each([false, true])('projection mutation is denied without authority (readOnly=%s) and preserves original bytes', async readOnly => {
  const f = await fixture(readOnly);
  try {
    const result = await f.call('wiki.projection_update', { path: 'Knowledge/Claim.md', expectedRevision: f.revision, summary: 'Unapproved replacement' });
    expect(result.isError).toBe(true);
    expect(await f.fs.readNoteRevision('Knowledge/Claim.md')).toBe(f.revision);
  } finally { await f.client.close(); await f.server.close(); }
});

test('read-only mode rejects a valid authenticated writer independently of authentication', async () => {
  const password = randomUUID();
  const f = await fixture(true, password);
  try {
    const login = await f.call('auth.login', { accountId: 'seeded', password });
    expect(login.isError).toBeFalsy();
    const account = JSON.parse((login.content as any[])[0].text);
    expect(account.principal.capabilities).toContain('write');
    const denied = await f.call('wiki.projection_update', { path: 'Knowledge/Claim.md', expectedRevision: f.revision, summary: 'Denied on read-only server' }, account.accessToken);
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('read-only');
    expect(await f.fs.readNoteRevision('Knowledge/Claim.md')).toBe(f.revision);
  } finally { await f.client.close(); await f.server.close(); }
});

test('projection discovery requires write authority and authenticated updates remain revision-safe', async () => {
  const f = await fixture();
  try {
    const found = await f.client.callTool({ name: 'search_capabilities', arguments: { query: 'wiki.projection_update', maxChars: 12000 } });
    const catalog = JSON.parse((found.content as any[])[0].text);
    expect(catalog.endpoints[0]).toMatchObject({ endpointId: 'wiki.projection_update', mutating: true, requires: ['write'], available: false });
    const registered = await f.call('auth.register', { accountId: 'writer', modelId: 'codex', userId: 'fixture', agentId: 'writer', password: randomUUID() });
    const token = JSON.parse((registered.content as any[])[0].text).accessToken;
    const changed = await f.call('wiki.projection_update', { path: 'Knowledge/Claim.md', expectedRevision: f.revision, summary: 'Conditional statement' }, token);
    expect(changed.isError).toBeFalsy();
    const updated = await f.fs.readNote('Knowledge/Claim.md');
    expect(updated.frontmatter?.summary).toBe('Conditional statement');
    expect(updated.content).toContain('Original conditional statement.');
    const stale = await f.call('wiki.projection_update', { path: 'Knowledge/Claim.md', expectedRevision: f.revision, summary: 'Stale replacement' }, token);
    expect(stale.isError).toBe(true);
  } finally { await f.client.close(); await f.server.close(); }
});

test('an authenticated account without write capability cannot refresh projections', async () => {
  const f = await fixture();
  const password = randomUUID();
  const value = (result: any) => { expect(result.isError, JSON.stringify(result.content)).toBeFalsy(); return JSON.parse(result.content[0].text); };
  try {
    const owner = value(await f.call('auth.register', { accountId: 'owner', userId: 'fixture', modelId: 'codex', password: randomUUID() }));
    value(await f.call('auth.register', { accountId: 'limited', userId: 'fixture', modelId: 'codex', agentId: 'limited', password }, owner.accessToken));
    value(await f.call(endpointIdForTool('update_agent_capabilities'), { agentId: 'limited', capabilities: ['profile'] }, owner.accessToken));
    const limited = value(await f.call('auth.login', { accountId: 'limited', password }));
    const result = await f.call('wiki.projection_update', { path: 'Knowledge/Claim.md', expectedRevision: f.revision, summary: 'No write grant' }, limited.accessToken);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Capability 'write'");
    expect(await f.fs.readNoteRevision('Knowledge/Claim.md')).toBe(f.revision);
  } finally { await f.client.close(); await f.server.close(); }
});
