import { expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    expect((await client.listTools()).tools).toHaveLength(16);
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

test('graph health accepts one-note inspection without a whole-vault health scan', async () => {
  const schema: any = getLlmWikiTools().find(t => t.name === 'get_wiki_graph_health')!.inputSchema;
  expect(schema.properties.path).toMatchObject({ type: 'string' });
  const root = await mkdtemp(join(tmpdir(), 'graph-health-scoped-')), fs = new FileSystemService(root);
  await fs.writeNote({ path: 'A.md', content: '[[B]]' }); await fs.writeNote({ path: 'B.md', content: 'B' });
  const server = createServer(root, { readOnly: true }), client = new Client({ name: 'scoped-graph', version: '1' });
  try {
    const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.graph_health',
      arguments: { path: 'A.md', maxChars: 4000, limit: 50 } } });
    expect(result.isError).toBeFalsy();
    const packet = JSON.parse((result.content as any[]).map(x => x.text ?? '').join(''));
    expect(packet.root.path).toBe('A.md'); expect(packet.assertions[0].target.path).toBe('B.md');
    expect(packet.coverage.globalIntegrity).toBe(false);
  } finally { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
});

test('core-only MCP connects configured disk resolution and keeps the five-tool read-only surface', async () => {
  const root = await mkdtemp(join(tmpdir(), 'graph-disk-mcp-')), vault = join(root, 'vault'), host = join(root, 'host');
  await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  const fs = new FileSystemService(vault);
  await fs.writeNote({ path: 'A.md', content: '[[배포 안내]]' });
  await fs.writeNote({ path: 'B.md', content: 'Only if enabled.', frontmatter: { aliases: ['배포 안내'] } });
  vi.stubEnv('MCPVAULT_MEMORY_CACHE_DIR', host);
  const server = createServer(vault, { readOnly: true, features: { version: 1, selected: ['wiki-core'] } });
  const client = new Client({ name: 'graph-disk', version: '1' });
  const scans = vi.spyOn(FileSystemService.prototype, 'createNoteReferenceResolver');
  try {
    const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
    expect((await client.listTools()).tools).toHaveLength(16);
    let packet: any;
    const deadline = Date.now() + 15000;
    do {
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.graph_health', arguments: { path: 'A.md', maxChars: 4000 } } });
      expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
      packet = JSON.parse((result.content as any[]).map(x => x.text ?? '').join(''));
      if (packet.assertions.length) break;
      expect(packet.partial).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    expect(packet.assertions[0]?.target.path).toBe('B.md');
    expect(scans).not.toHaveBeenCalled();
  } finally { await client.close(); await server.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
}, 30000);
