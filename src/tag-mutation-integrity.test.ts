import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { createServer } from './createServer.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
let vault: string;
let fs: FileSystemService;
let changed: Array<[string, string]>;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-tag-integrity-'));
  changed = [];
  fs = new FileSystemService(vault, undefined, undefined, (path, kind) => { changed.push([path, kind]); });
  await writeFile(join(vault, 'Note.md'), '---\ntitle: Preserve me\ntags: [base]\n---\nBody\n');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
test('tag list returns its read revision without a mutation notification', async () => {
  const note = await fs.readNote('Note.md');
  const result = await fs.manageTags({ path: 'Note.md', operation: 'list' });
  expect(result).toMatchObject({ success: true, revision: note.revision });
  expect(changed).toEqual([]);
});
test('stale tag mutations preserve current content and do not notify', async () => {
  const before = await fs.readNote('Note.md');
  await writeFile(join(vault, 'Note.md'), '# New body\n');
  const result = await fs.manageTags({ path: 'Note.md', operation: 'add', tags: ['new'], expectedRevision: before.revision } as any);
  expect(result.success).toBe(false);
  expect(result.message).toMatch(/Revision conflict/);
  expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe('# New body\n');
  expect(changed).toEqual([]);
});
test('same-revision concurrent tag writes have one winner and one conflict', async () => {
  const note = await fs.readNote('Note.md');
  const results = await Promise.all(['one', 'two'].map(tag => fs.manageTags({ path: 'Note.md', operation: 'add', tags: [tag], expectedRevision: note.revision } as any)));
  expect(results.filter(r => r.success)).toHaveLength(1);
  expect(results.find(r => !r.success)?.message).toMatch(/Revision conflict/);
  const after = await fs.readNote('Note.md');
  expect(results.find(r => r.success)).toMatchObject({ previousRevision: note.revision, revision: after.revision });
  expect(changed).toEqual([['Note.md', 'upsert']]);
});
test('unguarded internal additions serialize without losing tags', async () => {
  await Promise.all(['one', 'two'].map(tag => fs.manageTags({ path: 'Note.md', operation: 'add', tags: [tag] })));
  expect((await fs.readNote('Note.md')).frontmatter.tags).toEqual(['base', 'one', 'two']);
  expect(changed).toHaveLength(2);
});
test.each(['list', 'add', 'remove'] as const)('hidden note rejects tag %s', async operation => {
  const raw = '---\nmoderation_status: hidden\ntags: [secret]\n---\nBody\n';
  await writeFile(join(vault, 'Note.md'), raw);
  const result = await fs.manageTags({ path: 'Note.md', operation, tags: ['new'] });
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
  expect(changed).toEqual([]);
});
test('invalid operation cannot silently rewrite tags', async () => {
  const before = await readFile(join(vault, 'Note.md'), 'utf8');
  expect((await fs.manageTags({ path: 'Note.md', operation: 'bogus' } as any)).success).toBe(false);
  expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(before);
  expect(changed).toEqual([]);
});
test('external edit after snapshot read is detected before tag write', async () => {
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementationOnce(async path => {
    const note = await read(path);
    await writeFile(join(vault, 'Note.md'), '# External edit\n');
    return note;
  });
  const result = await fs.manageTags({ path: 'Note.md', operation: 'add', tags: ['new'] });
  expect(result.success).toBe(false);
  expect(result.message).toMatch(/Revision conflict/);
  expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe('# External edit\n');
  expect(changed).toEqual([]);
});

test('public MCP requires a current revision and immediately exposes successful tag changes', async () => {
  const server = createServer(vault, { version: 'tag-integrity' });
  const client = new Client({ name: 'tag-integrity', version: '1' });
  try {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    const registration = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'auth.register', arguments: { accountId: 'tag-check', modelId: 'codex', password: 'temporary-test-password' },
    } });
    const token = JSON.parse((registration.content as Array<{ text: string }>)[0]!.text).accessToken;
    expect(token).toBeTruthy();
    const call = async (endpointId: string, args: Record<string, unknown>) => client.callTool({
      name: 'call_endpoint', arguments: { accessToken: token, endpointId, arguments: { maxChars: 3000, ...args } },
    });
    const text = (r: Awaited<ReturnType<typeof call>>) => (r.content as Array<{ text: string }>)[0]!.text;
    const listed = await call('mcp.manage_tags', { path: 'Note.md', operation: 'list' });
    expect(listed.isError).not.toBe(true);
    const revision = JSON.parse(text(listed)).revision;
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    await call('mcp.list_all_tags', {}); // Warm the derived view before mutation.
    const missing = await call('mcp.manage_tags', { path: 'Note.md', operation: 'add', tags: ['new'] });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('expectedRevision');
    const written = await call('mcp.manage_tags', { path: 'Note.md', operation: 'add', tags: ['new'], expectedRevision: revision });
    expect(written.isError).not.toBe(true);
    const after = await fs.readNote('Note.md');
    expect(JSON.parse(text(written))).toMatchObject({ previousRevision: revision, revision: after.revision });
    expect(after.frontmatter.tags).toEqual(['base', 'new']);
    expect(after.content).toBe('Body\n');
    const stale = await call('mcp.manage_tags', { path: 'Note.md', operation: 'remove', tags: ['base'], expectedRevision: revision });
    expect(stale.isError).toBe(true);
    expect(text(stale)).toMatch(/Revision conflict/);
    const tags = await call('mcp.list_all_tags', {});
    expect(text(tags).length).toBeLessThanOrEqual(3000);
    expect(JSON.parse(text(tags))).toContainEqual({ tag: 'new', count: 1 });
    expect((await fs.readNote('Note.md')).revision).toBe(after.revision);
  } finally { await client.close(); await server.close(); }
});

test('notification failure does not report an already applied tag write as failed', async () => {
  const isolated = new FileSystemService(vault, undefined, undefined, () => { throw new Error('index unavailable'); });
  const before = await isolated.readNote('Note.md');
  const result = await isolated.manageTags({ path: 'Note.md', operation: 'add', tags: ['new'], expectedRevision: before.revision });
  expect(result.success).toBe(true);
  expect((await isolated.readNote('Note.md')).revision).toBe(result.revision);
});
