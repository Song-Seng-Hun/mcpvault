import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalSyncHub, GlobalSyncReadClient, startGlobalSyncHub } from './global-sync.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
test('Global document synchronization excludes the separate public conversation store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-global-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const hub = new GlobalSyncHub(root);
  await expect(hub.submitProposal({ documentId: 'PublicCommunity/Local/Draft.md', content: 'private draft', author: 'a', reason: 'bad export', origin: 'server-a' })).rejects.toThrow(/service|Global/);
});
test('company importer credential reads approved Global data but cannot list proposals or publish', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-global-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const handle = await startGlobalSyncHub(root, { authToken: 'publisher-secret', reviewerToken: 'reviewer-secret', readToken: 'company-reader-secret' }); cleanup.push(() => handle.close());
  const baseUrl = `http://127.0.0.1:${handle.port}`;
  const client = new GlobalSyncReadClient({ baseUrl, readToken: 'company-reader-secret' });
  expect((await client.getManifest()).entries).toEqual([]);
  for (const [method, path] of [['GET', 'proposals'], ['POST', 'proposals']] as const) {
    const response = await fetch(`${baseUrl}/v1/global/${path}`, { method, headers: { authorization: 'Bearer company-reader-secret', 'content-type': 'application/json' }, ...(method === 'POST' && { body: '{}' }) });
    expect(response.status).toBe(401);
  }
});
