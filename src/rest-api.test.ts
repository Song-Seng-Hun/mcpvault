import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from './createServer.js';
import { startRestApi, type RestApiHandle } from './rest-api.js';

const resources: Array<{ vault: string; api: RestApiHandle; server: any }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.api.close();
    await resource.server.close();
    await rm(resource.vault, { recursive: true, force: true });
  }
});
test('REST adapter uses the same dynamic endpoint registry and dispatcher', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-rest-'));
  const server = createServer(vault);
  const api = await startRestApi(server, { port: 0 });
  resources.push({ vault, api, server });

  const capabilities = await fetch(`http://127.0.0.1:${api.port}/api/capabilities?limit=100`);
  expect(capabilities.status).toBe(200);
  const catalog = await capabilities.json() as any;
  expect(catalog.endpoints.some((endpoint: any) => endpoint.endpointId === 'notes.write')).toBe(true);

  const write = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/notes.write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'nested/rest.md', content: '# REST' }),
  });
  expect(write.status).toBe(200);
  expect((await write.json()).message).toContain('Successfully wrote note');
  expect(await readFile(join(vault, 'nested', 'rest.md'), 'utf8')).toContain('# REST');

  const routeWrite = await fetch(`http://127.0.0.1:${api.port}/api/notes/nested/route.md`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '# Route' }),
  });
  expect(routeWrite.status).toBe(200);
  expect(await readFile(join(vault, 'nested', 'route.md'), 'utf8')).toContain('# Route');
});
