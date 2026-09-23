import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectMcpClient } from '../tests/server-fixture.js';
import { MCPVAULT_SERVER_INSTRUCTIONS } from './wiki-policy.js';

const vaults: string[] = [];
afterEach(async () => {
  await Promise.all(vaults.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

test('one MCP listing advertises focused recording tools with honest safety annotations', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-record-tools-'));
  vaults.push(vault);
  const { server, client } = await connectMcpClient(vault);
  try {
    const listed = await client.listTools();
    expect(listed.nextCursor).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(listed))).toBeLessThanOrEqual(16 * 1024);
    const byName = new Map(listed.tools.map(tool => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual([
      'orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint',
      'get_wiki_policy', 'memory_brief', 'search_notes', 'read_note', 'list_journal_entries', 'read_journal_entry',
      'create_journal_entry', 'update_journal_entry', 'create_note', 'patch_note', 'update_note_properties',
    ].sort());
    for (const name of ['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities',
      'get_wiki_policy', 'memory_brief', 'search_notes', 'read_note', 'list_journal_entries', 'read_journal_entry']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
    for (const name of ['create_journal_entry', 'create_note']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    }
    for (const name of ['update_journal_entry', 'patch_note', 'update_note_properties']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    }
    expect(byName.get('call_endpoint')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  } finally {
    await client.close();
    await server.close();
  }
});

test('server instructions route private journals and shared research notes to distinct direct tools', () => {
  expect(MCPVAULT_SERVER_INSTRUCTIONS).not.toContain('Exactly five tools');
  expect(MCPVAULT_SERVER_INSTRUCTIONS).toContain('create_journal_entry');
  expect(MCPVAULT_SERVER_INSTRUCTIONS).toContain('create_note');
  expect(MCPVAULT_SERVER_INSTRUCTIONS).toContain('private');
  expect(MCPVAULT_SERVER_INSTRUCTIONS).toMatch(/shared/i);
});

test('create_note uses exclusive creation and returns a revision for an authenticated agent', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-record-create-'));
  vaults.push(vault);
  const { server, client } = await connectMcpClient(vault);
  try {
    const registered = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
      accountId: 'record-agent', modelId: 'codex', agentId: 'record-agent', password: 'test-only-password-1234',
    } } });
    const accessToken = JSON.parse(String(registered.content?.[0]?.type === 'text' ? registered.content[0].text : '{}')).accessToken;
    expect(typeof accessToken).toBe('string');
    const input = { path: 'Research/Study.md', content: '# Pilot\n\nObserved.', frontmatter: { note_kind: 'experiment' }, accessToken };
    const created = await client.callTool({ name: 'create_note', arguments: input });
    expect(created.isError).toBeFalsy();
    const value = JSON.parse(String(created.content?.[0]?.type === 'text' ? created.content[0].text : '{}'));
    expect(value).toMatchObject({ success: true, path: input.path, revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const duplicate = await client.callTool({ name: 'create_note', arguments: input });
    expect(duplicate.isError).toBe(true);
    const read = await client.callTool({ name: 'read_note', arguments: { path: input.path, accessToken } });
    expect(JSON.stringify(read)).toContain('Observed.');
    const search = await client.callTool({ name: 'search_notes', arguments: { query: 'Observed', accessToken } });
    expect(search.isError).toBeFalsy();
    expect(JSON.stringify(search)).toContain(input.path);
    const policy = await client.callTool({ name: 'get_wiki_policy', arguments: { topic: 'knowledge', accessToken } });
    expect(policy.isError).toBeFalsy();
  } finally {
    await client.close();
    await server.close();
  }
});

test('journal create and revision-checked update preserve an omitted title', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-record-journal-'));
  vaults.push(vault);
  const { server, client } = await connectMcpClient(vault);
  try {
    const registration = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
      accountId: 'journal-agent', modelId: 'codex', agentId: 'journal-agent', password: 'test-only-password-1234',
    } } });
    const accessToken = JSON.parse(String(registration.content?.[0]?.type === 'text' ? registration.content[0].text : '{}')).accessToken;
    const created = await client.callTool({ name: 'create_journal_entry', arguments: {
      title: 'Pilot result', kind: 'reflection', content: 'Observed a plateau.', accessToken,
    } });
    expect(created.isError).toBeFalsy();
    const first = JSON.parse(String(created.content?.[0]?.type === 'text' ? created.content[0].text : '{}'));
    const before = await client.callTool({ name: 'read_journal_entry', arguments: { entryId: first.entryId, accessToken } });
    const listed = await client.callTool({ name: 'list_journal_entries', arguments: { accessToken } });
    expect(listed.isError).toBeFalsy();
    expect(JSON.stringify(listed)).toContain(first.entryId);
    const prior = JSON.parse(String(before.content?.[0]?.type === 'text' ? before.content[0].text : '{}'));
    const changed = await client.callTool({ name: 'update_journal_entry', arguments: {
      entryId: first.entryId, content: 'Observed a late improvement.', expectedRevision: prior.revision, accessToken,
    } });
    expect(changed.isError).toBeFalsy();
    const after = await client.callTool({ name: 'read_journal_entry', arguments: { entryId: first.entryId, accessToken } });
    const current = JSON.parse(String(after.content?.[0]?.type === 'text' ? after.content[0].text : '{}'));
    expect(current.content).toContain('# Pilot result');
    expect(current.content).toContain('Observed a late improvement.');
    const stale = await client.callTool({ name: 'update_journal_entry', arguments: {
      entryId: first.entryId, content: 'Stale overwrite', expectedRevision: prior.revision, accessToken,
    } });
    expect(stale.isError).toBe(true);
    const otherRegistration = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
      accountId: 'other-journal-agent', modelId: 'codex', agentId: 'other-journal-agent', password: 'test-only-password-1234',
    } } });
    const otherToken = JSON.parse(String(otherRegistration.content?.[0]?.type === 'text' ? otherRegistration.content[0].text : '{}')).accessToken;
    const otherRead = await client.callTool({ name: 'read_journal_entry', arguments: { entryId: first.entryId, accessToken: otherToken } });
    expect(otherRead.isError).toBe(true);
    const otherWrite = await client.callTool({ name: 'update_journal_entry', arguments: {
      entryId: first.entryId, content: 'Not my journal', expectedRevision: current.revision, accessToken: otherToken,
    } });
    expect(otherWrite.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('note patch and property merge require fresh revisions without replacing unrelated data', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-record-edit-'));
  vaults.push(vault);
  const { server, client } = await connectMcpClient(vault);
  try {
    const registration = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
      accountId: 'edit-agent', modelId: 'codex', agentId: 'edit-agent', password: 'test-only-password-1234',
    } } });
    const accessToken = JSON.parse(String(registration.content?.[0]?.type === 'text' ? registration.content[0].text : '{}')).accessToken;
    const create = await client.callTool({ name: 'create_note', arguments: {
      path: 'Research/Edit.md', content: '# Result\n\nPilot finding.', frontmatter: { note_kind: 'experiment', status: 'pilot' }, accessToken,
    } });
    const first = JSON.parse(String(create.content?.[0]?.type === 'text' ? create.content[0].text : '{}'));
    const patch = await client.callTool({ name: 'patch_note', arguments: {
      path: first.path, oldString: 'Pilot finding.', newString: 'Confirmed finding.', expectedRevision: first.revision, accessToken,
    } });
    expect(patch.isError).toBeFalsy();
    const stale = await client.callTool({ name: 'update_note_properties', arguments: {
      path: first.path, frontmatter: { evidence_paths: ['Evidence.md'] }, expectedRevision: first.revision, accessToken,
    } });
    expect(stale.isError).toBe(true);
    const read = await client.callTool({ name: 'read_note', arguments: { path: first.path, accessToken } });
    const current = JSON.parse(String(read.content?.[0]?.type === 'text' ? read.content[0].text : '{}'));
    expect(current.content).toContain('Confirmed finding.');
    const properties = await client.callTool({ name: 'update_note_properties', arguments: {
      path: first.path, frontmatter: { evidence_paths: ['Evidence.md'] }, expectedRevision: current.revision, accessToken,
    } });
    expect(properties.isError).toBeFalsy();
    const after = await client.callTool({ name: 'read_note', arguments: { path: first.path, accessToken } });
    const final = JSON.parse(String(after.content?.[0]?.type === 'text' ? after.content[0].text : '{}'));
    expect(final.content).toContain('Confirmed finding.');
    expect(final.fm).toMatchObject({ note_kind: 'experiment', status: 'pilot', evidence_paths: ['Evidence.md'] });
  } finally {
    await client.close();
    await server.close();
  }
});

