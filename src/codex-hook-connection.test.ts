import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import type { CodexHookResult } from './codex-hook-service.js';

let vault: string, server: ReturnType<typeof createServer>, client: Client;
afterEach(async () => { try { await client?.close(); } finally { try { await server?.close(); } finally { if (vault) await rm(vault, { recursive: true, force: true }); } } });
test.each(['no_host', 'no_attestation', 'read_only'])('does not bind a lifecycle listener for %s', async mode => {
  vault = await mkdtemp(join(tmpdir(), 'hook-connection-'));
  const bind = vi.fn(() => () => {});
  server = createServer(vault, { readOnly: mode === 'read_only', codexHooks: { bind,
    ...(mode !== 'no_host' && { host: {} }), ...(mode !== 'no_attestation' && { attest: async () => undefined }) } } as any);
  expect(bind).not.toHaveBeenCalled();
});
test('host connection reuses actual continuity service, keeps five MCP tools and unbinds at shutdown', async () => {
  vault = await mkdtemp(join(tmpdir(), 'hook-connection-'));
  await mkdir(join(vault, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(vault, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules: []\n---\n');
  const hash = 'a'.repeat(64), path = '_scopes/agents/worker/_continuity/work-state.md';
  let deliver: ((payload: string) => Promise<CodexHookResult>) | undefined, history: unknown;
  const unbind = vi.fn();
  server = createServer(vault, { codexHooks: {
    host: { refresh: async () => ({ version: 1, enabled: true, accountId: 'operator', projects: [{ id: 'p', workspace: 'E:/dev/wiki',
      definitionHash: hash, paths: [path], events: ['SessionStart'], actions: ['resume'] }] }),
      readState: async () => structuredClone(history), writeState: async (value: unknown) => { history = structuredClone(value); },
      acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }) },
    attest: async () => ({ projectId: 'p', accountId: 'operator', workspace: 'E:/dev/wiki', definitionHash: hash,
      sessionId: 's', event: 'SessionStart', causeId: 'cause', authorityRevision: hash, inputRevision: hash, mode: 'default', verified: true,
      expiresAt: Date.now() + 60000, hostBusy: false, quotaAvailable: true, paths: [path], work: { action: 'resume' } }),
    bind: (handler: typeof deliver) => { deliver = handler; return unbind; },
  } } as any);
  client = new Client({ name: 'hook-connection', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  expect((await client.listTools()).tools).toHaveLength(5);
  const registration = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
    accountId: 'operator', modelId: 'codex', agentId: 'worker', userId: 'fixture', password: randomUUID(),
  } } });
  expect(registration.isError).toBeFalsy(); expect(deliver).toBeTypeOf('function');
  const result = await deliver!(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', transcript_path: 'NEVER_READ' }));
  expect(result).toMatchObject({ status: 'processed', context: { packet: { exists: false } } });
  await server.close(); expect(unbind).toHaveBeenCalledTimes(1);
});
