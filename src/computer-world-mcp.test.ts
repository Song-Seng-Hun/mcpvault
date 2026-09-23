import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer, getServerRuntime } from '../tests/server-fixture.js';
import { startMcpHttpApi } from './mcp-http.js';
import { operationReadAlias } from './operation-contracts.js';
import { hostFeatureForTool } from './host-features.js';

test('computer world discovery, authenticated MCP writes and read-only replay use the existing world feature', async () => {
  const root = await mkdtemp(join(tmpdir(), 'computer-mcp-'));
  const cleanup: Array<() => Promise<unknown>> = [() => rm(root, { recursive: true, force: true })];
  try {
    const server = createServer(root); cleanup.push(() => server.close());
    const api = await startMcpHttpApi(server, { port: 0 }); cleanup.push(() => api.close());
    const client = new Client({ name: 'computer-world-test', version: '1' }); cleanup.push(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}${api.path}`)));
    const call = async (endpointId: string, args: Record<string, unknown>, c = client) => {
      const result = await c.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
      const text = (result.content as any[])[0].text;
      return { error: result.isError, value: result.isError ? text : JSON.parse(text) };
    };
    expect((await client.listTools()).tools).toHaveLength(16);
    expect(hostFeatureForTool('manage_roleplay_computer')).toBe('roleplay');
    expect(operationReadAlias('manage_roleplay_computer', 'context')).toBe('read_roleplay_computer');
    expect(operationReadAlias('manage_roleplay_computer', 'bind')).toBeUndefined();
    const discovery = await client.callTool({ name: 'search_capabilities', arguments: { query: '컴퓨터 세계관 등록', limit: 3, maxChars: 4000 } });
    expect(JSON.stringify(discovery)).toContain('roleplay.computer');
    expect((await call('roleplay.computer', { op: 'list' })).error).toBe(true);
    const registered = await call('auth.register', { accountId: 'alice', agentId: 'alice', modelId: 'codex', password: 'synthetic-computer-world-password' });
    expect(registered.error).not.toBe(true);
    const accessToken = registered.value.accessToken;
    const args = { op: 'register', worldId: 'home-pc', title: 'Home PC (집 PC)', facts: [], requestId: 'register-home', expectedRevision: 'missing', accessToken };
    const saved = await call('roleplay.computer', args);
    expect(saved.error, String(saved.value)).not.toBe(true);
    const before = (await call('roleplay.world', { op: 'read' })).value;
    expect((await call('roleplay.computer', { op: 'list', accessToken })).value.items[0].worldId).toBe('home-pc');
    expect((await call('roleplay.world', { op: 'read' })).value).toEqual(before);
    const readonly = createServer(root, { readOnly: true }); cleanup.push(() => readonly.close());
    const readApi = await startMcpHttpApi(readonly, { port: 0 }); cleanup.push(() => readApi.close());
    const readClient = new Client({ name: 'computer-readonly', version: '1' }); cleanup.push(() => readClient.close());
    await readClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${readApi.port}${readApi.path}`)));
    const login = await call('auth.login', { accountId: 'alice', password: 'synthetic-computer-world-password' }, readClient);
    expect(login.error, String(login.value)).not.toBe(true);
    const readResult = await call('roleplay.computer', { op: 'read', worldId: 'home-pc', accessToken: login.value.accessToken }, readClient);
    expect(readResult.error, String(readResult.value)).not.toBe(true);
    const blocked = await call('roleplay.computer', { ...args, accessToken: login.value.accessToken }, readClient);
    expect(blocked.error).toBe(true); expect(String(blocked.value)).toMatch(/read.only/i);
    const registry = getServerRuntime(server)!.endpointRegistry;
    const context = { readOnly: false, authenticated: true, capabilities: new Set<any>(['write']), roleplayConfigured: false,
      roleplayWritesConfigured: false, ownerActivity: { policyFingerprint: 'test', executionBindingGeneration: 'test', eligibility: {} } };
    expect(registry.list('roleplay.computer', 1, 20000, context, false).endpoints[0]!.available).toBe(false);
    const visible = registry.list('roleplay.computer', 1, 20000, { ...context, readOnly: true,
      ownerActivity: { ...context.ownerActivity, eligibility: { roleplay: { discover: true, read: true, claim: true, execute: true } } } }, false).endpoints[0]!;
    expect(visible.operations!.read!.available).toBe(true);
    expect(visible.operations!.register!.available).toBe(false);
  } finally { for (const close of cleanup.reverse()) await close(); }
}, 30000);
