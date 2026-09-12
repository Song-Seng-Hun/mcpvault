import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { FileSystemService } from './filesystem.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';
import { startRestApi } from './rest-api.js';

test('topic endpoint is discoverable, bounded and read-only within five MCP tools', async () => {
  const descriptor = getLlmWikiTools().find(t => t.name === 'get_wiki_topic_packet');
  expect(descriptor).toBeDefined();
  const schema: any = descriptor!.inputSchema;
  expect(schema.required).toContain('mocPath');
  expect(schema.properties.limit).toMatchObject({ default: 8, maximum: 8 });
  const root = await mkdtemp(join(tmpdir(), 'topic-mcp-'));
  const fs = new FileSystemService(root);
  await fs.writeNote({ path: 'Map.md', content: '# Map', frontmatter: { note_kind: 'moc' } });
  const server = createServer(root, { version: 'topic-test', readOnly: true });
  const client = new Client({ name: 'topic-test', version: '1' });
  try {
    const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    for (const maxChars of [768, 7000]) {
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.topic_packet', arguments: { mocPath: 'Map.md', maxChars, prettyPrint: true } } });
      expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
      const text = (result.content as any[]).map(x => x.text || '').join('');
      expect(text.length).toBeLessThanOrEqual(maxChars); expect(JSON.parse(text).mode).toBe('topic_packet');
    }
    const api = await startRestApi(server, { port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${api.port}/api/wiki/topic-packet?mocPath=Map.md&limit=1&maxChars=7000`);
      expect(response.status, await response.text()).toBe(200);
    } finally { await api.close(); }
  } finally { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
});
