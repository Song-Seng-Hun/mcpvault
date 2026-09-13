import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { FileSystemService } from './filesystem.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';

test('assertions are optional on existing read-only neighborhood endpoint; fixed five tools unchanged', async () => {
  const schema: any = getLlmWikiTools().find(t => t.name === 'get_wiki_neighborhood')!.inputSchema;
  expect(schema.properties.view.enum).toEqual(['neighbors', 'assertions']);
  const root = await mkdtemp(join(tmpdir(), 'assertion-mcp-')), fs = new FileSystemService(root);
  await fs.writeNote({ path: 'A.md', content: '[[B.md]]' });
  await fs.writeNote({ path: 'B.md', content: 'B' });
  const revision = await fs.readNoteRevision('A.md');
  const server = createServer(root, { version: 'assertion-test', readOnly: true });
  const client = new Client({ name: 'assertion-test', version: '1' });
  try {
    const [a,b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    for (const view of [undefined, 'neighbors', 'assertions']) {
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.neighborhood', arguments: { path: 'A.md', ...(view && { view }), maxChars: 4000, prettyPrint: true } } });
      expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
      const text = (result.content as any[]).map(x => x.text || '').join('');
      expect(text.length).toBeLessThanOrEqual(4000);
      if (view === 'assertions') expect(JSON.parse(text).assertions[0].target.path).toBe('B.md');
      else expect(JSON.parse(text).assertions).toBeUndefined();
    }
    expect(await fs.readNoteRevision('A.md')).toBe(revision);
  } finally { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
});
