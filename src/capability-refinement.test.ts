import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { EndpointRegistry } from './endpoint-registry.js';
import { createServer, getServerRuntime } from '../tests/server-fixture.js';
import { withGuidance } from './guidance-runtime.js';

const closes: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
const publicContext = { readOnly: false, authenticated: false, capabilities: new Set<any>() };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'capability-refinement-'));
  closes.push(() => rm(root, { recursive: true, force: true }));
  const server = createServer(root); closes.push(() => server.close());
  const client = new Client({ name: 'capability-refinement', version: '1' }); closes.push(() => client.close());
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError).not.toBe(true);
    const text = (response.content as Array<{text:string}>)[0]!.text;
    if (args.maxChars) expect(text.length).toBeLessThanOrEqual(args.maxChars as number);
    return JSON.parse(text);
  };
  return { call, client, registry: getServerRuntime(server)!.endpointRegistry };
}

test.each([512, 2000, 12000])('compact active catalog traverses every available endpoint exactly once at budget %i', async maxChars => {
  const { call, registry } = await fixture();
  const seen = new Set<string>(); let cursor: string | undefined, expectedTotal: number | undefined;
  for (let page = 0; page <= registry.size(); page++) {
    const result = await call('list_active_capabilities', { limit: 100, maxChars, ...(cursor && {cursor}) });
    expectedTotal ??= result.total;
    expect(result.total).toBe(expectedTotal);
    expect(result.endpoints.length).toBeGreaterThan(0);
    for (const endpoint of result.endpoints) {
      expect(endpoint.input).toBeUndefined(); expect(endpoint.state).toBe('ready');
      expect(endpoint.available).toBe(true);
      expect(seen.has(endpoint.endpointId)).toBe(false); seen.add(endpoint.endpointId);
    }
    cursor = result.nextCursor;
    if (!cursor) { expect(result.truncated).toBe(false); break; }
    expect(result.truncated).toBe(true);
  }
  expect(seen.size).toBe(expectedTotal);
  // Registered but unauthenticated/host-unconfigured operations are not active.
  expect(seen.size).toBeLessThan(registry.size());
  expect(seen.has('wiki.search')).toBe(true);
});

test('catalog cursors reject changed catalog, authority, and host configuration', () => {
  const registry = new EndpointRegistry();
  const tools = ['one', 'two', 'three'].map(name => ({ name, inputSchema: { type: 'object' as const } }));
  registry.setTools(tools, {}, new Set());
  const list = (context: any, cursor?: string) => registry.list(undefined, 1, 2000, context, false, { compact: true, cursor });
  const cursor = list(publicContext).nextCursor;
  expect(cursor).toBeTruthy(); expect(list(publicContext, cursor).endpoints[0]!.endpointId).not.toBe('mcp.one');
  for (const context of [{ ...publicContext, readOnly: true }, { ...publicContext, principalKey: 'new-session' }, { ...publicContext, skillEvolutionEnabled: false }]) {
    expect(() => list(context, cursor)).toThrow(/cursor.*changed|changed.*cursor/i);
  }
  registry.setTools(tools.slice(1), {}, new Set());
  expect(() => list(publicContext, cursor)).toThrow(/cursor.*changed|changed.*cursor/i);
  expect(() => list(publicContext, 'not-a-cursor')).toThrow(/cursor/i);
});

test('compact catalog projects only the selected code-owned description as guidance', () => {
  const registry = new EndpointRegistry();
  registry.setTools([{ name: 'one', description: 'Original description', inputSchema: { type: 'object' } }], {}, new Set());
  const page = withGuidance({ resolve: (_id, text) => text, resolveDefault: text => `Updated ${text}` }, () => registry.list(undefined, 1, 2000, publicContext, false, { compact: true }));
  expect(page.endpoints[0]!.description).toBe('Updated Original description');
  expect(page.endpoints[0]!.endpointId).toBe('mcp.one');
});

