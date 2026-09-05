import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;
let server: ReturnType<typeof createServer>;
let client: Client;
const path = 'Community/Posts/continuation.md';
const raw = `---\nmcpvault_type: blog_post\nstatus: published\n---\n${Array.from({ length: 12 }, (_, i) => `# Heading ${i}\n${'한글 🌱 quoted " context '.repeat(12)}`).join('\n')}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuation-'));
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), raw);
  server = createServer(vault, { version: 'continuation' });
  client = new Client({ name: 'continuation', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { await client?.close(); await server?.close(); await rm(vault, { recursive: true, force: true }); });
const initial = (tool: string, extra = {}) => ({ endpointId: `mcp.${tool}`, arguments: { path, ...(tool === 'read_note_lines' && { startLine: 1, endLine: 100 }), maxChars: 512, ...extra } });
async function call(action: any) {
  const response = await client.callTool({ name: 'call_endpoint', arguments: action });
  const text = (response.content as any)[0].text as string;
  expect(text.length).toBeLessThanOrEqual(action.arguments.maxChars ?? 512);
  return { response, text, value: text.startsWith('{') ? JSON.parse(text) : undefined };
}

test.each(['read_note_lines', 'get_note_outline'])('%s pins every continuation and reconstructs unchanged pages at 512 chars', async tool => {
  let action: any = initial(tool, { prettyPrint: true });
  let content = '';
  const headings: number[] = [];
  let pages = 0;
  while (action && pages++ < 150) {
    const { response, value } = await call(action);
    expect(response.isError).not.toBe(true);
    expect(value.revision).toBe(hash(raw));
    if (tool === 'read_note_lines') {
      expect(value.content.length).toBeGreaterThan(0);
      expect(value.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
      content += value.content;
    } else {
      expect(value.headings.length).toBeGreaterThan(0);
      headings.push(...value.headings.map((h: any) => h.line));
    }
    if (value.truncated) expect(value.nextAction.arguments.expectedRevision).toBe(hash(raw));
    action = value.nextAction;
  }
  expect(action).toBeUndefined();
  expect(pages).toBeGreaterThan(1);
  if (tool === 'read_note_lines') expect(content).toBe(raw);
  else expect(headings).toEqual(Array.from({ length: 12 }, (_, i) => 5 + i * 2));
});

test.each(['read_note_lines', 'get_note_outline'])('%s rejects changed continuations and offers a fresh outline', async tool => {
  const first = await call(initial(tool));
  expect(first.value.nextAction.arguments.expectedRevision).toBe(hash(raw));
  const changed = raw.replace('Heading 0', 'ChangedPrivateMarker');
  await writeFile(join(vault, path), changed);
  const conflict = await call(first.value.nextAction);
  expect(conflict.response.isError).toBe(true);
  expect(conflict.value).toMatchObject({ error: 'revision_conflict', restartRequired: true });
  expect(conflict.text).not.toContain('ChangedPrivateMarker');
  expect(conflict.value.nextAction.endpointId).toBe('mcp.get_note_outline');
  expect(conflict.value.nextAction.arguments.expectedRevision).toBeUndefined();
  const restart = await call(conflict.value.nextAction);
  expect(restart.response.isError).not.toBe(true);
  expect(restart.value.revision).toBe(hash(changed));
});

test.each(['read_note_lines', 'get_note_outline'])('%s checks visibility before exposing a revision conflict', async tool => {
  const hidden = raw.replace('status: published', 'status: published\nmoderation_status: hidden');
  await writeFile(join(vault, path), hidden);
  const denied = await call(initial(tool, { expectedRevision: hash(raw) }));
  expect(denied.response.isError).toBe(true);
  expect(denied.text).not.toContain(hash(hidden));
  expect(denied.text).not.toContain('Heading 0');
  expect(denied.text).not.toContain('revision_conflict');
});

test.each(['read_note_lines', 'get_note_outline'])('%s validates explicitly supplied revision guards', async tool => {
  const invalid = await call(initial(tool, { expectedRevision: 'not-a-hash' }));
  expect(invalid.response.isError).toBe(true);
  const stale = await call(initial(tool, { expectedRevision: '0'.repeat(64) }));
  expect(stale.response.isError).toBe(true);
  expect(stale.value.error).toBe('revision_conflict');
});

test.each(['read_note_lines', 'get_note_outline'])('%s offers a same-request budget retry instead of corrupting a long path', async tool => {
  const target = `${'folder-name-'.repeat(12)}/${'note-name-'.repeat(12)}.md`;
  await mkdir(dirname(join(vault, target)), { recursive: true });
  await writeFile(join(vault, target), raw);
  const action = initial(tool, { path: target });
  const small = await call(action);
  expect(small.response.isError).toBe(true);
  expect(small.value.error).toBe('response_budget_too_small');
  expect(small.value.retryArguments.maxChars).toBeGreaterThan(512);
  const retry = await call({ ...action, arguments: { ...action.arguments, ...small.value.retryArguments } });
  expect(retry.response.isError).not.toBe(true);
  expect(retry.value.revision).toBe(hash(raw));
  expect(tool === 'read_note_lines' ? retry.value.content.length : retry.value.headings.length).toBeGreaterThan(0);
});

test('outline title abbreviation preserves Unicode and advances at tiny budgets', async () => {
  const title = `a${'🌱'.repeat(300)}`;
  await writeFile(join(vault, path), Array.from({ length: 3 }, () => `# ${title}`).join('\n'));
  let action: any = initial('get_note_outline');
  const lines: number[] = [];
  while (action && lines.length < 4) {
    const { value, response } = await call(action);
    expect(response.isError).not.toBe(true);
    expect(value.headings.length).toBeGreaterThan(0);
    for (const heading of value.headings) {
      expect(heading.text).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(heading.textTruncated).toBe(true);
      lines.push(heading.line);
    }
    action = value.nextAction;
  }
  expect(action).toBeUndefined();
  expect(lines).toEqual([1, 2, 3]);
});

test('a final line page fits without unnecessary continuation overhead', async () => {
  const body = 'x'.repeat(180);
  await writeFile(join(vault, path), body);
  const { value, response } = await call(initial('read_note_lines', { expectedRevision: hash(body).toUpperCase() }));
  expect(response.isError).not.toBe(true);
  expect(value).toMatchObject({ content: body, truncated: false, revision: hash(body) });
  expect(value.nextAction).toBeUndefined();
});

test('a long-path conflict remains a conflict after its same-request budget retry', async () => {
  const target = `extra-directory-for-conflict-budget/${'folder-name-'.repeat(12)}/${'note-name-'.repeat(12)}.md`;
  await mkdir(dirname(join(vault, target)), { recursive: true });
  await writeFile(join(vault, target), raw);
  const action = initial('read_note_lines', { path: target, expectedRevision: '0'.repeat(64) });
  const conflict = await call(action);
  expect(conflict.response.isError).toBe(true);
  expect(conflict.value.error).toBe('revision_conflict');
  expect(conflict.value.nextAction).toBeUndefined();
  expect(conflict.value.retryArguments.maxChars).toBeGreaterThan(512);
  const retried = await call({ ...action, arguments: { ...action.arguments, ...conflict.value.retryArguments } });
  expect(retried.response.isError).toBe(true);
  expect(retried.value.error).toBe('revision_conflict');
  expect(retried.value.nextAction.arguments.path).toBe(target);
});
