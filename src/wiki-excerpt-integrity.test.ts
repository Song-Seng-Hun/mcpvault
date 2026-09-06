import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
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

test.each(['summary', 'key_points', 'progressive', 'full'])('compact %s retains stale projection flags instead of presenting unqualified content', async view => {
  const raw = '---\nsummary: ' + 'OLD-SUMMARY '.repeat(100) + '\nkey_points:\n  - ' + 'OLD-POINT '.repeat(100)
    + '\nsummary_of_content_sha256: ' + '0'.repeat(64) + '\n---\n# Current\n' + 'CURRENT-BODY '.repeat(100);
  await writeFile(join(vault, path), raw);
  const { result, value } = await call({ view, maxChars: 512 });
  expect(result.isError).not.toBe(true);
  expect(value.truncated).toBe(true);
  expect(value.summaryFresh).toBe(false);
  expect(value.summaryStale).toBe(true);
  expect(value.revision).toBe(digest(raw));
  expect(value.nextAction.arguments.expectedRevision).toBe(digest(raw));
});

test.each([false, true])('a fresh stored projection retains verified digest-match flags after compaction (pretty=%s)', async prettyPrint => {
  const body = '# Current\nCURRENT-BODY';
  const raw = '---\nsummary: ' + 'AUTHORED-SUMMARY '.repeat(100) + '\nsummary_of_content_sha256: ' + digest(body) + '\n---\n' + body;
  await writeFile(join(vault, path), raw);
  const { value } = await call({ view: 'summary', maxChars: 512, prettyPrint });
  expect(value.summaryFresh).toBe(true);
  expect(value.summaryStale).toBe(false);
});

test('missing summary fingerprint remains stale after compaction rather than becoming unknown', async () => {
  await writeFile(join(vault, path), '---\nsummary: ' + 'NO-BASIS '.repeat(200) + '\n---\nBody');
  const { value } = await call({ view: 'summary', maxChars: 512 });
  expect(value.summaryFresh).toBe(false);
  expect(value.summaryStale).toBe(true);
});

test('a body excerpt keeps its identity as current source even if stored blank metadata is stale', async () => {
  await writeFile(join(vault, path), '---\nsummary: " "\nsummary_of_content_sha256: ' + '0'.repeat(64) + '\n---\n' + 'CURRENT-PROSE '.repeat(200));
  const { result, value } = await call({ view: 'summary', maxChars: 512 });
  expect(result.isError).not.toBe(true);
  expect(value.contentSource).toBe('body_excerpt');
  expect(value.summaryFresh).toBe(false);
  expect(value.summaryStale).toBe(true);
  expect(value.excerptRange).toEqual({ startLine: 5, endLine: 5 });
});

test('ordinary source without projection metadata does not acquire freshness claims in compact output', async () => {
  await writeFile(join(vault, path), 'CURRENT-PROSE '.repeat(200));
  const { value } = await call({ view: 'summary', maxChars: 512 });
  expect(value.contentSource).toBe('body_excerpt');
  expect(value.summaryFresh).toBeUndefined();
  expect(value.summaryStale).toBeUndefined();
});

test('compact freshness is computed from the captured body rather than caller-authored flags', async () => {
  const raw = '---\nsummary: ' + 'OLD '.repeat(300) + '\nsummaryFresh: true\nsummaryStale: false\nsummary_of_content_sha256: ' + '0'.repeat(64) + '\n---\nCurrent';
  await writeFile(join(vault, path), raw);
  const { value } = await call({ view: 'summary', maxChars: 512 });
  expect(value).toMatchObject({ summaryFresh: false, summaryStale: true, revision: digest(raw) });
});