test('exact lookup keeps every validation keyword and deeply nested constraints when prose is compacted', () => {
  const registry = new EndpointRegistry();
  let nested: any = { type: 'string', pattern: '^safe$', description: 'prose '.repeat(8000) };
  for (let i = 0; i < 12; i++) nested = { type: 'object', properties: { description: nested }, required: ['description'], minProperties: 1, unevaluatedProperties: false };
  const input: any = { type: 'object', properties: { nested, literal: { const: { description: 'must survive as data' } } }, dependentRequired: { nested: ['literal'] }, description: 'prose '.repeat(8000) };
  registry.setTools([{ name: 'deep', inputSchema: input }], {}, new Set());
  const endpoint = registry.list('mcp.deep', 1, undefined, publicContext, false).endpoints[0] as any;
  expect(endpoint.schemaCompacted).toBe(true);
  expect(endpoint.schemaOmitted).not.toBe(true); expect(endpoint.input.dependentRequired).toEqual(input.dependentRequired);
  expect(endpoint.input.properties.literal.const).toEqual(input.properties.literal.const);
  let found = endpoint.input.properties.nested;
  for (let i = 0; i < 12; i++) { expect(found.minProperties).toBe(1); expect(found.unevaluatedProperties).toBe(false); found = found.properties.description; }
  expect(found.pattern).toBe('^safe$');
});

test('escaped optional guidance cannot displace catalog rows or their continuation at 512 characters', () => {
  const registry = new EndpointRegistry();
  const tools = ['manage_skill_candidate', 'evaluate_skill'].map(name => ({ name, inputSchema: { type: 'object' as const } }));
  registry.setTools(tools, {}, new Set(tools.map(t => t.name)));
  const context = { ...publicContext, skillEvolutionEnabled: false };
  const result = withGuidance({ resolve: (_id, text) => text === 'skill evolution is disabled by the host' ? '\n"\\'.repeat(80) : text, resolveDefault: text => text },
    () => registry.list(undefined, 1, 512, context, false, { compact: true }));
  expect(result.endpoints[0]!.endpointId).toBe('skill.candidate');
  expect(result.nextCursor).toBeTruthy();
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(registry.list(undefined, 1, 512, context, false, { compact: true, cursor: result.nextCursor }).endpoints[0]!.endpointId).toBe('skill.evaluate');
});

test('representative Korean and English intent queries rank the primary operation in the first three', async () => {
  const { call } = await fixture();
  for (const [query, id] of [['search', 'wiki.search'], ['지식 검색', 'wiki.search'], ['work review', 'work.review_context'], ['작업 검토', 'work.review_context'], ['resume work', 'continuity.resume'], ['작업 재개', 'continuity.resume'], ['maintenance', 'wiki.exception_board'], ['유지보수', 'wiki.exception_board']]) {
    const result = await call('search_capabilities', { query, limit: 3, maxChars: 20000 });
    expect(result.endpoints.map((e: any) => e.endpointId), query).toContain(id);
  }
  const exact = await call('search_capabilities', { query: 'wiki.triage' });
  expect(exact.endpoints[0].input.properties).toHaveProperty('knowledgeRole');
  expect(exact.endpoints[0].schemaOmitted).not.toBe(true);
});

test('every exact endpoint schema is available at the default lookup budget', async () => {
  const { call, client, registry } = await fixture();
  const schema = (await client.listTools()).tools.find(t => t.name === 'search_capabilities')!.inputSchema;
  expect((schema.properties!.maxChars as any).default).toBe(20000);
  const ids: string[] = []; let cursor: string | undefined;
  do {
    const page = await call('list_active_capabilities', { limit: 100, maxChars: 20000, ...(cursor && { cursor }) });
    ids.push(...page.endpoints.map((e: any) => e.endpointId)); cursor = page.nextCursor;
  } while (cursor);
  for (const id of ids) {
    const result = registry.list(id, 1, undefined, publicContext, false);
    expect(result.endpoints[0]?.input, id).toBeDefined();
    expect(JSON.stringify(result).length, id).toBeLessThanOrEqual(20000);
  }
});
