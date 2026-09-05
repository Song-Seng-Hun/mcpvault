import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { endpointIdForTool } from './endpoint-registry.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(readOnly = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-note-receipts-'));
  cleanups.push(() => rm(vault, { recursive: true, force: true }));
  const server = createServer(vault, { version: 'test', readOnly });
  const client = new Client({ name: 'note-receipts', version: '1' });
  cleanups.push(async () => { await client.close(); await server.close(); });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  let accessToken: string | undefined;
  if (!readOnly) {
    const auth = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
      accountId: 'receipt-reader', modelId: 'codex', agentId: 'receipt-worker', userId: 'fixture-owner', password: 'Disposable-Receipt-Fixture-2026!',
    } } });
    expect(auth.isError).toBeFalsy();
    accessToken = JSON.parse((auth.content as Array<{ text: string }>)[0]!.text).accessToken;
  }
  const call = (tool: string, args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: {
    endpointId: endpointIdForTool(tool), ...(accessToken && { accessToken }), arguments: args,
  } });
  const success = async (tool: string, args: Record<string, unknown>) => {
    const response = await call(tool, args);
    expect(response.isError).toBeFalsy();
    const text = (response.content as Array<{ text: string }>)[0]!.text;
    expect(text.length).toBeLessThan(512);
    return JSON.parse(text);
  };
  return { fs: new FileSystemService(vault), client, call, success };
}

test.each(['overwrite', 'append', 'prepend'] as const)('notes.write %s returns a compact own-write receipt', async mode => {
  const { fs, client, success } = await fixture();
  const path = 'Note.md';
  await fs.writeNote({ path, content: 'Old body.\n' });
  const result = await success('write_note', { path, content: 'New body.\n'.repeat(1000), mode,
    expectedRevision: await fs.readNoteRevision(path) });
  expect(result).toMatchObject({ success: true, path, mode, revision: await fs.readNoteRevision(path) });
  expect(result).not.toHaveProperty('content');
  expect(result).not.toHaveProperty('originalContent');
  expect((await client.listTools()).tools).toHaveLength(5);
});

test.each([true, false])('Properties merge=%s returns a revision without echoing Properties or body', async merge => {
  const { fs, success } = await fixture();
  const path = 'Note.md';
  await fs.writeNote({ path, content: 'Keep body.', frontmatter: { retained: true } });
  const result = await success('update_frontmatter', { path, frontmatter: { summary: 'Detailed property. '.repeat(1000) }, merge,
    expectedRevision: await fs.readNoteRevision(path) });
  expect(result).toMatchObject({ success: true, path, revision: await fs.readNoteRevision(path) });
  expect(result).not.toHaveProperty('frontmatter');
  expect(result).not.toHaveProperty('content');
  expect((await fs.readNote(path)).content).toContain('Keep body.');
});

test('scope-local write receipt preserves public path identity and detects later edits', async () => {
  const { fs, success, call } = await fixture();
  const path = 'scope://model/codex/Note.md', physical = '_scopes/models/codex/Note.md';
  const result = await success('write_note', { path, content: 'First.', expectedRevision: 'missing' });
  expect(result.path).toBe(path);
  expect(result.revision).toBe(await fs.readNoteRevision(physical));
  expect(JSON.stringify(result)).not.toContain('_scopes/');
  await fs.writeNote({ path: physical, content: 'External follow-up.', expectedRevision: result.revision });
  const current = await fs.readNoteRevision(physical);
  const rejected = await call('update_frontmatter', { path, frontmatter: { status: 'wrong' }, expectedRevision: result.revision });
  expect(rejected.isError).toBe(true);
  expect(await fs.readNoteRevision(physical)).toBe(current);
});

test('receipt adapters retain read-only rejection for both mutations', async () => {
  const { fs, call } = await fixture(true);
  await fs.writeNote({ path: 'Note.md', content: 'Keep.' });
  const expectedRevision = await fs.readNoteRevision('Note.md');
  for (const tool of ['write_note', 'update_frontmatter']) {
    const result = await call(tool, { path: 'Note.md', content: 'Wrong.', frontmatter: { title: 'Wrong' }, expectedRevision });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('read-only');
  }
  expect(await fs.readNoteRevision('Note.md')).toBe(expectedRevision);
});
