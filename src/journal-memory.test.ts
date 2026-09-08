import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { getSocialTools } from './social-tools.js';
import { SocialService } from './social.js';

let vault: string;

beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-journal-memory-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });

async function setup() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'journal-memory-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const registration = await client.callTool({ name: 'register_scope_account', arguments: {
    accountId: 'journal-account', modelId: 'codex', agentId: 'journal-agent', password: 'journal-password-123',
  } });
  const accessToken = JSON.parse((registration.content as any)[0].text).accessToken;
  return { server, client, accessToken };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  const text = (result.content as any)[0].text;
  try { return { result, text, value: JSON.parse(text) }; }
  catch { return { result, text, value: undefined }; }
}

async function close({ server, client }: Awaited<ReturnType<typeof setup>>) {
  await client.close();
  await server.close();
}

test.each(['read', 'list'] as const)('journal %s does not return private data after authentication is revoked during the read', async mode => {
  const connection = await setup();
  try {
    const created = await json(connection.client, 'write_journal_entry', {
      title: 'private-journal-revocation-canary', content: 'private-journal-revocation-canary', accessToken: connection.accessToken,
    });
    const revoke = async () => {
      await connection.client.callTool({ name: 'call_endpoint', arguments: {
        endpointId: 'auth.logout', accessToken: connection.accessToken, arguments: {},
      } });
    };
    if (mode === 'read') {
      const original = SocialService.prototype.readJournalEntry;
      vi.spyOn(SocialService.prototype, 'readJournalEntry').mockImplementationOnce(async function(this: SocialService, ...args) {
        const result = await original.apply(this, args); await revoke(); return result;
      });
    } else {
      const original = SocialService.prototype.listJournalEntries;
      vi.spyOn(SocialService.prototype, 'listJournalEntries').mockImplementationOnce(async function(this: SocialService, ...args) {
        const result = await original.apply(this, args); await revoke(); return result;
      });
    }
    const response = await json(connection.client, `${mode}_journal_${mode === 'read' ? 'entry' : 'entries'}`, {
      entryId: created.value.entryId, accessToken: connection.accessToken,
    });
    expect(response.result.isError).toBe(true);
    expect(response.text).not.toContain('private-journal-revocation-canary');
  } finally { await close(connection); }
});

test('journal accepts 20,000 Unicode code points independently from the 280-character comment cap', async () => {
  const connection = await setup();
  try {
    const accepted = await json(connection.client, 'write_journal_entry', {
      content: '😀'.repeat(20_000), accessToken: connection.accessToken,
    });
    expect(accepted.value.created).toBe(true);
    const rejected = await connection.client.callTool({ name: 'write_journal_entry', arguments: {
      content: '😀'.repeat(20_001), accessToken: connection.accessToken,
    } });
    expect(rejected.isError).toBe(true);
    const comment = await connection.client.callTool({ name: 'comment_on_blog_post', arguments: {
      slug: 'does-not-matter', content: '😀'.repeat(281), accessToken: connection.accessToken,
    } });
    expect(comment.isError).toBe(true);
  } finally { await close(connection); }
});

