import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { FileSystemService } from './filesystem.js';
import { createServer } from './createServer.js';

let vault: string;
let server: ReturnType<typeof createServer>;
let client: Client;
const path = 'source.md';
const frontmatter = '---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n';
const before = `${frontmatter}# Chosen\nORIGINAL body\n## Sub\nOriginal detail\n# Next\nOther`;
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-wiki-projection-'));
  await writeFile(join(vault, path), before);
  server = createServer(vault, { version: 'wiki-projection-integrity' });
  client = new Client({ name: 'wiki-projection-integrity', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { vi.restoreAllMocks(); await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); });
const actions = [
  { label: 'outline', endpointId: 'wiki.read_projection', args: { view: 'outline' } },
  { label: 'section', endpointId: 'wiki.read_projection', args: { view: 'section', section: 'Chosen' } },
  { label: 'split', endpointId: 'wiki.split_preview', args: { heading: 'Chosen' } },
];
async function call(endpointId: string, args: any = {}) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { path, maxChars: 4000, ...args } } });
  const text = (result.content as any)[0].text as string;
  expect(text.length).toBeLessThanOrEqual(args.maxChars ?? 4000);
  return { result, text, value: text.startsWith('{') ? JSON.parse(text) : undefined };
}
function changeAfterSnapshot(after: string) {
  const original = FileSystemService.prototype.readNote;
  let changed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, target: string) {
    const note = await original.call(this, target);
    if (!changed && target === path) { changed = true; await writeFile(join(vault, path), after); }
    return note;
  });
  return () => changed;
}

test.each(actions)('$label uses the same snapshot for source revision and section/outline locators', async action => {
  const changed = changeAfterSnapshot(`${frontmatter}# Concurrent top\n\n\n# Chosen\nCONCURRENT body\n# Next\nOther`);
  const { result, text, value } = await call(action.endpointId, action.args);
  expect(changed()).toBe(true);
  expect(result.isError).not.toBe(true);
  expect(value.revision ?? value.sourceRevision).toBe(digest(before));
  expect(text).not.toContain('Concurrent top');
  expect(text).not.toContain('CONCURRENT body');
  if (action.label !== 'outline') {
    expect(value.content).toBe('# Chosen\nORIGINAL body\n## Sub\nOriginal detail');
    expect(value.section ?? value.range).toMatchObject({ startLine: 5, endLine: 8 });
  }
});

test.each(actions)('$label does not project a newly hidden second snapshot', async action => {
  const hidden = `---\nmoderation_status: hidden\n---\n# HiddenMarker\n# Chosen\nHidden body`;
  changeAfterSnapshot(hidden);
  const first = await call(action.endpointId, action.args);
  expect(first.result.isError).not.toBe(true);
  expect(first.text).not.toContain('HiddenMarker');
  const denied = await call(action.endpointId, action.args);
  expect(denied.result.isError).toBe(true);
  expect(denied.text).not.toContain(digest(hidden));
  expect(denied.text).not.toContain('Hidden body');
});

test.each(['wiki.read_projection', 'wiki.split_preview'])('%s rejects hidden source snapshots even if immediately published', async endpointId => {
  await writeFile(join(vault, path), '---\nmoderation_status: hidden\n---\n# Chosen\nPrivate body');
  changeAfterSnapshot(before);
  const denied = await call(endpointId, { view: 'section', section: 'Chosen', heading: 'Chosen' });
  expect(denied.result.isError).toBe(true);
  expect(denied.text).not.toContain('Private body');
});

test.each(['wiki.read_projection', 'wiki.split_preview'])('%s prefers exact headings and rejects ambiguous matches', async endpointId => {
  const args = { view: 'section', section: 'Chosen', heading: 'Chosen', contextBefore: 0, contextAfter: 0 };
  await writeFile(join(vault, path), '# Chosen extended\nWrong\n# Chosen\nRight');
  const exact = await call(endpointId, args);
  expect(exact.result.isError).not.toBe(true);
  expect(exact.value.content).toBe('# Chosen\nRight');
  for (const raw of ['# Chosen\nFirst\n# Chosen\nSecond', '# Chosen first\nFirst\n# Chosen second\nSecond']) {
    await writeFile(join(vault, path), raw);
    const ambiguous = await call(endpointId, args);
    expect(ambiguous.result.isError).toBe(true);
    expect(ambiguous.text).toMatch(/ambiguous/i);
    expect(ambiguous.text).toContain('mcp.get_note_outline');
  }
});

test('block projection resolves a terminal anchor, not Properties, fenced examples, inline text or an ID prefix', async () => {
  const raw = [
    '---', 'summary: pretend ^claim', '---',
    '~~~~md', 'Example ^claim', '~~~', 'Still fenced ^claim', '~~~~',
    '```md', 'Example ^claim', '```',
    'Prefix ^claim-extra', 'Mention ^claim followed by text', 'Real evidence ^claim', 'After',
  ].join('\n');
  await writeFile(join(vault, path), raw);
  const { value, result } = await call('wiki.read_projection', { view: 'section', blockId: 'claim', contextBefore: 0, contextAfter: 0 });
  expect(result.isError).not.toBe(true);
  expect(value.content).toBe('Real evidence ^claim');
  expect(value.section).toMatchObject({ startLine: 14, endLine: 14 });
  expect(value.revision).toBe(digest(raw));
});

