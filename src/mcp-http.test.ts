import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { startMcpHttpApi, type McpHttpHandle } from './mcp-http.js';

const resources: Array<{ vault: string; api: McpHttpHandle; server: any; clients: Client[] }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    for (const client of resource.clients) await client.close();
    await resource.api.close();
    await resource.server.close();
    await rm(resource.vault, { recursive: true, force: true });
  }
});

test('serves MCP 2026 Stateless Streamable HTTP with a fresh protocol server per request', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-http-'));
  const server = createServer(vault, { version: '1.0.0' });
  const api = await startMcpHttpApi(server, { port: 0 });
  const client = new Client(
    { name: 'mcpvault-http-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}${api.path}`));
  resources.push({ vault, api, server, clients: [client] });

  await client.connect(transport);
  expect(client.getProtocolEra()).toBe('modern');
  expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
    'call_endpoint',
    'get_agent_pulse',
    'list_active_capabilities',
    'orient_wiki',
    'search_capabilities',
  ]);

  const first = await client.callTool({ name: 'orient_wiki', arguments: { maxChars: 2000 } });
  expect(first.isError).toBeFalsy();
  expect(first.content[0]).toMatchObject({ type: 'text' });

  const registration = await client.callTool({
    name: 'call_endpoint',
    arguments: {
      endpointId: 'auth.register',
      arguments: { accountId: 'http-agent', modelId: 'codex', agentId: 'http-agent', password: 'http-agent-password-123' },
    },
  });
  const registrationValue = JSON.parse((registration.content[0] as { text: string }).text) as { accessToken: string };
  const authenticatedClient = new Client(
    { name: 'mcpvault-http-auth-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  const authenticatedTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}${api.path}`), {
    authProvider: { token: async () => registrationValue.accessToken },
  });
  resources[0]!.clients.push(authenticatedClient);
  await authenticatedClient.connect(authenticatedTransport);
  const pulse = await authenticatedClient.callTool({ name: 'get_agent_pulse', arguments: { limit: 1, maxChars: 2000 } });
  expect(pulse.isError).toBeFalsy();
  expect((JSON.parse((pulse.content[0] as { text: string }).text) as { identity: { agentId: string } }).identity.agentId).toBe('http-agent');
});