test('compact freshness and recovery stay pinned to one captured revision across a concurrent edit', async () => {
  const body = 'ORIGINAL-BODY';
  const raw = '---\nsummary: ' + 'AUTHORED '.repeat(300) + '\nsummary_of_content_sha256: ' + digest(body) + '\n---\n' + body;
  await writeFile(join(vault, path), raw);
  const original = FileSystemService.prototype.readNote;
  let changed = false;
  vi.spyOn(FileSystemService.prototype, 'readNote').mockImplementation(async function(this: FileSystemService, target: string) {
    const note = await original.call(this, target);
    if (!changed && target === path) { changed = true; await writeFile(join(vault, path), raw.replace('ORIGINAL-BODY', 'CONCURRENT-BODY')); }
    return note;
  });
  const { value } = await call({ view: 'summary', maxChars: 512 });
  expect(changed).toBe(true);
  expect(value).toMatchObject({ summaryFresh: true, summaryStale: false, revision: digest(raw) });
  const recovery = await call(value.nextAction.arguments, value.nextAction.endpointId);
  expect(recovery.result.isError).toBe(true);
  expect(recovery.value.error).toBe('revision_conflict');
});

test.each(['wiki.summary_candidates', 'wiki.resurface'])('%s inspect action rejects a source changed after the candidate was returned', async endpointId => {
  const raw = '---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n# Intro\nORIGINAL-CANDIDATE';
  await writeFile(join(vault, path), raw);
  const { result, value } = await call({ maxChars: 512 }, endpointId);
  expect(result.isError).not.toBe(true);
  const action = value.items[0].nextAction;
  expect(action.arguments.expectedRevision).toBe(digest(raw));
  const current = await call(action.arguments, action.endpointId);
  expect(current.result.isError).not.toBe(true);
  expect(current.value.revision).toBe(digest(raw));
  await writeFile(join(vault, path), raw.replace('ORIGINAL-CANDIDATE', 'CHANGED-CANDIDATE'));
  const changed = await call(action.arguments, action.endpointId);
  expect(changed.result.isError).toBe(true);
  expect(changed.value.error).toBe('revision_conflict');
  expect(changed.text).not.toContain('CHANGED-CANDIDATE');
});

test('notes.read expectedRevision cannot be bypassed by a matching knownRevision cache hint', async () => {
  const raw = frontmatter + 'CURRENT';
  await writeFile(join(vault, path), raw);
  const { result, value, text } = await call({ expectedRevision: digest('old'), knownRevision: digest(raw) }, 'notes.read');
  expect(result.isError).toBe(true);
  expect(value.error).toBe('revision_conflict');
  expect(value.notModified).toBeUndefined();
  expect(text).not.toContain('CURRENT');
});

test('notes.read validates an expectedRevision even when knownRevision matches', async () => {
  const raw = frontmatter + 'CURRENT';
  await writeFile(join(vault, path), raw);
  const { result, text } = await call({ expectedRevision: 'not-a-revision', knownRevision: digest(raw) }, 'notes.read');
  expect(result.isError).toBe(true);
  expect(text).toMatch(/expectedRevision|SHA-256/);
  expect(text).not.toContain('CURRENT');
});

test('notes.read preserves matching cache hints after checking the expected source revision', async () => {
  const raw = frontmatter + 'CURRENT';
  await writeFile(join(vault, path), raw);
  const { result, value } = await call({ expectedRevision: digest(raw), knownRevision: digest(raw) }, 'notes.read');
  expect(result.isError).not.toBe(true);
  expect(value).toMatchObject({ notModified: true, revision: digest(raw) });
});

test('notes.read checks current moderation before expectedRevision or a knownRevision hint', async () => {
  const raw = '---\nmoderation_status: hidden\n---\nPRIVATE-CONTENT';
  await writeFile(join(vault, path), raw);
  const { result, text } = await call({ expectedRevision: digest('old'), knownRevision: digest(raw) }, 'notes.read');
  expect(result.isError).toBe(true);
  expect(text).not.toContain('PRIVATE-CONTENT');
  expect(text).not.toContain(digest(raw));
  expect(text).not.toContain('revision_conflict');
});

test('notes.read without a guard still checks moderation before returning notModified', async () => {
  const raw = '---\nmoderation_status: hidden\n---\nPRIVATE-CONTENT';
  await writeFile(join(vault, path), raw);
  const { result, text } = await call({ knownRevision: digest(raw) }, 'notes.read');
  expect(result.isError).toBe(true);
  expect(text).not.toContain(digest(raw));
  expect(text).not.toContain('PRIVATE-CONTENT');
});

