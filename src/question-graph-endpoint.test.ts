import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';

let vault: string, client: Client, server: ReturnType<typeof createServer>;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'wiki-graph-endpoint-'));
  await writeFile(join(vault, 'Root.md'), '---\nllm_wiki_type: knowledge\nsupports: [Claim.md]\n---\nentrymarker');
  await writeFile(join(vault, 'Claim.md'), '---\nllm_wiki_type: knowledge\nevidence_paths: [Original.md]\n---\nClaim');
  await writeFile(join(vault, 'Original.md'), '---\nllm_wiki_type: source\n---\nRead this original.');
  server = createServer(vault, { version: 'graph-endpoint-test', readOnly: true });
  client = new Client({ name: 'graph-endpoint-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { try { await client?.close(); } finally { try { await server?.close(); } finally { await rm(vault, { recursive: true, force: true }); } } });
const parse = (r: any) => JSON.parse(r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''));
test('graph is an optional read-only dynamic endpoint argument, not a sixth tool', async () => {
  const tools = await client.listTools();
  expect(tools.tools).toHaveLength(5);
  const catalog = parse(await client.callTool({ name: 'search_capabilities', arguments: { query: 'wiki.answer_packet', limit: 3, maxChars: 10000 } }));
  const descriptor = catalog.endpoints.find((e: any) => e.endpointId === 'wiki.answer_packet');
  expect(descriptor.input.properties.graphDepth.enum).toEqual([1, 2]);
  expect(descriptor.mutating).toBe(false);
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.answer_packet', arguments: { query: 'entrymarker', graphDepth: 2, retrievalMode: 'evidence', includeSemantic: false, maxChars: 12000 } } });
  expect(result.isError).toBeFalsy();
  expect(parse(result).sources.find((r: any) => r.path === 'Original.md').graphPaths[0]).toHaveLength(2);
});
test.each([
  { path: 'Root.md', graphDepth: 2 },
  { query: 'entrymarker', graphDepth: 2 },
  { query: 'entrymarker', graphDepth: 3, retrievalMode: 'evidence' },
])('invalid graph option combinations fail explicitly: %j', async args => {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.answer_packet', arguments: args } });
  expect(result.isError).toBe(true);
});
