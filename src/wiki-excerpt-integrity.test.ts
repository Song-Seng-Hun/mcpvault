import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { FileSystemService } from './filesystem.js';
import { createServer } from './createServer.js';

let vault: string, server: ReturnType<typeof createServer>, client: Client;
const path = 'Note.md';
const frontmatter = '---\nnote_kind: atomic\n---\n';
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-excerpt-'));
  server = createServer(vault, { version: 'excerpt-test' });
  client = new Client({ name: 'excerpt-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { vi.restoreAllMocks(); await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); });
async function call(args: Record<string, unknown>, endpointId = 'wiki.read_projection') {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { path, maxChars: 4000, ...args } } });
  const text = (result.content as any)[0].text as string;
  expect(text.length).toBeLessThanOrEqual(Number(args.maxChars ?? 4000));
  return { result, text, value: text.startsWith('{') ? JSON.parse(text) : undefined };
}

test.each(['summary', 'key_points', 'progressive'])('%s fallback preserves prose immediately after ATX headings', async view => {
  const raw = frontmatter + '# Intro\nFIRST\n## Detail\nSECOND';
  await writeFile(join(vault, path), raw);
  const { result, value } = await call({ view });
  expect(result.isError).not.toBe(true);
  expect(value.content).toBe(view === 'key_points' ? 'FIRST\n\nSECOND' : 'FIRST');
  expect(value.contentSource).toBe('body_excerpt');
  expect(value.excerptRange).toEqual({ startLine: 5, endLine: view === 'key_points' ? 7 : 5 });
  expect(value.revision).toBe(digest(raw));
  expect(await readFile(join(vault, path), 'utf8')).toBe(raw);
});

test.each(['summary', 'key_points', 'progressive'])('%s fallback excludes matching fenced examples and Setext syntax', async view => {
  const raw = frontmatter + '~~~~md\nFAKE\n\n```\nSTILL-FAKE\n~~~~\n\nReal title\n===\nCURRENT-PROSE';
  await writeFile(join(vault, path), raw);
  const { value } = await call({ view });
  expect(value.content).toBe('CURRENT-PROSE');
  expect(value.excerptRange).toEqual({ startLine: 13, endLine: 13 });
});

test('key points fallback selects at most five real paragraphs and exposes their source envelope', async () => {
  await writeFile(join(vault, path), frontmatter + Array.from({ length: 9 }, (_, i) => `# H${i}\nP${i}`).join('\n'));
  const { value } = await call({ view: 'key_points' });
  expect(value.content).toBe('P0\n\nP1\n\nP2\n\nP3\n\nP4');
  expect(value.excerptRange).toEqual({ startLine: 5, endLine: 13 });
});

test.each([false, true])('a compact headingless excerpt has guarded source recovery (pretty=%s)', async prettyPrint => {
  const raw = frontmatter + 'Long prose '.repeat(900);
  await writeFile(join(vault, path), raw);
  const { value } = await call({ view: 'summary', maxChars: 512, prettyPrint });
  expect(value.contentSource).toBe('body_excerpt');
  expect(value.excerptRange).toEqual({ startLine: 4, endLine: 4 });
  expect(value.truncated).toBe(true);
  expect(value.nextAction).toMatchObject({ endpointId: 'mcp.read_note_lines', arguments: { path, startLine: 4, endLine: 4, expectedRevision: digest(raw) } });
  const recovery = await call(value.nextAction.arguments, value.nextAction.endpointId);
  expect(recovery.result.isError).not.toBe(true);
  expect(recovery.value.content.startsWith('Long prose')).toBe(true);
  await writeFile(join(vault, path), frontmatter + 'CHANGED');
  const conflict = await call(value.nextAction.arguments, value.nextAction.endpointId);
  expect(conflict.result.isError).toBe(true);
  expect(conflict.value.error).toBe('revision_conflict');
  expect(conflict.text).not.toContain('CHANGED');
});

