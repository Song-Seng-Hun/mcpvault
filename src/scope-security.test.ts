import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { ScopeAuthService } from './scope-auth.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-scope-security-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

async function connect() {
  const server = createServer(vault, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scope-security-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { server, client };
}

async function json(client: Client, name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: arguments_ });
  return { result, value: JSON.parse((result.content as any)[0].text) };
}

test('anonymous and authenticated searches never expose another model scope', async () => {
  const { server, client } = await connect();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'alpha-owner', modelId: 'alpha', password: 'alpha-model-password' } });
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'beta-owner', modelId: 'beta', password: 'beta-model-password' } });
    const alphaToken = (await json(client, 'login_scope', { accountId: 'alpha-owner', password: 'alpha-model-password' })).value.accessToken;
    const betaToken = (await json(client, 'login_scope', { accountId: 'beta-owner', password: 'beta-model-password' })).value.accessToken;

    await client.callTool({ name: 'write_note', arguments: { path: 'Public.md', content: '# shared needle', accessToken: alphaToken } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'scope://model/alpha/Private.md', content: '# alpha-secret-needle\n\n- [ ] alpha task\n\n#alpha_private_tag', accessToken: alphaToken,
    } });
    await client.callTool({ name: 'write_note', arguments: {
      path: 'scope://model/beta/Private.md', content: '# beta-secret-needle\n\n- [ ] beta task\n\n#beta_private_tag', accessToken: betaToken,
    } });

    const anonymous = await json(client, 'search_notes', { query: 'secret-needle' });
    expect(anonymous.value).toEqual([]);
    const alphaSearch = await json(client, 'search_notes', { query: 'secret-needle', accessToken: alphaToken });
    expect(alphaSearch.value.some((item: any) => item.ex.includes('alpha-secret'))).toBe(true);
    expect(alphaSearch.value.some((item: any) => item.ex.includes('beta-secret'))).toBe(false);

    const otherRead = await client.callTool({ name: 'read_note', arguments: { path: 'scope://model/beta/Private.md', accessToken: alphaToken } });
    expect(otherRead.isError).toBe(true);
    const directBypass = await client.callTool({ name: 'read_note', arguments: { path: '_scopes/models/alpha/Private.md', accessToken: alphaToken } });
    expect(directBypass.isError).toBe(true);

    const root = await json(client, 'list_directory', {});
    expect(root.value.dirs).not.toContain('_scopes');
    const ownDirectory = await json(client, 'list_directory', { path: 'scope://model/alpha/', accessToken: alphaToken });
    expect(ownDirectory.value.files).toContain('Private.md');

    const alphaTags = await json(client, 'list_all_tags', { accessToken: alphaToken });
    expect(alphaTags.value.some((item: any) => item.tag === 'alpha_private_tag')).toBe(true);
    expect(alphaTags.value.some((item: any) => item.tag === 'beta_private_tag')).toBe(false);
    const alphaTasks = await json(client, 'list_tasks', { status: 'all', accessToken: alphaToken });
    expect(alphaTasks.value.tasks.some((item: any) => item.text === 'alpha task')).toBe(true);
    expect(alphaTasks.value.tasks.some((item: any) => item.text === 'beta task')).toBe(false);
    const alphaQuery = await json(client, 'query_notes', { includeContent: true, accessToken: alphaToken });
    expect(alphaQuery.value.notes.some((item: any) => item.content?.includes('beta-secret'))).toBe(false);
  } finally {
    await client.close();
    await server.close();
  }
});

test('stdio registration has persistent account and family quotas', async () => {
  const authDirectory = join(vault, '.mcpvault');
  await mkdir(authDirectory, { recursive: true });
  const account = (accountId: string, userId: string) => ({
    accountId,
    modelId: accountId,
    userId,
    role: 'agent',
    salt: 'c2FsdA==',
    passwordHash: 'aGFzaA==',
    createdAt: new Date(0).toISOString(),
  });

  await writeFile(join(authDirectory, 'scope-auth.json'), JSON.stringify({
    version: 1,
    accounts: Array.from({ length: 512 }, (_, index) => account(`family-agent-${index}`, 'same-family')),
  }));
  const familyLimited = new ScopeAuthService(vault);
  await expect(familyLimited.register({
    accountId: 'family-overflow', modelId: 'new-model', agentId: 'new-agent', userId: 'same-family', password: 'family-overflow-password',
  })).rejects.toThrow('family account capacity');

  await writeFile(join(authDirectory, 'scope-auth.json'), JSON.stringify({
    version: 1,
    accounts: Array.from({ length: 4_096 }, (_, index) => account(`account-${index}`, `family-${index}`)),
  }));
  const globallyLimited = new ScopeAuthService(vault);
  await expect(globallyLimited.register({
    accountId: 'global-overflow', modelId: 'new-model', password: 'global-overflow-password',
  })).rejects.toThrow('Account capacity');
});

test('model accounts provision agent accounts and account hashes survive a server restart', async () => {
  const first = await connect();
  let modelToken: string;
  try {
    await first.client.callTool({ name: 'register_scope_account', arguments: { accountId: 'codex-owner', modelId: 'codex', password: 'codex-owner-password' } });
    modelToken = (await json(first.client, 'login_scope', { accountId: 'codex-owner', password: 'codex-owner-password' })).value.accessToken;
    await first.client.callTool({ name: 'create_agent_scope', arguments: { agentId: 'researcher', modelId: 'codex', sessionId: 's1', accessToken: modelToken } });
    const registered = await first.client.callTool({ name: 'register_scope_account', arguments: {
      accountId: 'researcher-login', modelId: 'codex', agentId: 'researcher', password: 'researcher-password', accessToken: modelToken,
    } });
    expect(registered.isError).toBeFalsy();
  } finally {
    await first.client.close();
    await first.server.close();
  }

  const second = await connect();
  try {
    const staleSession = await second.client.callTool({ name: 'whoami_scope', arguments: { accessToken: modelToken! } });
    expect(staleSession.isError).toBe(true);
    const agentLogin = await json(second.client, 'login_scope', { accountId: 'researcher-login', password: 'researcher-password' });
    const agentToken = agentLogin.value.accessToken;
    const write = await second.client.callTool({ name: 'write_note', arguments: {
      path: 'scope://agent/researcher/Memory.md', content: 'private agent continuity', accessToken: agentToken,
    } });
    expect(write.isError).toBeFalsy();

    const modelLogin = await json(second.client, 'login_scope', { accountId: 'codex-owner', password: 'codex-owner-password' });
    const modelRead = await second.client.callTool({ name: 'read_note', arguments: {
      path: 'scope://agent/researcher/Memory.md', accessToken: modelLogin.value.accessToken,
    } });
    expect(modelRead.isError).toBe(true);
  } finally {
    await second.client.close();
    await second.server.close();
  }
});

test('scope login throttles repeated password guessing without revealing accounts', async () => {
  const { server, client } = await connect();
  try {
    await client.callTool({ name: 'register_scope_account', arguments: { accountId: 'secure-owner', modelId: 'secure', password: 'correct-model-password' } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await client.callTool({ name: 'login_scope', arguments: { accountId: 'secure-owner', password: 'incorrect-password' } });
      expect(rejected.isError).toBe(true);
      expect((rejected.content as any)[0].text).toContain('Invalid account or password');
    }
    const blocked = await client.callTool({ name: 'login_scope', arguments: { accountId: 'secure-owner', password: 'correct-model-password' } });
    expect(blocked.isError).toBe(true);
    expect((blocked.content as any)[0].text).toContain('Too many failed login attempts');
  } finally {
    await client.close();
    await server.close();
  }
});
