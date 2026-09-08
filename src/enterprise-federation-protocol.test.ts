import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from './createServer.js';
import { EnterpriseRegistry } from './enterprise-registry.js';
import { withEnterpriseRequestContext } from './enterprise-request-context.js';
import { startPublicFederationHub } from './public-federation-http.js';
const disposers: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of disposers.splice(0).reverse()) await close(); });

test('two enterprise five-tool servers publish and reply using verified public identities without exporting session fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-fed-protocol-')); disposers.push(() => rm(root, { recursive: true, force: true }));
  const hub = await startPublicFederationHub(join(root, 'hub'), { credentials: { 'a-hub-secret': { origin: 'public-a', agentId: 'network' }, 'b-hub-secret': { origin: 'public-b', agentId: 'network' } } });
  disposers.push(() => hub.close());
  async function server(realmId: string, hubToken: string) {
    const vaultPath = join(root, realmId); await mkdir(vaultPath);
    const registryPath = join(root, 'private', `${realmId}.json`);
    const registry = new EnterpriseRegistry({ registryPath, vaultPath });
    await registry.initialize({ mode: 'public', realmId, vaultPath });
    await registry.createEmployee({ userId: 'confidential-employee' });
    await registry.registerRuntime({ runtimeId: 'external-client', kind: 'external', certFingerprint: 'a'.repeat(64) });
    const secretFile = join(root, 'private', `${realmId}-invite.txt`);
    await registry.createInvite({ binding: { accountId: 'account-network', agentId: 'network', userId: 'confidential-employee', modelId: 'codex', runtimeId: 'external-client' }, expiresAt: new Date(Date.now() + 60000).toISOString(), secretFile });
    const instance = createServer(vaultPath, { enterpriseRegistryPath: registryPath, publicFederation: { baseUrl: `http://127.0.0.1:${hub.port}`, trustedHubPublicKey: hub.hub.getPublicKey(), actors: { network: { authToken: hubToken } } } });
    disposers.push(() => instance.close());
    const runtime = getServerRuntime(instance)!;
    let token: string | undefined;
    const call = async (endpointId: string, args: Record<string, unknown>) => {
      const result = await withEnterpriseRequestContext({ transport: 'http', certFingerprint: 'a'.repeat(64) }, () => runtime.dispatchTool('call_endpoint', { endpointId, arguments: { ...args, ...(token && { accessToken: token }) } }));
      expect(result.isError, result.content[0].text).not.toBe(true);
      return JSON.parse(result.content[0].text);
    };
    const registration = await call('auth.register', { accountId: 'account-network', agentId: 'network', userId: 'confidential-employee', modelId: 'codex', password: 'never-export-this-password', sessionId: 'private-execution', invitationToken: (await readFile(secretFile, 'utf8')).trim() });
    token = registration.accessToken;
    return { call, token };
  }
  const first = await server('public-a', 'a-hub-secret');
  const second = await server('public-b', 'b-hub-secret');
  const post = await first.call('community.post', { slug: 'introduction', title: 'Introduction', content: 'Hello, I am Codex.', expectedRevision: 'missing', principal: { agentId: 'victim' } });
  expect(post.federation).toMatchObject({ status: 'published', objectId: 'post:public-a:network:introduction' });
  await second.call('federation.pull', {});
  const read = await second.call('community.post_read', { slug: post.federation.objectId });
  expect(read.content).toContain('Hello, I am Codex.');
  const comment = await second.call('community.comment', { slug: post.federation.objectId, commentId: 'reply', content: 'Hello @actor:public-a:network' });
  expect(comment.federation.status).toBe('published');
  await first.call('federation.pull', {});
  const comments = await first.call('community.comments', { slug: post.federation.objectId });
  expect(JSON.stringify(comments)).toContain('actor:public-b:network');
  const feed = JSON.stringify(await hub.hub.getFeed(0, 100));
  for (const secret of ['confidential-employee', 'private-execution', 'never-export-this-password', first.token!, second.token!, 'victim']) expect(feed).not.toContain(secret);
});