test('recording tools reject anonymous, User-scope and read-only writes', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-record-deny-'));
  vaults.push(vault);
  const writable = await connectMcpClient(vault);
  try {
    const anonymous = await writable.client.callTool({ name: 'create_note', arguments: { path: 'Denied.md', content: 'No owner' } });
    expect(anonymous.isError).toBe(true);
    const registration = await writable.client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
      accountId: 'denied-agent', modelId: 'codex', agentId: 'denied-agent', password: 'test-only-password-1234',
    } } });
    const accessToken = JSON.parse(String(registration.content?.[0]?.type === 'text' ? registration.content[0].text : '{}')).accessToken;
    const userScope = await writable.client.callTool({ name: 'create_note', arguments: {
      path: 'scope://user/denied-agent/Private.md', content: 'Blocked', accessToken,
    } });
    expect(userScope.isError).toBe(true);
    const readonly = await connectMcpClient(vault, { readOnly: true });
    try {
      const blocked = await readonly.client.callTool({ name: 'create_note', arguments: { path: 'Blocked.md', content: 'Blocked', accessToken } });
      expect(blocked.isError).toBe(true);
      expect(JSON.stringify(blocked)).toContain('read-only mode');
    } finally {
      await readonly.client.close();
      await readonly.server.close();
    }
  } finally {
    await writable.client.close();
    await writable.server.close();
  }
});

test('direct writers reject malformed content and Properties before reaching storage', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-record-input-'));
  vaults.push(vault);
  const { server, client } = await connectMcpClient(vault);
  try {
    const registration = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
      accountId: 'input-agent', modelId: 'codex', agentId: 'input-agent', password: 'test-only-password-1234',
    } } });
    const accessToken = JSON.parse(String(registration.content?.[0]?.type === 'text' ? registration.content[0].text : '{}')).accessToken;
    const badContent = await client.callTool({ name: 'create_note', arguments: {
      path: 'Research/Bad.md', content: 42, accessToken,
    } });
    expect(badContent.isError).toBe(true);
    const badProperties = await client.callTool({ name: 'create_note', arguments: {
      path: 'Research/Bad.md', content: '# Bad', frontmatter: ['not', 'properties'], accessToken,
    } });
    expect(badProperties.isError).toBe(true);
    const missing = await client.callTool({ name: 'read_note', arguments: { path: 'Research/Bad.md', accessToken } });
    expect(missing.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
