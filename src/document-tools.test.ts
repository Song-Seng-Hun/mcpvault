import { afterEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer, getServerRuntime } from './createServer.js';
import { startRestApi } from './rest-api.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
test('five fixed MCP tools expose shared bounded read-only document endpoints and REST parity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-mcp-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'note.md'), '# Topic\n\n한 줄 답변.');
  const server = createServer(root, { readOnly: true }); cleanup.push(() => server.close());
  const client = new Client({ name: 'document-test', version: '1' }); cleanup.push(() => client.close());
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s); await client.connect(c);
  expect((await client.listTools()).tools).toHaveLength(5);
  const registry = getServerRuntime(server)!.endpointRegistry;
  for (const id of ['documents.outline', 'documents.read', 'documents.search', 'resources.manifest', 'resources.export']) {
    const endpoint = registry.resolve(id);
    expect(endpoint, id).toBeDefined(); expect(endpoint!.mutating).toBe(false);
    expect(endpoint!.url).toBe(`/api/endpoint/${id}`);
    expect(endpoint!.input.additionalProperties).toBe(false);
    expect((endpoint!.input.properties as any).principal).toBeUndefined();
  }
  const args = { path: 'note.md', startLine: 3, endLine: 3, mode: 'exact', maxChars: 1500 };
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'documents.read', arguments: args } });
  expect(result.isError).not.toBe(true);
  const text = (result.content as any[])[0].text, value = JSON.parse(text);
  expect(text.length).toBeLessThanOrEqual(1500); expect(value.parts[0].text).toBe('한 줄 답변.');
  const api = await startRestApi(server, { port: 0 }); cleanup.push(() => api.close());
  const response = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/documents.read?path=note.md&startLine=3&endLine=3&mode=exact&maxChars=1500`);
  expect(response.status).toBe(200); expect(await response.json()).toEqual(value);
  const ranges = [{ startLine: 1, mode: 'exact' }, { startLine: 3, mode: 'exact' }];
  const batch = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/documents.read?path=note.md&ranges=${encodeURIComponent(JSON.stringify(ranges))}`);
  expect(batch.status).toBe(200);
  expect((await batch.json() as any).parts.map((p: any) => p.text)).toEqual(['# Topic', '한 줄 답변.']);
  const denied = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'resources.export', arguments: { path: '../outside' } } });
  expect(denied.isError).toBe(true);
});
test('ordinary authenticated sessions receive receipts that cannot cross logins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-session-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'note.md'), 'hello');
  const server = createServer(root); cleanup.push(() => server.close());
  const runtime = getServerRuntime(server)!;
  const call = async (endpointId: string, args: Record<string, unknown>) => {
    const result = await runtime.dispatchTool('call_endpoint', { endpointId, arguments: args });
    return { error: result.isError, value: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
  };
  const registered = await call('auth.register', { accountId: 'document-test', modelId: 'test-model', password: 'disposable-document-password' });
  expect(registered.error).not.toBe(true);
  const accessToken = registered.value.accessToken;
  const first = await call('documents.read', { path: 'note.md', mode: 'exact', accessToken });
  expect(first.value.parts[0].receipt).toBeTruthy();
  const knownReads = [first.value.parts[0].receipt];
  expect((await call('documents.read', { path: 'note.md', mode: 'exact', knownReads, accessToken })).value.parts).toEqual([]);
  const second = await call('auth.login', { accountId: 'document-test', password: 'disposable-document-password' });
  expect(second.error).not.toBe(true);
  expect((await call('documents.read', { path: 'note.md', mode: 'exact', knownReads, accessToken: second.value.accessToken })).error).toBe(true);
  await mkdir(join(root, '_scopes/models/test-model'), { recursive: true });
  await writeFile(join(root, '_scopes/models/test-model/private.md'), 'private needle');
  const api = await startRestApi(server, { port: 0 }); cleanup.push(() => api.close());
  for (const endpoint of ['documents.outline', 'documents.read', 'documents.search', 'resources.manifest', 'resources.export']) {
    const result = await call(endpoint, { path: 'scope://model/test-model/private.md', ...(endpoint === 'documents.search' && { query: 'needle' }), accessToken });
    expect(result.error, endpoint + ': ' + JSON.stringify(result.value)).not.toBe(true);
    expect(JSON.stringify(result.value)).not.toContain('_scopes/');
    const response = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/${endpoint}?path=${encodeURIComponent('scope://model/test-model/private.md')}${endpoint === 'documents.search' ? '&query=needle' : ''}`, { headers: { authorization: `Bearer ${accessToken}` } });
    expect(response.status, endpoint).toBe(200);
  }
  const duplicate = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/documents.read?path=note.md&mode=exact&knownReads=${encodeURIComponent(JSON.stringify(knownReads))}`, { headers: { authorization: `Bearer ${accessToken}` } });
  expect(duplicate.status).toBe(200); expect((await duplicate.json() as any).parts).toEqual([]);
});
