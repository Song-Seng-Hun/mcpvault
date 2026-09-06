import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { LlmWikiService } from './llm-wiki.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-canvas-contract-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const write = (path: string, content: string, noteKind = 'atomic', extra: Record<string, unknown> = {}) => fs.writeNote({ path, content,
    frontmatter: { llm_wiki_type: 'knowledge', note_kind: noteKind, lifecycle: 'evergreen', ...extra } });
  await write('Root.md', '# Map\n- [[Child]]\n- [[Other]]', 'moc');
  await write('Child.md', '# Child map\n- [[Leaf]]', 'moc');
  await write('Other.md', '# Other');
  await write('Leaf.md', '# Leaf');
  return { vault, fs, wiki, write };
}

test.each(['moc', 'neighborhood'] as const)('%s export action preserves non-default preview settings and exact fingerprint', async mode => {
  const { wiki } = await fixture();
  const preview = await wiki.canvasView(undefined, 'Root.md', mode, 0, 2, 24000, true);
  expect(preview.exportAction.arguments).toMatchObject({ path: 'Root.md', mode, maxDepth: 0, limit: 2, maxChars: 24000,
    includeSemantic: true, expectedSnapshotFingerprint: preview.snapshotFingerprint });
  const exported = await wiki.writeCanvasView(preview.exportAction.arguments);
  expect(exported.snapshotFingerprint).toBe(preview.snapshotFingerprint);
  expect(exported.counts.fileNodes).toBe(preview.counts.fileNodes);
});

test.each(['edited', 'hidden'] as const)('Canvas preview rejects a child %s while fitting the result', async change => {
  const { fs, wiki, write } = await fixture();
  const exists = fs.noteExists.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'noteExists').mockImplementation(async path => {
    if (!changed && path.endsWith('.canvas')) {
      changed = true;
      await write('Child.md', '# Changed child', 'moc', change === 'hidden' ? { moderation_status: 'hidden' } : {});
    }
    return exists(path);
  });
  await expect(wiki.canvasView(undefined, 'Root.md', 'moc', 2, 10, 24000)).rejects.toThrow(/Canvas.*changed|Canvas.*unavailable/i);
});

test('export rejects a changed child even when the root and output file revisions still match', async () => {
  const { fs, wiki, write } = await fixture();
  const preview = await wiki.canvasView(undefined, 'Root.md', 'moc', 2, 10, 24000);
  await write('Child.md', '# Changed child\n- [[Leaf]]', 'moc');
  expect(await fs.readNoteRevision('Root.md')).toBe(preview.root.revision);
  await expect(wiki.writeCanvasView({ ...preview.exportAction.arguments, maxDepth: 2, limit: 10, maxChars: 24000,
    expectedSnapshotFingerprint: preview.snapshotFingerprint })).rejects.toThrow(/Canvas.*snapshot|Canvas.*preview/i);
  expect(await fs.noteExists(preview.suggestedPath)).toBe(false);
});

test.each([2048, 2400, 4000, 12000])('bounded preview at %i chars can be replayed without changing its selected graph', async maxChars => {
  const { fs, wiki } = await fixture();
  const preview = await wiki.canvasView(undefined, 'Root.md', 'moc', 2, 10, maxChars);
  expect(JSON.stringify(preview, null, 2).length).toBeLessThanOrEqual(maxChars);
  const saved = await wiki.writeCanvasView(preview.exportAction.arguments);
  expect(saved.snapshotFingerprint).toBe(preview.snapshotFingerprint);
  expect(saved.revision).toBe(await fs.readNoteRevision(saved.path));
});

test.each(['Root.md', 'Child.md'])('preview rejects deletion of included source %s during fitting', async path => {
  const { vault, fs, wiki } = await fixture();
  const exists = fs.noteExists.bind(fs);
  let removed = false;
  vi.spyOn(fs, 'noteExists').mockImplementation(async candidate => {
    if (!removed && candidate.endsWith('.canvas')) {
      removed = true;
      await rm(join(vault, path));
    }
    return exists(candidate);
  });
  await expect(wiki.canvasView(undefined, 'Root.md', 'moc', 2, 10, 24000)).rejects.toThrow(/Canvas sources changed or became unavailable/);
});

test('export final validation rejects a source hidden while fitting and leaves no file', async () => {
  const { fs, wiki, write } = await fixture();
  const preview = await wiki.canvasView(undefined, 'Root.md', 'moc', 2, 10, 24000);
  const exists = fs.noteExists.bind(fs);
  let hidden = false;
  vi.spyOn(fs, 'noteExists').mockImplementation(async candidate => {
    if (!hidden && candidate.endsWith('.canvas')) {
      hidden = true;
      await write('Child.md', '# Child map\n- [[Leaf]]', 'moc', { moderation_status: 'hidden' });
    }
    return exists(candidate);
  });
  await expect(wiki.writeCanvasView(preview.exportAction.arguments)).rejects.toThrow(/Canvas sources changed or became unavailable/);
  expect(await fs.noteExists(preview.suggestedPath)).toBe(false);
});