test('an excerpt and its line range use the same captured source snapshot', async () => {
  const raw = frontmatter + '# Intro\nORIGINAL';
  await writeFile(join(vault, path), raw);
  const original = FileSystemService.prototype.readNote;
  let changed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, target: string) {
    const note = await original.call(this, target);
    if (!changed && target === path) { changed = true; await writeFile(join(vault, path), frontmatter + '\n\n# Other\nCONCURRENT'); }
    return note;
  });
  const { value } = await call({ view: 'summary' });
  expect(changed).toBe(true);
  expect(value.content).toBe('ORIGINAL');
  expect(value.excerptRange).toEqual({ startLine: 5, endLine: 5 });
  expect(value.revision).toBe(digest(raw));
});

test('stored summaries and claim projections keep precedence over body fallback', async () => {
  await writeFile(join(vault, path), '---\nsummary: Authored summary\nclaims:\n  - text: Authored claim\n    status: supported\n---\n# Body\nBODY');
  const summary = await call({ view: 'summary' });
  expect(summary.value.content).toBe('Authored summary');
  expect(summary.value.excerptRange).toBeUndefined();
  const points = await call({ view: 'key_points' });
  expect(points.value.content).toBe('- Authored claim [supported]');
  expect(points.value.excerptRange).toBeUndefined();
});

test('an all-fenced or heading-only note has no invented body excerpt', async () => {
  await writeFile(join(vault, path), frontmatter + '# Title\n~~~\nEXAMPLE\n~~~');
  const { value } = await call({ view: 'summary' });
  expect(value.content).toBe('');
  expect(value.excerptRange).toBeUndefined();
  expect(value.contentSource).not.toBe('body_excerpt');
});

test('moderation-hidden sources cannot expose excerpt text or source revision', async () => {
  const raw = '---\nmoderation_status: hidden\n---\n# Title\nPRIVATE-MARKER';
  await writeFile(join(vault, path), raw);
  const { result, text } = await call({ view: 'summary' });
  expect(result.isError).toBe(true);
  expect(text).not.toContain('PRIVATE-MARKER');
  expect(text).not.toContain(digest(raw));
});

test('a paragraph separator at the character ceiling retains the next selected source in recovery', async () => {
  await writeFile(join(vault, path), frontmatter + 'X'.repeat(511) + '\n\nSecond paragraph');
  const { value } = await call({ view: 'key_points', maxChars: 512 });
  expect(value.truncated).toBe(true);
  expect(value.excerptRange).toEqual({ startLine: 4, endLine: 6 });
  expect(value.nextAction.arguments).toMatchObject({ startLine: 4, endLine: 6 });
});

test('key_points reads authored Properties before falling back to body excerpts', async () => {
  await writeFile(join(vault, path), '---\nkey_points:\n  - Authored point\n  - ""\n  - 42\n  - Second point\n---\n# Body\nBODY');
  const { value } = await call({ view: 'key_points' });
  expect(value.content).toBe('- Authored point\n- Second point');
  expect(value.excerptRange).toBeUndefined();
});

test('blank claim text does not suppress valid authored key points', async () => {
  await writeFile(join(vault, path), '---\nclaims:\n  - text: "   "\nkey_points:\n  - Authored point\n---\n# Body\nBODY');
  const { value } = await call({ view: 'key_points' });
  expect(value.content).toBe('- Authored point');
  expect(value.excerptRange).toBeUndefined();
});

test.each(['summary', 'progressive'])('blank metadata does not impersonate useful %s content', async view => {
  await writeFile(join(vault, path), '---\nsummary: "   "\nclaims:\n  - text: ""\nsummary_highlights:\n  - text: "  "\nopen_questions:\n  - "  "\nevidence_paths:\n  - " "\n---\n# Body\nREAL-PROSE');
  const { value } = await call({ view });
  expect(value.content).toBe('REAL-PROSE');
  expect(value.contentSource).toBe('body_excerpt');
});