test('notes.read changed cache hint returns the guarded current snapshot', async () => {
  const raw = frontmatter + 'CURRENT';
  await writeFile(join(vault, path), raw);
  const { result, value } = await call({ expectedRevision: digest(raw).toUpperCase(), knownRevision: digest('old') }, 'notes.read');
  expect(result.isError).not.toBe(true);
  expect(value).toMatchObject({ revision: digest(raw), content: 'CURRENT' });
});

test('notes.read conflict from a large read budget offers a valid outline recovery', async () => {
  await writeFile(join(vault, path), frontmatter + 'CURRENT');
  const { value } = await call({ expectedRevision: digest('old'), maxChars: 20000 }, 'notes.read');
  expect(value.error).toBe('revision_conflict');
  expect(value.nextAction.arguments.maxChars).toBeLessThanOrEqual(12000);
  const recovery = await call(value.nextAction.arguments, value.nextAction.endpointId);
  expect(recovery.result.isError).not.toBe(true);
});

test('notes.read long-path cache responses fit the budget without truncating the identity', async () => {
  const folders = Array.from({ length: 7 }, (_, i) => String(i) + 'x'.repeat(75));
  await mkdir(join(vault, ...folders), { recursive: true });
  const target = [...folders, 'Note.md'].join('/');
  const raw = frontmatter + 'CURRENT';
  await writeFile(join(vault, target), raw);
  const { result, value } = await call({ path: target, knownRevision: digest(raw), maxChars: 512 }, 'notes.read');
  expect(result.isError).toBe(true);
  expect(value.error).toBe('response_budget_too_small');
  const retry = await call({ path: target, knownRevision: digest(raw), ...value.retryArguments }, 'notes.read');
  expect(retry.result.isError).not.toBe(true);
  expect(retry.value).toMatchObject({ notModified: true, path: target, revision: digest(raw) });
});

test('notes.read truncated body keeps its revision on the outline continuation', async () => {
  const raw = frontmatter + '# Intro\n' + 'CURRENT '.repeat(2000);
  await writeFile(join(vault, path), raw);
  const { value } = await call({ maxChars: 512 }, 'notes.read');
  expect(value.truncated).toBe(true);
  expect(value.nextAction.arguments.expectedRevision).toBe(digest(raw));
  await writeFile(join(vault, path), raw.replace('Intro', 'Changed'));
  const recovery = await call(value.nextAction.arguments, value.nextAction.endpointId);
  expect(recovery.result.isError).toBe(true);
  expect(recovery.value.error).toBe('revision_conflict');
});

test('quality MCP assessment distinguishes authored sections from fenced examples', async () => {
  const raw = '---\nnote_kind: experiment\nepistemic_status: failed\n---\n~~~md\n# Protocol\nExample only\n~~~\n\nResults\n===\nObserved failure.\n\nReproduction\n===\nRepeat the same measurement.';
  await writeFile(join(vault, path), raw);
  const { result, value } = await call({ maxChars: 12000 }, 'wiki.quality_check');
  expect(result.isError).not.toBe(true);
  expect(value.assessment).toBe('authoring_structure');
  expect(value.checks).toContainEqual(expect.objectContaining({ id: 'reproducible_protocol', passed: false }));
  for (const id of ['observations_or_result', 'reproduction']) {
    expect(value.checks).toContainEqual(expect.objectContaining({ id, passed: true }));
  }
  expect(await readFile(join(vault, path), 'utf8')).toBe(raw);
});

test('compact quality MCP action rejects a source changed after assessment', async () => {
  const raw = frontmatter + '# Current\nAuthored text.';
  await writeFile(join(vault, path), raw);
  const { value } = await call({ maxChars: 512 }, 'wiki.quality_check');
  const action = value.nextAction;
  expect(action.arguments.expectedRevision).toBe(digest(raw));
  expect((await call(action.arguments, action.endpointId)).result.isError).not.toBe(true);
  await writeFile(join(vault, path), raw.replace('Authored text.', 'Changed after assessment.'));
  const changed = await call(action.arguments, action.endpointId);
  expect(changed.result.isError).toBe(true);
  expect(changed.value.error).toBe('revision_conflict');
  expect(changed.text).not.toContain('Changed after assessment.');
});
