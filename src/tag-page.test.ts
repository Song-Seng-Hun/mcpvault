import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string;
let client: Client;
let server: ReturnType<typeof createServer>;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-tag-page-'));
  await writeFile(join(vault, 'Tags.md'), Array.from({ length: 80 }, (_, i) => `#topic/${String(i).padStart(3, '0')}`).join(' '));
  await writeFile(join(vault, 'Korean.md'), '#한국어/정리 #한국어/질문 #popular #popular');
  await writeFile(join(vault, 'Hidden.md'), '---\nmoderation_status: hidden\n---\n#hidden_marker');
  await mkdir(join(vault, '_scopes/models/other'), { recursive: true });
  await writeFile(join(vault, '_scopes/models/other/Private.md'), '#private_marker');
  server = createServer(vault, { version: 'tag-pages' });
  client = new Client({ name: 'tag-pages', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); });

async function call(args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'mcp.list_all_tags', arguments: args } });
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  return { result, text, page: result.isError ? undefined : JSON.parse(text) };
}

test('public bounded pages discover every permitted tag exactly once', async () => {
  let args: Record<string, unknown> = { maxChars: 1200, prettyPrint: true, limit: 50 };
  const tags: Array<{ tag: string; count: number }> = [];
  for (let step = 0; step < 100; step++) {
    const { result, text, page } = await call(args);
    expect(result.isError).not.toBe(true);
    expect(text.length).toBeLessThanOrEqual(Number(args.maxChars));
    expect(page.total).toBe(83);
    expect(page.offset).toBe(tags.length);
    expect(page.returned).toBeGreaterThan(0);
    expect(text).not.toMatch(/hidden_marker|private_marker/);
    tags.push(...page.tags);
    if (!page.nextAction) break;
    expect(page.nextAction.endpointId).toBe('mcp.list_all_tags');
    args = page.nextAction.arguments;
  }
  expect(tags).toHaveLength(83);
  expect(new Set(tags.map(t => t.tag)).size).toBe(83);
  expect(tags[0]).toEqual({ tag: 'popular', count: 2 });
});

test('literal prefix accepts a leading hash and preserves exact Unicode nested tags', async () => {
  const { page } = await call({ prefix: ' #한국어/ ', maxChars: 512 });
  expect(page.tags).toEqual([{ tag: '한국어/정리', count: 1 }, { tag: '한국어/질문', count: 1 }]);
  expect(page.total).toBe(2);
  expect(page.nextAction).toBeUndefined();
});

test('the discoverable tag schema declares pagination without polluting Git status', async () => {
  const discover = async (query: string) => {
    const result = await client.callTool({ name: 'search_capabilities', arguments: { query, limit: 1, maxChars: 12000 } });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
  };
  const tags = await discover('mcp.list_all_tags');
  expect(JSON.stringify(tags)).toContain('expectedSnapshot');
  expect(JSON.stringify(tags)).toContain('Literal case-insensitive');
  const git = await discover('mcp.get_revision_status');
  expect(JSON.stringify(git)).not.toContain('tag prefix');
  expect(JSON.stringify(git)).not.toContain('expectedSnapshot');
});

test('continuation is bound to its filtered tag view and rejects invalid inputs', async () => {
  const { page } = await call({ prefix: 'topic/', limit: 1 });
  expect(page.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect((await call({ ...page.nextAction.arguments, prefix: '한국어/' })).result.isError).toBe(true);
  for (const invalid of [{ offset: 1 }, { offset: -1 }, { limit: 0 }, { limit: 1.5 }, { maxChars: 511 }, { prefix: 1 }, { expectedSnapshot: 'bad' }]) {
    expect((await call(invalid)).result.isError).toBe(true);
  }
});
