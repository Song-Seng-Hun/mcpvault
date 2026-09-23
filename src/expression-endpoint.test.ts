import { expect, test } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';

test('read-only MCP exposes profile cards and exact chapters without document writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'expression-mcp-'));
  const server = createServer(root, { readOnly: true });
  const client = new Client({ name: 'expression-read-test', version: '1' });
  try {
    const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
    const before = await readdir(root);
    const call = (args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.policy', arguments: args } });
    const text = (r: any) => r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    const index = await call({ topic: 'expression', maxChars: 4000 });
    expect(index.isError).toBeFalsy(); const cards = JSON.parse(text(index));
    expect(cards.items).toHaveLength(3); expect(cards.body).toBeUndefined();
    for (const card of cards.items) {
      const response = await call(card.readAction.arguments);
      expect(response.isError).toBeFalsy(); const full = JSON.parse(text(response));
      expect(full.partial).toBe(false); expect(full.body).toContain('authority: style-only');
      const small = await call({ ...card.readAction.arguments, maxChars: 1024, prettyPrint: true });
      expect(small.isError).toBeFalsy(); expect(text(small).length).toBeLessThanOrEqual(1024);
      expect(JSON.parse(text(small))).toMatchObject({ partial: true });
    }
    const stale = await call({ ...cards.items[0].readAction.arguments, expectedProfileRevision: '0'.repeat(64) });
    expect(stale.isError).toBe(true);
    expect((await client.listTools()).tools).toHaveLength(16);
    // Existing endpoint audit runs on reads too; it is not a document mutation.
    expect((await readdir(root)).filter(p => p !== '.mcpvault')).toEqual(before);
    expect((await readdir(root, { recursive: true })).map(p => p.replaceAll('\\', '/'))
      .filter(p => p !== '.mcpvault' && p !== '.mcpvault/audit.ndjson')).toEqual([]);
  } finally { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
});