test('invalid snapshot guards reject before file access', async () => {
  const { fs, wiki } = await fixture();
  const read = vi.spyOn(fs, 'readNote');
  await expect(wiki.writeCanvasView({ path: 'Root.md', expectedRevision: 'missing', expectedSnapshotFingerprint: 'bad' })).rejects.toThrow(/SHA-256/);
  expect(read).not.toHaveBeenCalled();
});

test('fixed MCP executor replays a private Canvas action and enforces its child fingerprint', async () => {
  const { vault, fs, write } = await fixture();
  await write('_scopes/models/codex/Root.md', '# Private map\n[[_scopes/models/codex/PrivateChild]]', 'moc');
  await write('_scopes/models/codex/PrivateChild.md', '# Private child');
  const server = createServer(vault, { version: 'test' });
  const client = new Client({ name: 'canvas-contract', version: 'test' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const invoke = async (endpointId: string, args: Record<string, unknown>, accessToken?: string) => {
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
      const text = (result.content as Array<{ type: string; text?: string }>).filter(item => item.type === 'text').map(item => item.text).join('');
      return { result, text, value: result.isError ? undefined : JSON.parse(text) };
    };
    const auth = await invoke('auth.register', { accountId: 'canvas-contract', userId: 'canvas-owner', modelId: 'codex', agentId: 'canvas-contract', password: 'Disposable-canvas-contract-2026!' });
    expect(auth.result.isError).toBeFalsy();
    const token = auth.value.accessToken;
    const preview = await invoke('wiki.canvas_view', { path: 'scope://model/codex/Root.md', maxDepth: 1, limit: 5, maxChars: 12000 }, token);
    expect(preview.result.isError, preview.text).toBeFalsy();
    expect(preview.text).not.toContain('_scopes/');
    expect(preview.value.canvas.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'scope://model/codex/PrivateChild.md' })]));
    const args = preview.value.exportAction.arguments;
    expect(args.expectedSnapshotFingerprint).toBe(preview.value.snapshotFingerprint);
    const denied = await invoke('wiki.canvas_view', { path: 'scope://model/codex/Root.md' });
    expect(denied.result.isError).toBe(true);
    const mismatch = await invoke('wiki.canvas_export', { ...args, expectedSnapshotFingerprint: '0'.repeat(64) }, token);
    expect(mismatch.result.isError).toBe(true);
    expect(mismatch.text).toMatch(/snapshot.*preview/i);
    const saved = await invoke('wiki.canvas_export', args, token);
    expect(saved.result.isError, saved.text).toBeFalsy();
    expect(saved.value.snapshotFingerprint).toBe(preview.value.snapshotFingerprint);
    expect(saved.value.revision).toBe(await fs.readNoteRevision('_scopes/models/codex/Views/Root Spatial.canvas'));
    await write('_scopes/models/codex/PrivateChild.md', '# Changed private child');
    const stale = await invoke('wiki.canvas_export', { ...args, expectedRevision: saved.value.revision }, token);
    expect(stale.result.isError).toBe(true);
    expect(stale.text).toMatch(/snapshot.*preview/i);
    expect(await fs.readNoteRevision('_scopes/models/codex/Views/Root Spatial.canvas')).toBe(saved.value.revision);
    expect((await client.listTools()).tools).toHaveLength(5);
  } finally { await client.close(); await server.close(); }
});

test.each(['Root.md', 'Knowledge/Spatial map.md'])('2048-char preview of %s can refresh an existing Canvas', async path => {
  const { vault, fs, wiki, write } = await fixture();
  if (path !== 'Root.md') await write(path, '# Map\n[[Other]]', 'moc');
  const first = await wiki.canvasView(undefined, path, 'moc', 2, 10, 2048);
  const created = await wiki.writeCanvasView(first.exportAction.arguments);
  const next = await wiki.canvasView(undefined, path, 'moc', 2, 10, 2048);
  expect(JSON.stringify(next, null, 2).length).toBeLessThanOrEqual(2048);
  expect(next.metadataOmitted).toBe(true);
  expect(next.counts.canvasNodes).toBe(next.canvas.nodes.length);
  expect(next.exportAction.arguments.expectedRevision).toBe(created.revision);
  const updated = await wiki.writeCanvasView(next.exportAction.arguments);
  expect(updated.snapshotFingerprint).toBe(next.snapshotFingerprint);
  expect(await fs.readNoteRevision(updated.path)).toBe(updated.revision);
  const persisted = JSON.parse(await readFile(join(vault, updated.path), 'utf8'));
  expect(persisted.nodes.some((node: any) => node.type === 'text' && node.text.includes('mcpvault-canvas:'))).toBe(true);
  expect(updated.counts.canvasNodes).toBe(persisted.nodes.length);
  expect(next.counts.persistedCanvasNodes).toBe(persisted.nodes.length);
  expect(persisted.nodes.filter((node: any) => node.type === 'file')).toEqual(next.canvas.nodes);
});
