import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from '../tests/server-fixture.js';
import { EnterpriseRegistry } from './enterprise-registry.js';
import { withEnterpriseRequestContext } from './enterprise-request-context.js';
import { FileSystemService } from './filesystem.js';
const disposers: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of disposers.splice(0).reverse()) await close(); });
const cert = 'a'.repeat(64);
async function setup(mode: 'company' | 'public' = 'company') {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-protocol-')); disposers.push(() => rm(root, { recursive: true, force: true }));
  const vaultPath = join(root, 'vault'); await mkdir(vaultPath);
  const registryPath = join(root, 'private/policy.json'); const registry = new EnterpriseRegistry({ registryPath, vaultPath });
  await registry.initialize({ mode, realmId: 'acme', vaultPath });
  await registry.createEmployee({ userId: 'u-one', sharedMemoryEnabled: true });
  await registry.registerRuntime({ runtimeId: 'r-one', kind: mode === 'company' ? 'internal' : 'external', certFingerprint: cert });
  const secretFile = join(root, 'private/invite.txt');
  await registry.createInvite({ binding: { accountId: 'a-one', agentId: 'network', userId: 'u-one', modelId: 'codex', runtimeId: 'r-one' }, expiresAt: new Date(Date.now() + 60000).toISOString(), secretFile });
  const server = createServer(vaultPath, { enterpriseRegistryPath: registryPath }); disposers.push(() => server.close());
  const runtime = getServerRuntime(server)!;
  async function call(endpointId: string, args: Record<string, unknown> = {}, trusted = true) {
    const run = () => endpointId === 'get_agent_pulse' ? runtime.dispatchTool(endpointId, args) : runtime.dispatchTool('call_endpoint', { endpointId, arguments: args });
    const result = await (trusted ? withEnterpriseRequestContext({ transport: 'http', certFingerprint: cert }, run) : run());
    const text = result.content[0].text;
    return { result, text, value: result.isError ? undefined : JSON.parse(text) };
  }
  const registration = await call('auth.register', { accountId: 'a-one', agentId: 'network', userId: 'u-one', modelId: 'codex', password: 'enterprise-test-password', invitationToken: (await readFile(secretFile, 'utf8')).trim(), sessionId: 's-one' });
  expect(registration.result.isError, registration.text).not.toBe(true);
  return { call, token: registration.value.accessToken, fs: new FileSystemService(vaultPath), registry, root };
}

test('five-tool dispatcher enforces enterprise identity for notes, memory, metadata and non-HTTP callers', async () => {
  const { call, token, fs } = await setup();
  await fs.writeNote({ path: 'Public.md', content: 'public record' });
  await fs.writeNote({ path: '_scopes/users/another/SharedMemory/Private.md', content: 'hidden-user-needle' });
  expect((await call('notes.read', { path: 'Public.md' })).result.isError).toBe(true);
  expect((await call('notes.read', { path: 'Public.md', accessToken: token }, false)).result.isError).toBe(true);
  expect((await call('notes.read', { path: 'Public.md', accessToken: token })).text).toContain('public record');
  expect((await call('notes.read', { path: 'scope://user/another/SharedMemory/Private.md', accessToken: token })).result.isError).toBe(true);
  const written = await call('notes.write', { path: 'scope://user/u-one/SharedMemory/Preference.md', content: 'short Korean answers', frontmatter: { memory_role: 'core' }, accessToken: token });
  expect(written.result.isError, written.text).not.toBe(true);
  const memory = await call('memory.brief', { scope: 'user', semantic: false, accessToken: token });
  expect(memory.result.isError, memory.text).not.toBe(true);
  expect(memory.text).toContain('short Korean answers');
  expect(memory.text).not.toContain('hidden-user-needle');
  expect((await call('notes.write', { path: 'Global.md', content: 'company data', accessToken: token })).result.isError).toBe(true);
});

test('two employees with three Codex agents each keep exact authors and isolated agent memory', async () => {
  const { call, fs, registry, root } = await setup('public');
  await registry.createEmployee({ userId: 'u-two', sharedMemoryEnabled: true });
  const agents: { agentId: string; token: string; actorId: string }[] = [];
  for (const userId of ['u-one', 'u-two']) {
    for (const role of ['network', 'memory', 'research']) {
      const agentId = `${userId}-${role}`;
      const secretFile = join(root, 'private', `${agentId}.txt`);
      await registry.createInvite({ binding: { accountId: agentId, agentId, userId, modelId: 'codex', runtimeId: 'r-one', role }, expiresAt: new Date(Date.now() + 60000).toISOString(), secretFile });
      const registered = await call('auth.register', { accountId: agentId, agentId, userId, modelId: 'codex', password: 'enterprise-test-password', sessionId: 'execution-one', invitationToken: (await readFile(secretFile, 'utf8')).trim() });
      expect(registered.result.isError, registered.text).not.toBe(true);
      const token = registered.value.accessToken;
      agents.push({ agentId, token, actorId: registered.value.principal.actorId });
      await fs.writeNote({ path: `_scopes/agents/${agentId}/Memory.md`, content: `unique-memory-${agentId}` });
    }
  }
  expect(new Set(agents.map(agent => agent.actorId)).size).toBe(6);
  for (const agent of agents) {
    for (const target of agents) {
      const response = await call('notes.read', { path: `scope://agent/${target.agentId}/Memory.md`, accessToken: agent.token });
      expect(response.result.isError === true, `${agent.agentId} -> ${target.agentId}: ${response.text}`).toBe(agent.agentId !== target.agentId);
      if (agent.agentId !== target.agentId) expect(response.text).not.toContain(`unique-memory-${target.agentId}`);
    }
  }
});

test('public generic note mutation cannot impersonate managed public profiles or posts', async () => {
  const { call, token } = await setup('public');
  const reply = await call('notes.write', { path: 'PublicCommunity/Local/Agents/agents/victim.md', content: 'forged', accessToken: token });
  expect(reply.result.isError, reply.text).toBe(true);
  expect((await call('notes.read', { path: 'Community/Secret.md', accessToken: token })).result.isError).toBe(true);
  const pulse = await call('get_agent_pulse', { accessToken: token });
  expect(pulse.result.isError, pulse.text).not.toBe(true);
  const post = await call('community.post', { slug: 'local-only', title: 'Local only', content: 'Hello', expectedRevision: 'missing', accessToken: token });
  expect(post.result.isError, post.text).not.toBe(true);
  expect(post.value.federation.status).toBe('disabled');
});