test('journal list filters by inclusive dates, kind, and tags, then returns revisioned snapshot cursor pages', async () => {
  const connection = await setup();
  try {
    await json(connection.client, 'write_journal_entry', {
      date: '2026-09-01', kind: 'diary', tags: ['focus', 'personal'], content: 'one', accessToken: connection.accessToken,
    });
    await json(connection.client, 'write_journal_entry', {
      date: '2026-09-02', kind: 'log', tags: ['focus'], content: 'two', accessToken: connection.accessToken,
    });
    await json(connection.client, 'write_journal_entry', {
      date: '2026-09-03', kind: 'diary', tags: ['other'], content: 'three', accessToken: connection.accessToken,
    });
    await json(connection.client, 'write_journal_entry', {
      date: '2026-09-02', kind: 'diary', tags: ['focus'], content: 'four', accessToken: connection.accessToken,
    });
    const first = await json(connection.client, 'list_journal_entries', {
      dateFrom: '2026-09-01', dateTo: '2026-09-02', kind: 'diary', tags: ['focus'], limit: 1, maxChars: 4_000, accessToken: connection.accessToken,
    });
    expect(first.value.entries).toMatchObject([{ date: '2026-09-02', kind: 'diary', revision: expect.any(String) }]);
    expect(first.value.nextCursor).toEqual(expect.any(String));
    expect(first.value.truncated).toBe(true);
    await json(connection.client, 'write_journal_entry', {
      entryId: first.value.entries[0].entryId, date: '2026-09-02', content: 'changed', expectedRevision: first.value.entries[0].revision, accessToken: connection.accessToken,
    });
    const stale = await connection.client.callTool({ name: 'list_journal_entries', arguments: {
      dateFrom: '2026-09-01', dateTo: '2026-09-02', kind: 'diary', tags: ['focus'], cursor: first.value.nextCursor, accessToken: connection.accessToken,
    } });
    expect(stale.isError).toBe(true);
  } finally { await close(connection); }
});

test('journal list defaults to 20 entries and a 4,000-character response budget, capped at 100 and 12,000', async () => {
  const connection = await setup();
  try {
    await Promise.all(Array.from({ length: 21 }, async (_, index) => json(connection.client, 'write_journal_entry', {
      date: '2026-09-04', content: `entry ${index}`, accessToken: connection.accessToken,
    })));
    const defaultWindow = await json(connection.client, 'list_journal_entries', { accessToken: connection.accessToken });
    expect(defaultWindow.value.entries.length).toBeLessThanOrEqual(20);
    expect(defaultWindow.value.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(defaultWindow.value).length).toBeLessThanOrEqual(4_000);
    const list = getSocialTools().find(tool => tool.name === 'list_journal_entries')!;
    expect(list.inputSchema.properties).toMatchObject({
      limit: { default: 20, maximum: 100 }, maxChars: { default: 4_000, maximum: 12_000 },
    });
  } finally { await close(connection); }
});

test('journal read uses one fresh revisioned note and returns a bounded continuation without dropping metadata', async () => {
  const connection = await setup();
  try {
    const created = await json(connection.client, 'write_journal_entry', {
      title: 'A title', mood: 'steady', tags: ['focus'], content: `${'body '.repeat(3_000)}^journal-memory`, accessToken: connection.accessToken,
    });
    const bounded = await json(connection.client, 'read_journal_entry', {
      entryId: created.value.entryId, expectedRevision: created.value.revision, maxChars: 4_000, accessToken: connection.accessToken, prettyPrint: true,
    });
    expect(bounded.value).toMatchObject({
      path: expect.any(String), revision: created.value.revision, fm: { title: 'A title', mood: 'steady', tags: ['focus'] }, content: expect.any(String), truncated: true,
      nextAction: { endpointId: 'mcp.read_note_lines', arguments: { path: expect.any(String), startLine: expect.any(Number), endLine: expect.any(Number), expectedRevision: created.value.revision } },
    });
    expect(JSON.stringify(bounded.value).length).toBeLessThanOrEqual(4_000);
    expect(bounded.text.length).toBeLessThanOrEqual(4_000);
    const conflict = await connection.client.callTool({ name: 'read_journal_entry', arguments: {
      entryId: created.value.entryId, expectedRevision: '0'.repeat(64), accessToken: connection.accessToken,
    } });
    expect(conflict.isError).toBe(true);
  } finally { await close(connection); }
});

