import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createServer } from './createServer.js';
import { Auth0Resource, parseAuth0ResourceConfig } from './auth0-resource.js';
import { getServerRuntime } from './createServer.js';
import { startMcpHttpApi, type McpHttpHandle } from './mcp-http.js';

const resources: Array<{ vault: string; api: McpHttpHandle; server: ReturnType<typeof createServer>; client?: Client }> = [];
afterEach(async () => {
  for (const item of resources.splice(0)) {
    await item.client?.close();
    await item.api.close();
    await item.server.close();
    await rm(item.vault, { recursive: true, force: true });
  }
});

async function fixture(withLocal = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-auth0-http-'));
  await mkdir(join(vault, '_scopes', 'users', 'research-agent'), { recursive: true });
  await writeFile(join(vault, '_scopes', 'users', 'research-agent', 'Secret.md'), 'USER_SCOPE_SECRET_FOR_TEST');
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  const config = parseAuth0ResourceConfig({
    version: 1, issuer: 'https://research.us.auth0.com/', resource: 'https://research.example.com/mcp',
    scope: 'mcpvault:research', subject: 'auth0|researcher', accountId: 'research-agent',
    allowedAgentLabels: ['codex-mac', 'antigravity-claude-sonnet'],
    ...(withLocal && { localResource: {
      resource: 'http://127.0.0.1:8789/antigravity/mcp', clientId: 'antigravity-public-client-id',
    } }),
  });
  const auth0 = new Auth0Resource(config, createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }));
  const server = createServer(vault, { version: '1.0.0',
    features: { version: 1, selected: ['wiki-core'] }, ownerActivity: auth0.ownerActivity(),
  });
  const runtime = getServerRuntime(server)!;
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'research-agent', agentId: 'research-agent', modelId: 'codex', password: 'test-only-password-1234',
  });
  expect(registration.isError).toBeFalsy();
  const token = async (claims: Record<string, unknown> = {}) => new SignJWT({
    iss: config.issuer, aud: config.resource, sub: config.subject, scope: config.scope,
    exp: Math.floor(Date.now() / 1000) + 300, ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(pair.privateKey);
  const api = await startMcpHttpApi(server, { port: 0, auth0 });
  const item: (typeof resources)[number] = { vault, api, server };
  resources.push(item);
  const base = `http://127.0.0.1:${api.port}`;
  return { base, api, auth0, token, runtime, item };
}

test('serves resource metadata and challenges anonymous MCP before dispatch', async () => {
  const { base, api, auth0 } = await fixture();
  const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
  expect(metadata.status).toBe(200);
  expect(await metadata.json()).toEqual(auth0.metadata());
  const pathMetadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  expect(pathMetadata.status).toBe(200);
  expect(await pathMetadata.json()).toEqual(auth0.metadata());
  const response = await fetch(`${base}${api.path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toContain('resource_metadata="https://research.example.com/.well-known/oauth-protected-resource/mcp"');
});

test('gives a loopback metadata URL to an empty POST discovery probe', async () => {
  const { base, api, auth0 } = await fixture();
  const response = await fetch(`${base}${api.path}`, {
    method: 'POST', headers: { accept: 'application/json', 'user-agent': 'oai-tunnel-client/test' },
  });
  expect(response.status).toBe(401);
  const localMetadataUrl = `${base}/.well-known/oauth-protected-resource/mcp`;
  expect(response.headers.get('www-authenticate')).toContain(`resource_metadata="${localMetadataUrl}"`);
  const metadata = await fetch(localMetadataUrl);
  expect(metadata.status).toBe(200);
  expect(await metadata.json()).toEqual(auth0.metadata());
});

test('local Antigravity path discovers its own resource and rejects cross-audience tokens', async () => {
  const { base, api, auth0, token, item } = await fixture(true);
  const localPath = '/antigravity/mcp';
  const metadataUrl = `${base}/.well-known/oauth-protected-resource${localPath}`;
  const metadata = await fetch(metadataUrl);
  expect(metadata.status).toBe(200);
  expect(await metadata.json()).toEqual(auth0.metadata('local'));
  const anonymous = await fetch(`${base}${localPath}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get('www-authenticate')).toContain(`resource_metadata="${metadataUrl}"`);
  const localToken = await token({ aud: auth0.config.localResource!.resource, azp: auth0.config.localResource!.clientId });
  const client = new Client({ name: 'antigravity-local-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  item.client = client;
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${localPath}`), { authProvider: { token: async () => localToken } }));
  const identity = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.whoami', agentLabel: 'antigravity-claude-sonnet' } });
  expect(identity.isError).toBeFalsy();
  expect(JSON.stringify(identity)).toContain('research-agent');
  const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const headers = { 'content-type': 'application/json' };
  expect((await fetch(`${base}${api.path}`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${localToken}` }, body })).status).toBe(401);
  expect((await fetch(`${base}${localPath}`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${await token()}` }, body })).status).toBe(401);
});

test('does not expose the unauthenticated evolution review route on the OAuth listener', async () => {
  const { base, runtime } = await fixture();
  let called = false;
  runtime.evolutionReview = { handle: async (_request, response) => { called = true; response.end('unsafe'); } } as typeof runtime.evolutionReview;
  const response = await fetch(`${base}/evolution/review`);
  expect(response.status).toBe(404);
  expect(called).toBe(false);
});

test('accepts a valid JWT, denies forged authority and never returns either token', async () => {
  const { base, api, token, item } = await fixture();
  const jwt = await token();
  const client = new Client({ name: 'auth0-research-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  item.client = client;
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${api.path}`), { authProvider: { token: async () => jwt } }));
  const identity = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.whoami', agentLabel: 'codex-mac' } });
  expect(identity.isError).toBeFalsy();
  expect(JSON.parse((identity.content[0] as { text: string }).text)).toMatchObject({ accountId: 'research-agent', reportedAgentLabel: 'codex-mac' });
  expect(JSON.stringify(identity)).not.toContain(jwt);
  expect(JSON.stringify(identity)).not.toContain('accessToken');
  const orientation = await client.callTool({ name: 'orient_wiki', arguments: {} });
  expect(orientation.isError).toBeFalsy();
  const pulse = await client.callTool({ name: 'get_agent_pulse', arguments: { limit: 3, maxChars: 3000 } });
  expect(pulse.isError).toBeFalsy();
  expect(JSON.parse((pulse.content[0] as { text: string }).text)).toMatchObject({
    identity: expect.objectContaining({ accountId: 'research-agent' }),
    coverage: expect.objectContaining({ work: { state: 'skipped' }, tasks: { state: 'skipped' } }),
  });
  const userScope = await client.callTool({ name: 'call_endpoint', arguments: {
    endpointId: 'notes.read', arguments: { path: 'scope://user/research-agent/Secret.md' },
  } });
  expect(userScope.isError).toBe(true);
  expect(JSON.stringify(userScope)).not.toContain('USER_SCOPE_SECRET_FOR_TEST');

  const body = (endpointId: string, args: Record<string, unknown> = {}) => JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'call_endpoint', arguments: { endpointId, arguments: args } },
  });
  const headers = { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
  const conflict = await fetch(`${base}${api.path}`, { method: 'POST', headers, body: body('auth.whoami', { accessToken: 'attacker' }) });
  expect(conflict.status).toBe(403);
  const legacy = await fetch(`${base}${api.path}`, { method: 'POST', headers, body: body('auth.login', { accountId: 'research-agent', password: 'ignored' }) });
  expect(legacy.status).toBe(403);
  for (const endpointId of ['mcp.create_agent_scope', 'mcp.handoff_agent_scope', 'mcp.resume_agent_scope', 'mcp.update_agent_capabilities']) {
    const identityMutation = await fetch(`${base}${api.path}`, { method: 'POST', headers, body: body(endpointId, { agentId: 'research-agent' }) });
    expect(identityMutation.status).toBe(403);
  }
  const wrongSubject = await fetch(`${base}${api.path}`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${await token({ sub: 'auth0|other' })}` }, body: body('auth.whoami') });
  expect(wrongSubject.status).toBe(401);
  for (const claims of [
    { scope: 'openid profile' },
    { aud: 'https://other.example.com/mcp' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
  ]) {
    const denied = await fetch(`${base}${api.path}`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${await token(claims)}` }, body: body('auth.whoami') });
    expect(denied.status).toBe(401);
  }
  const invalidLabel = await fetch(`${base}${api.path}`, { method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'call_endpoint', arguments: { endpointId: 'auth.whoami', agentLabel: 'unapproved' } },
  }) });
  expect(invalidLabel.status).toBe(403);
  const malformed = await fetch(`${base}${api.path}`, { method: 'POST', headers, body: 'SECRET_MARKER_FOR_TEST' });
  expect(malformed.status).toBeGreaterThanOrEqual(400);
  expect(await malformed.text()).not.toContain('SECRET_MARKER_FOR_TEST');
});

