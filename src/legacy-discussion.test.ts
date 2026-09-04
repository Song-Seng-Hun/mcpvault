import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from './createServer.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { FileSystemService } from './filesystem.js';

const legacyPath = '_collaboration/discussions/history.md';
const sourcePath = '_sources/evidence.md';
const body = '# Historical discussion\n\n- [ ] Preserve this task\n\n' + 'Historical evidence stays unchanged.\n'.repeat(80);
const bytes = `---\nllm_wiki_type: issue\ntags: [history]\n---\n${body}`;
const revision = createHash('sha256').update(bytes).digest('hex');
const ordinaryBytes = '# Ordinary\n\n- [ ] Open task\n';
const ordinaryRevision = createHash('sha256').update(ordinaryBytes).digest('hex');

describe('legacy discussion MCP mutation boundary', () => {
  let vault: string;
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let accessToken: string;

  async function seed(path: string, content: string) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  }

  async function call(endpointId: string, args: Record<string, unknown>, authenticated = true) {
    const result = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId, arguments: args, ...(authenticated && { accessToken }),
    } });
    const text = (result.content as Array<{ type: string; text?: string }>).filter(item => item.type === 'text').map(item => item.text).join('');
    return { result, text };
  }

  async function expectPreserved() {
    expect(await readFile(join(vault, legacyPath), 'utf8')).toBe(bytes);
    expect(await readFile(join(vault, sourcePath), 'utf8')).toBe(bytes);
    const read = await call('notes.read', { path: legacyPath, maxChars: 800 }, false);
    expect(read.result.isError).toBeFalsy();
    expect(JSON.parse(read.text).revision).toBe(revision);
  }

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'mcpvault-legacy-discussion-'));
    await seed(legacyPath, bytes);
    await seed(sourcePath, bytes);
    await seed('ordinary.md', ordinaryBytes);
    server = createServer(vault, { version: 'test' });
    client = new Client({ name: 'legacy-discussion-test', version: 'test' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    // Disposable test identity: registration state lives only in this temp vault.
    const registered = await call('auth.register', {
      accountId: 'legacy-test', modelId: 'gpt', password: randomUUID(),
    }, false);
    expect(registered.result.isError).toBeFalsy();
    accessToken = JSON.parse(registered.text).accessToken;
    expect(accessToken).toBeTruthy();
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    if (vault) await rm(vault, { recursive: true, force: true });
  });

  const mutations: Array<[string, Record<string, unknown>]> = [
    ['notes.write', { content: 'replacement', mode: 'overwrite' }],
    ['notes.patch', { oldString: 'Preserve this task', newString: 'changed' }],
    ['notes.delete', { confirmPath: legacyPath, permanent: true }],
    ['notes.move', { oldPath: legacyPath, newPath: 'moved.md' }],
    ['notes.move', { oldPath: 'ordinary.md', newPath: legacyPath, overwrite: true, expectedRevision: ordinaryRevision }],
    ['mcp.move_file', { oldPath: legacyPath, newPath: 'moved.md', confirmOldPath: legacyPath, confirmNewPath: 'moved.md' }],
    ['mcp.move_file', { oldPath: 'ordinary.md', newPath: legacyPath, confirmOldPath: 'ordinary.md', confirmNewPath: legacyPath, overwrite: true, expectedRevision: ordinaryRevision }],
    ['mcp.restore_note_revision', { revision: 'HEAD' }],
    ['mcp.update_frontmatter', { frontmatter: { changed: true }, merge: true }],
    ['mcp.manage_tags', { operation: 'add', tags: ['changed'] }],
    ['mcp.manage_tags', { operation: 'remove', tags: ['history'] }],
    ['notes.task_update', { line: 7, status: 'completed' }],
    ['mcp.daily_note', { folder: '_collaboration/discussions', date: '2026-09-05', content: 'changed', expectedRevision: 'missing' }],
    ['notes.change_set', { changes: [
      { path: 'ordinary.md', expectedRevision: ordinaryRevision, patches: [{ oldString: 'Ordinary', newString: 'Changed' }] },
      { path: legacyPath, expectedRevision: revision, frontmatter: { set: { changed: true } } },
    ], dryRun: true }],
    ['wiki.capture', { title: 'History', content: 'changed' }],
    ['wiki.clarify', { disposition: 'reference', clarifyNote: 'changed' }],
    ['wiki.distill_source', { sourcePath, title: 'History', content: 'changed' }],
    ['mcp.publish_knowledge', { title: 'History', content: 'changed', evidencePaths: [sourcePath] }],
    ['wiki.decision_record', { title: 'History', content: 'changed' }],
    ['wiki.triage', { tags: ['changed'] }],
    ['wiki.review', { reviewNote: 'changed', status: 'verified' }],
    ['wiki.review_claim', { claimId: 'claim', status: 'verified' }],
    ['wiki.record_recall', { quality: 'good' }],
    ['wiki.projection_update', { summary: 'changed' }],
    ['mcp.resolve_wiki_issue', { resolution: 'changed' }],
    ['mcp.export_wiki_base', { path: '_collaboration/discussions/history.base', expectedRevision: 'missing' }],
    ['wiki.canvas_export', { path: 'ordinary.md', outputPath: '_collaboration/discussions/history.canvas', expectedSourceRevision: ordinaryRevision, expectedRevision: 'missing' }],
  ];

  test.each(mutations)('rejects %s targeting history (%j)', async (endpointId, args) => {
    const response = await call(endpointId, { path: legacyPath, expectedRevision: revision, ...args });
    expect(response.result.isError, response.text).toBe(true);
    expect(response.text).toContain('historical read-only');
    for (const endpoint of ['community.post', 'community.comment', 'community.status', 'notes.read']) expect(response.text).toContain(endpoint);
    await expectPreserved();
    expect(await readFile(join(vault, 'ordinary.md'), 'utf8')).toBe(ordinaryBytes);
  });

  test.each([
    './_collaboration//discussions/history.md',
    '_collaboration/discussions/../discussions/history.md',
    'elsewhere/../_collaboration/discussions/history.md',
    '\\_collaboration\\discussions\\history.md',
    '_COLLABORATION/DISCUSSIONS/history.md',
    'scope://global/_collaboration/discussions/history.md',
  ])('rejects equivalent write path %s', async path => {
    const response = await call('notes.write', { path, content: 'changed', expectedRevision: revision });
    expect(response.text).toContain('historical read-only');
    await expectPreserved();
  });

  test('rejects absolute vault paths accepted by the filesystem', async () => {
    const response = await call('notes.write', { path: join(vault, legacyPath), content: 'changed', expectedRevision: revision });
    expect(response.text).toContain('historical read-only');
    await expectPreserved();
  });

  test.each(['_collaboration', './_collaboration/', 'elsewhere/../_collaboration', '_collaboration/discussions'])('rejects moving ancestor %s on either side', async ancestor => {
    for (const [oldPath, newPath] of [[ancestor, 'relocated'], ['ordinary-folder', ancestor]]) {
      const response = await call('mcp.move_file', { oldPath, newPath, confirmOldPath: oldPath, confirmNewPath: newPath });
      expect(response.text).toContain('historical read-only');
      await expectPreserved();
    }
  });

  test('requires authentication and retains existing immutable source errors', async () => {
    const anonymous = await call('notes.write', { path: legacyPath, content: 'changed', expectedRevision: revision }, false);
    expect(anonymous.text).toContain('Authentication is required');
    const source = await call('notes.write', { path: sourcePath, content: 'changed', expectedRevision: revision });
    expect(source.text).toContain('immutable LLM Wiki sources');
    expect(source.text).not.toContain('historical read-only');
    await expectPreserved();
  });

  test('aborts a backlink-updating move before changing history or any other file', async () => {
    const linkedHistory = `${bytes}\n[[ordinary]]\n`;
    const linkedOrdinary = '# Other backlink\n\n[[ordinary]]\n';
    await seed(legacyPath, linkedHistory);
    await seed('aaa-backlink.md', linkedOrdinary);
    const paths = [legacyPath, 'aaa-backlink.md', 'ordinary.md'];
    const timestamps = await Promise.all(paths.map(async path => (await stat(join(vault, path), { bigint: true })).mtimeNs));
    const response = await call('notes.move', {
      oldPath: 'ordinary.md', newPath: 'renamed.md', updateLinks: true, expectedRevision: ordinaryRevision,
    });
    expect(response.text).toContain('historical read-only');
    expect(response.result.isError || JSON.parse(response.text).success === false).toBe(true);
    expect(await readFile(join(vault, legacyPath), 'utf8')).toBe(linkedHistory);
    expect(await readFile(join(vault, 'aaa-backlink.md'), 'utf8')).toBe(linkedOrdinary);
    expect(await readFile(join(vault, 'ordinary.md'), 'utf8')).toBe(ordinaryBytes);
    // Byte equality alone could conceal a write followed by rollback.
    expect(await Promise.all(paths.map(async path => (await stat(join(vault, path), { bigint: true })).mtimeNs))).toEqual(timestamps);
    await expect(readFile(join(vault, 'renamed.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('guards service writes and canonical change-set paths below the dispatcher', async () => {
    const fs = new FileSystemService(vault);
    await expect(fs.writeNote({ path: legacyPath, content: 'changed', expectedRevision: revision })).rejects.toThrow('historical read-only');
    const changes = [
      { path: 'ordinary.md', expectedRevision: ordinaryRevision, patches: [{ oldString: 'Ordinary', newString: 'Changed' }] },
      { path: join(vault, legacyPath), expectedRevision: revision, patches: [{ oldString: 'Preserve this task', newString: 'changed' }] },
    ];
    await expect(fs.patchMultipleNotes({ changes, dryRun: true })).rejects.toThrow('historical read-only');
    await expectPreserved();
    expect(await readFile(join(vault, 'ordinary.md'), 'utf8')).toBe(ordinaryBytes);
  });

  test('blocks workflows with generated targets beneath a legacy scope root', async () => {
    const response = await call('mcp.ingest_source', {
      scopeUri: '_collaboration/discussions', sourceId: 'new-evidence', title: 'New evidence', content: 'Must not be ingested here',
    });
    expect(response.result.isError, response.text).toBe(true);
    expect(response.text).toContain('historical read-only');
    await expect(readFile(join(vault, '_collaboration/discussions/_sources/new-evidence.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expectPreserved();
  });

  test('still ingests new immutable source snapshots', async () => {
    const response = await call('mcp.ingest_source', { sourceId: 'new-evidence', title: 'New evidence', content: 'Immutable evidence' });
    expect(response.result.isError, response.text).toBeFalsy();
    expect(await readFile(join(vault, '_sources/new-evidence.md'), 'utf8')).toContain('Immutable evidence');
    await expectPreserved();
  });

  test('allows similarly named sibling writes and file moves', async () => {
    for (const path of ['_collaboration/discussions-extra/note.md', '_collaboration-other/discussions/note.md', '_collaboration/notes.md']) {
      const response = await call('notes.write', { path, content: 'allowed', expectedRevision: 'missing' });
      expect(response.result.isError, response.text).toBeFalsy();
      expect(await readFile(join(vault, path), 'utf8')).toBe('allowed');
    }
    const oldPath = '_collaboration/discussions-extra/note.md';
    const newPath = '_collaboration/discussions-archive/note.md';
    const moved = await call('mcp.move_file', { oldPath, newPath, confirmOldPath: oldPath, confirmNewPath: newPath });
    expect(moved.result.isError, moved.text).toBeFalsy();
    expect(JSON.parse(moved.text).success).toBe(true);
    expect(await readFile(join(vault, newPath), 'utf8')).toBe('allowed');
    await expectPreserved();
  });

  test('keeps anonymous history reads and line continuations bounded', async () => {
    const read = await call('notes.read', { path: legacyPath, maxChars: 800, prettyPrint: true }, false);
    expect(read.result.isError, read.text).toBeFalsy();
    expect(read.text.length).toBeLessThanOrEqual(800);
    const value = JSON.parse(read.text);
    expect(value).toMatchObject({ truncated: true, revision, nextAction: { endpointId: 'mcp.get_note_outline' } });
    const outline = await call(value.nextAction.endpointId, { ...value.nextAction.arguments, maxChars: 1200 }, false);
    expect(outline.result.isError, outline.text).toBeFalsy();
    expect(outline.text.length).toBeLessThanOrEqual(1200);
    let args: Record<string, unknown> = { path: legacyPath, startLine: 6, endLine: 20, maxChars: 800 };
    let reconstructed = '';
    for (let page = 0; page < 20; page++) {
      const window = await call('mcp.read_note_lines', args, false);
      expect(window.result.isError, window.text).toBeFalsy();
      expect(window.text.length).toBeLessThanOrEqual(800);
      const part = JSON.parse(window.text);
      expect(part.revision).toBe(revision);
      reconstructed += part.content;
      if (!part.truncated) break;
      expect(part.content.length).toBeGreaterThan(0);
      expect(part.nextAction).toMatchObject({ endpointId: 'mcp.read_note_lines', arguments: { maxChars: 800 } });
      args = part.nextAction.arguments;
    }
    expect(reconstructed).toBe(bytes.split('\n').slice(5, 20).join('\n'));
    await expectPreserved();
  });
});

test('reusable policy distinguishes history, ancestors, and sibling paths', () => {
  const access = new ScopeAccessPolicy();
  expect(access.isLegacyDiscussionPath('./_collaboration//discussions/../discussions/history.md')).toBe(true);
  expect(access.isLegacyDiscussionPath('_collaboration')).toBe(false);
  expect(access.isLegacyDiscussionPath('_collaboration', true)).toBe(true);
  expect(access.isLegacyDiscussionPath('.', true)).toBe(true);
  expect(access.isLegacyDiscussionPath('_collaboration/discussions-extra', true)).toBe(false);
  expect(access.isLegacyDiscussionPath('_collaboration-other', true)).toBe(false);
  expect(access.isLegacyDiscussionPath('_collaboration. /discussions. /history.md')).toBe(true);
  expect(() => access.assertLegacyDiscussionMutationAllowed('_collaboration', 'move', true)).toThrow('historical read-only');
  expect(() => access.assertMutationAllowed(legacyPath, 'write')).toThrow('historical read-only');
  expect(() => access.assertMutationAllowed('_sources/evidence.md', 'write')).toThrow('immutable LLM Wiki sources');
  expect(() => access.assertMutationAllowed('_scopes/models/gpt/_sources/evidence.md', 'write')).toThrow('immutable LLM Wiki sources');
});