test('journal read enforces a 1,000-character minimum and returns a compact recovery envelope when frontmatter cannot fit', async () => {
  const connection = await setup();
  try {
    const created = await json(connection.client, 'write_journal_entry', {
      title: 'x'.repeat(4_000), content: 'small body', accessToken: connection.accessToken,
    });
    const tooSmall = await connection.client.callTool({ name: 'read_journal_entry', arguments: {
      entryId: created.value.entryId, maxChars: 1, accessToken: connection.accessToken,
    } });
    expect(tooSmall.isError).toBe(true);
    const compact = await json(connection.client, 'read_journal_entry', {
      entryId: created.value.entryId, maxChars: 1_000, accessToken: connection.accessToken,
    });
    expect(JSON.stringify(compact.value).length).toBeLessThanOrEqual(1_000);
    expect(compact.value).toMatchObject({
      path: expect.any(String), revision: created.value.revision, frontmatterOmitted: true, truncated: true,
      nextAction: { endpointId: 'mcp.read_note_lines', arguments: { expectedRevision: created.value.revision } },
    });
    expect(compact.value.fm).toBeUndefined();
    const schema = getSocialTools().find(tool => tool.name === 'read_journal_entry')!;
    expect(schema.inputSchema.properties!.maxChars).toMatchObject({ minimum: 1_000, maximum: 12_000, default: 4_000 });
  } finally { await close(connection); }
});

test('journal updates preserve the existing date and kind when those fields are omitted', async () => {
  const connection = await setup();
  try {
    const created = await json(connection.client, 'write_journal_entry', {
      date: '2026-09-01', kind: 'log', content: 'original', accessToken: connection.accessToken,
    });
    const updated = await json(connection.client, 'write_journal_entry', {
      entryId: created.value.entryId, content: 'updated', expectedRevision: created.value.revision, accessToken: connection.accessToken,
    });
    expect(updated.value).toMatchObject({ created: false, date: '2026-09-01', kind: 'log' });
    expect((await json(connection.client, 'read_journal_entry', { entryId: created.value.entryId, accessToken: connection.accessToken })).value.fm)
      .toMatchObject({ date: '2026-09-01', kind: 'log' });
  } finally { await close(connection); }
});

test('journal memory entries are written to frontmatter, retained when omitted, and cleared by an explicit empty array', async () => {
  const connection = await setup();
  try {
    const created = await json(connection.client, 'write_journal_entry', {
      content: 'Remember this. ^memory-one', memory_entries: [{ block_id: 'memory-one', role: 'episodic', retrieval_cues: ['journal'] }], accessToken: connection.accessToken,
    });
    const firstRead = await json(connection.client, 'read_journal_entry', { entryId: created.value.entryId, accessToken: connection.accessToken });
    expect(firstRead.value.fm.memory_entries).toEqual([{ block_id: 'memory-one', role: 'episodic', retrieval_cues: ['journal'] }]);
    const retained = await json(connection.client, 'write_journal_entry', {
      entryId: created.value.entryId, date: created.value.date, content: 'Remember this still. ^memory-one', expectedRevision: firstRead.value.revision, accessToken: connection.accessToken,
    });
    const retainedRead = await json(connection.client, 'read_journal_entry', { entryId: created.value.entryId, accessToken: connection.accessToken });
    expect(retained.value.created).toBe(false);
    expect(retainedRead.value.fm.memory_entries).toEqual(firstRead.value.fm.memory_entries);
    await json(connection.client, 'write_journal_entry', {
      entryId: created.value.entryId, date: created.value.date, content: 'Clear this. ^memory-one', memory_entries: [], expectedRevision: retainedRead.value.revision, accessToken: connection.accessToken,
    });
    expect((await json(connection.client, 'read_journal_entry', { entryId: created.value.entryId, accessToken: connection.accessToken })).value.fm.memory_entries).toEqual([]);
  } finally { await close(connection); }
});

test('journal discovery exposes exact block and reference-array schemas rather than an opaque object', () => {
  const tool = getSocialTools().find(tool => tool.name === 'write_journal_entry')!;
  const record = (tool.inputSchema.properties!.memory_entries as any).items;
  expect(record.required).toEqual(['block_id', 'role']);
  expect(record.properties.role.enum).toContain('episodic');
  expect(record.properties.basis).toMatchObject({ type: 'array', items: { required: ['path', 'revision'] } });
  expect(record.properties.corrects).toMatchObject({ type: 'array', items: { required: ['path'] } });
  expect(record.properties.block_id.description).toContain('not the whole journal');
});
