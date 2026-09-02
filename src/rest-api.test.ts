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

  const rejectedOrigin = await fetch(`http://127.0.0.1:${api.port}/healthz`, { headers: { origin: 'https://untrusted.example' } });
  expect(rejectedOrigin.status).toBe(403);

  const capabilities = await fetch(`http://127.0.0.1:${api.port}/api/capabilities?limit=100&maxChars=20000`);
  expect(capabilities.status).toBe(200);
  const catalog = await capabilities.json() as any;
  expect(catalog.endpoints.some((endpoint: any) => endpoint.endpointId === 'notes.write')).toBe(true);
  const etag = capabilities.headers.get('etag');
  expect(etag).toBeTruthy();
  expect(capabilities.headers.get('cache-control')).toContain('private');
  const unchanged = await fetch(`http://127.0.0.1:${api.port}/api/capabilities?limit=100&maxChars=20000`, {
    headers: { 'if-none-match': etag! },
  });
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe('');
  // The full catalog is itself bounded, so newly added endpoints may be past
  // the response budget. Probe the generic executor to verify both are
  // registered without asking it to perform a real read.
  const contextProbe = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/context.read`);
  expect(contextProbe.status).toBe(400);
  const continuityProbe = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/continuity.resume`);
  expect(continuityProbe.status).toBe(400);

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

test('REST adapter rate-limits anonymous account registration per client address', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-rest-registration-'));
  const server = createServer(vault);
  const api = await startRestApi(server, { port: 0 });
  resources.push({ vault, api, server });

  const statuses: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await fetch(`http://127.0.0.1:${api.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: `registration-${index}`, modelId: `model-${index}`, agentId: `agent-${index}`, password: `registration-password-${index}` }),
    });
    statuses.push(response.status);
  }
  expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  expect(statuses[5]).toBe(429);
});