test('duplicate block anchors require disambiguation instead of choosing the first evidence', async () => {
  await writeFile(join(vault, path), 'First ^claim\nSecond ^claim');
  const result = await call('wiki.read_projection', { view: 'section', blockId: 'claim' });
  expect(result.result.isError).toBe(true);
  expect(result.text).toMatch(/ambiguous/i);
  expect(result.text).toContain('mcp.get_note_outline');
});

test('nearby context never repeats a boundary line or includes the selected line as its own neighbor', async () => {
  await writeFile(join(vault, path), '# First\nBody\n# Last');
  const first = await call('wiki.read_projection', { view: 'section', section: 'First', contextBefore: 3, contextAfter: 3 });
  expect(first.value.context.before).toEqual([]);
  expect(first.value.context.after).toEqual([{ line: 3, text: '# Last' }]);
  const last = await call('wiki.read_projection', { view: 'section', section: 'Last', contextBefore: 3, contextAfter: 3 });
  expect(last.value.context.after).toEqual([]);
  expect(last.value.context.before).toEqual([{ line: 1, text: '# First' }, { line: 2, text: 'Body' }]);
});

test.each(['wiki.read_projection', 'wiki.split_preview'])('%s retains the source range and guarded recovery when its total response is truncated', async endpointId => {
  const raw = `${frontmatter}# Chosen\n${'large evidence '.repeat(700)}\n# Next\nOther`;
  await writeFile(join(vault, path), raw);
  const small = await call(endpointId, { view: 'section', section: 'Chosen', heading: 'Chosen', maxChars: 512 });
  expect(small.result.isError).not.toBe(true);
  expect(small.value.revision ?? small.value.sourceRevision).toBe(digest(raw));
  expect(small.value.section ?? small.value.range).toMatchObject({ startLine: 5, endLine: 6 });
  expect(small.value.truncated).toBe(true);
  expect(small.value.nextAction).toMatchObject({ endpointId: 'mcp.read_note_lines', arguments: { path, startLine: 5, endLine: 6, expectedRevision: digest(raw) } });
  const recovery = await call(small.value.nextAction.endpointId, small.value.nextAction.arguments);
  expect(recovery.result.isError).not.toBe(true);
  expect(recovery.value.revision).toBe(digest(raw));
  expect(recovery.value.content.startsWith('# Chosen')).toBe(true);
});

test.each(['mcp.read_note_lines', 'mcp.get_note_outline', 'notes.read', 'mcp.get_frontmatter'])('%s cannot bypass a Wiki projection moderation denial outside Community folders', async endpointId => {
  const hidden = '---\nmoderation_status: hidden\nsecret_property: PrivateMarker\n---\n# PrivateMarker\nHidden body';
  await writeFile(join(vault, path), hidden);
  const denied = await call(endpointId, { startLine: 1, endLine: 8, expectedRevision: digest(before), maxChars: 512 });
  expect(denied.result.isError).toBe(true);
  expect(denied.text).not.toContain('PrivateMarker');
  expect(denied.text).not.toContain(digest(hidden));
  expect(denied.text).not.toContain('revision_conflict');
});

test.each([true, false])('batch reads exclude hidden notes even with includeFrontmatter=%s', async includeFrontmatter => {
  const hidden = '---\nmoderation_status: hidden\n---\nPrivateMarker';
  await writeFile(join(vault, path), hidden);
  const batch = await call('mcp.read_multiple_notes', { paths: [path], includeFrontmatter });
  expect(batch.text).not.toContain('PrivateMarker');
  expect(batch.value.ok).toEqual([]);
  const known = await call('mcp.read_multiple_notes', { paths: [path], includeFrontmatter, knownRevisions: { [path]: digest(hidden) } });
  expect(known.value.ok).toEqual([]);
});

test('visible batch reads preserve both metadata omission and unchanged response contracts', async () => {
  const visible = await call('mcp.read_multiple_notes', { paths: [path], includeFrontmatter: false });
  expect(visible.value.ok[0].content).toContain('ORIGINAL body');
  expect(visible.value.ok[0].frontmatter).toBeUndefined();
  const unchanged = await call('mcp.read_multiple_notes', { paths: [path], knownRevisions: { [path]: digest(before) } });
  expect(unchanged.value.ok[0]).toMatchObject({ path, revision: digest(before), unchanged: true });
  expect(unchanged.value.ok[0].content).toBeUndefined();
  expect(unchanged.value.ok[0].frontmatter).toBeUndefined();
});