test('OAuth bearer reaches direct recording tools without exposing credentials or User storage', async () => {
  const { base, api, token, item } = await fixture();
  const jwt = await token();
  const client = new Client({ name: 'auth0-record-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  item.client = client;
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${api.path}`), { authProvider: { token: async () => jwt } }));
  const listed = await client.listTools();
  expect(listed.tools.map(tool => tool.name)).toContain('create_note');
  const created = await client.callTool({ name: 'create_note', arguments: {
    path: 'Research/OAuth.md', content: '# Authenticated research', frontmatter: { note_kind: 'experiment' }, agentLabel: 'codex-mac',
  } });
  expect(created.isError).toBeFalsy();
  expect(JSON.stringify(created)).not.toContain(jwt);
  expect(JSON.stringify(created)).not.toContain('accessToken');
  const read = await client.callTool({ name: 'read_note', arguments: { path: 'Research/OAuth.md' } });
  expect(read.isError).toBeFalsy();
  expect(JSON.stringify(read)).toContain('Authenticated research');
  const denied = await client.callTool({ name: 'create_note', arguments: {
    path: 'scope://user/research-agent/Denied.md', content: 'Do not write User storage',
  } });
  expect(denied.isError).toBe(true);
  const audit = await readFile(join(item.vault, '.mcpvault', 'audit.ndjson'), 'utf8');
  expect(audit).toContain('"reportedAgentLabel":"codex-mac"');
  expect(audit).not.toContain(jwt);
});
