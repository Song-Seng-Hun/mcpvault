import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';

let vault: string, client: Client, server: ReturnType<typeof createServer>;
afterEach(async () => { try { await client?.close(); } finally { try { await server?.close(); }
  finally { if (vault) await rm(vault, { recursive: true, force: true }); } } });
const parse = (r: any) => JSON.parse(r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''));
test('fidelity is discoverable read-only through the existing fixed-five control plane', async () => {
  vault = await mkdtemp(join(tmpdir(), 'fidelity-endpoint-'));
  server = createServer(vault, { readOnly: true }); client = new Client({ name: 'fidelity-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  expect((await client.listTools()).tools).toHaveLength(5);
  const discovery = parse(await client.callTool({ name: 'search_capabilities', arguments: { query: 'wiki.fidelity_check', limit: 1, maxChars: 12000 } }));
  const endpoint = discovery.endpoints.find((e: any) => e.endpointId === 'wiki.fidelity_check');
  expect(endpoint).toBeDefined(); expect(endpoint.mutating).toBe(false);
  const invalid = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.fidelity_check', arguments: {
    sourcePath: 'Hidden.md', outputPath: 'Missing.md', sourceRevision: '0'.repeat(64), outputRevision: '0'.repeat(64), facts: [], maxChars: 512,
  } } });
  expect(invalid.isError).toBe(true);
  expect(JSON.stringify(invalid)).not.toContain('Hidden.md');
});
