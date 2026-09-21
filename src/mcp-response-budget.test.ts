import { expect, test } from 'vitest';
import * as budgets from './mcp-response-budget.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectMcpClient } from '../tests/server-fixture.js';
import { getServerRuntime } from './createServer.js';

test('MCP tool catalog keeps exact schemas within a 5,000-byte result', () => {
  expect(typeof budgets.boundedToolCatalog).toBe('function');
  const tools = [{ name: 'read', description: 'Read current source.', inputSchema: {
    type: 'object', properties: { name: { const: '한국어😀' } }, required: ['name'],
  } }];
  expect(budgets.boundedToolCatalog(tools, tools)).toEqual({ tools });
});

test('oversized translated prose falls back to the unchanged code-owned tool', () => {
  const tools = [{ name: 'read', inputSchema: { type: 'object' }, description: 'Read.' }];
  expect(budgets.boundedToolCatalog(tools, [{ ...tools[0]!, description: '한국어😀'.repeat(1000) }])).toEqual({ tools });
});

test('large catalogs page without losing tools or schema constraints', () => {
  const tools = Array.from({ length: 5 }, (_, index) => ({ name: `tool_${index}`, description: 'Read.',
    inputSchema: { type: 'object', properties: { payload: { const: '한😀"\\'.repeat(100) } } },
  }));
  const found: typeof tools = [];
  let cursor: string | undefined;
  for (let page = 0; page < tools.length; page++) {
    const result = budgets.boundedToolCatalog(tools, tools, cursor);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(5000);
    expect(result.tools.length).toBeGreaterThan(0);
    found.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  expect(cursor).toBeUndefined();
  expect(found).toEqual(tools);
});

test('catalog cursors reject stale, malformed and out-of-range reads', () => {
  const tools = Array.from({ length: 5 }, (_, index) => ({ name: `tool_${index}`,
    inputSchema: { type: 'object' }, description: 'x'.repeat(1200),
  }));
  const cursor = budgets.boundedToolCatalog(tools, tools).nextCursor!;
  expect(cursor).toBeTruthy();
  const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  for (const invalid of ['bad', 'x'.repeat(257), ...[-1, .5, 5].map(o => Buffer.from(JSON.stringify({ ...decoded, o })).toString('base64url'))]) {
    expect(() => budgets.boundedToolCatalog(tools, tools, invalid)).toThrow(/cursor/i);
  }
  const changed = tools.map(tool => ({ ...tool, description: `${tool.description}!` }));
  expect(() => budgets.boundedToolCatalog(changed, changed, cursor)).toThrow(/cursor/i);
});

test('an indivisible oversized tool schema fails explicitly instead of disappearing', () => {
  const tools = [{ name: 'large', inputSchema: { const: 'x'.repeat(6000) } }];
  expect(() => budgets.boundedToolCatalog(tools, tools)).toThrow(/schema.*5000/i);
});

test('read views preserve exact large values and bind continuation to current authority and value', () => {
  const text = '한국어😀\\"'.repeat(2000) + '\uD800';
  const response = { content: [{ type: 'text', text: JSON.stringify({ source: text, count: 7 }) }] };
  const first = budgets.readResponseView(response, '/source', undefined, 'actor:1', 512);
  let page = first, restored = '';
  for (;;) {
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512);
    const value = JSON.parse(page.content[0].text);
    restored += value.resultPage.value.text;
    if (!value.nextCursor) break;
    page = budgets.readResponseView(response, '/source', value.nextCursor, 'actor:1', 512);
  }
  expect(restored).toBe(text);
  const cursor = JSON.parse(first.content[0].text).nextCursor;
  expect(() => budgets.readResponseView(response, '/source', cursor, 'actor:2', 512)).toThrow(/cursor/i);
  const changed = { content: [{ type: 'text', text: JSON.stringify({ source: text + 'changed' }) }] };
  expect(() => budgets.readResponseView(changed, '/source', cursor, 'actor:1', 512)).toThrow(/cursor/i);
  const changedSibling = { content: [{ type: 'text', text: JSON.stringify({ source: text, count: 8 }) }] };
  expect(() => budgets.readResponseView(changedSibling, '/source', cursor, 'actor:1', 512)).toThrow(/cursor/i);
  expect(() => budgets.readResponseView(response, '/missing', undefined, 'actor:1', 512)).toThrow(/path/i);
  expect(() => budgets.readResponseView(response, '/bad~2key', undefined, 'actor:1', 512)).toThrow(/path/i);
});

test('dispatch reads an authorized response view and rejects mutation replay before execution', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-read-view-'));
  const { server, client } = await connectMcpClient(vault, { readOnly: true });
  try {
    const call = getServerRuntime(server)!.dispatchTool;
    const full = await call('get_wiki_organization_manifest', { maxChars: 20000 });
    const viewed = await call('call_endpoint', { endpointId: 'wiki.organization_manifest', arguments: { maxChars: 20000 }, responseView: '/contracts/noteKinds' });
    expect(viewed.isError).toBeFalsy();
    expect(JSON.parse(viewed.content[0].text).resultPage.value).toEqual(JSON.parse(full.content[0].text).contracts.noteKinds);
    expect(Buffer.byteLength(JSON.stringify(viewed))).toBeLessThanOrEqual(5000);
    const legacy = await call('call_endpoint', { endpointId: 'wiki.organization_manifest', arguments: { maxChars: 20000 } });
    expect(legacy).toEqual(full); // Internal/REST calls retain their existing JSON shape.
    const root = await call('call_endpoint', { endpointId: 'wiki.organization_manifest', arguments: { maxChars: 20000 }, responseView: '' });
    expect(JSON.parse(root.content[0].text).resultPage.path).toBe('');
    expect(Buffer.byteLength(JSON.stringify(root))).toBeLessThanOrEqual(5000);
    const displayed = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.organization_manifest', arguments: { maxChars: 20000 } } });
    expect(displayed).toEqual(root);
    const rejected = await call('call_endpoint', { endpointId: 'auth.register', responseView: '' });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0].text).toMatch(/read view.*mutation/i);
  } finally { await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); }
});
