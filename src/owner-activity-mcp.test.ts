import { afterEach, expect, test, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, getServerRuntime, type CreateServerOptions } from './createServer.js';
import { OwnerActivityPolicy, type OwnerActivityConfig } from './owner-activity.js';
import { HOST_FEATURE_IDS_V1 } from './host-features.js';
import { startRestApi } from './rest-api.js';
import { EnterpriseRegistry } from './enterprise-registry.js';
import { withEnterpriseRequestContext } from './enterprise-request-context.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close(); });
const features = { version: 1 as const, selected: ['wiki-core', 'collaboration'] as const };
const post = (title: string, body: string) => `---\nmcpvault_type: blog_post\nstatus: published\nworkflow_status: active\ntitle: ${title}\nauthor: fixture\nupdated_at: 2026-09-12T00:00:00.000Z\n---\n${body}\n`;

async function fixture(ownerActivity?: CreateServerOptions['ownerActivity']) {
  const root = await mkdtemp(join(tmpdir(), 'owner-activity-mcp-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Community', 'Posts'), { recursive: true });
  await writeFile(join(root, 'Community', 'Posts', 'allowed.md'), post('Allowed title', 'allowed body'));
  await writeFile(join(root, 'Community', 'Posts', 'secret.md'), post('Secret title', 'secret body'));
  const server = createServer(root, { features, ...(ownerActivity && { ownerActivity }) });
  cleanup.push(() => server.close());
  return { root, server, runtime: getServerRuntime(server)! };
}

function config(revoked = false): OwnerActivityConfig {
  return { version: 1, owners: { fixtureaccount: 'fixtureowner' }, grants: [{
    id: 'fixturegrant', ownerId: 'fixtureowner', accountIds: ['fixtureaccount'], activities: ['collaboration'],
    actions: ['discover', 'read', 'claim', 'execute'], dataPrefixes: ['Community/Posts/allowed.md'],
    executionTargets: ['fixtureruntime'], expiresAt: '2999-01-01T00:00:00.000Z', revoked,
  }] };
}
const trusted = (policy: () => OwnerActivityPolicy, refresh?: () => Promise<void>): NonNullable<CreateServerOptions['ownerActivity']> => ({
  ...(refresh && { refresh }), policy, execution: () => ({ accountId: 'fixtureaccount', executionTarget: 'fixtureruntime' }),
});

test('selected optional activity defaults to no owner consent and request labels cannot forge it', async () => {
  const { runtime } = await fixture();
  for (const arguments_ of [{ limit: 10 }, { limit: 10, ownerId: 'fixtureowner', accountId: 'fixtureaccount', executionTarget: 'fixtureruntime', modelId: 'gemini', locality: 'local' }]) {
    const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'community.posts', arguments: arguments_ });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).toMatch(/owner|consent|authority/i);
    expect(JSON.stringify(response)).not.toContain('Secret title');
  }
});

test('real capability catalogs hide active optional endpoints but expose exact locked schemas', async () => {
  const { runtime } = await fixture();
  const exact = await runtime.dispatchTool('search_capabilities', { query: 'community.posts', limit: 3, maxChars: 20000 });
  const match = JSON.parse(exact.content[0].text).endpoints.find((item: any) => item.endpointId === 'community.posts');
  expect(match).toMatchObject({ available: false, state: 'locked', reason: 'owner consent required' });
  const activeIds: string[] = []; let cursor: string | undefined;
  do {
    const page = JSON.parse((await runtime.dispatchTool('list_active_capabilities', { limit: 100, maxChars: 20000, ...(cursor && { cursor }) })).content[0].text);
    activeIds.push(...page.endpoints.map((item: any) => item.endpointId)); cursor = page.nextCursor;
  } while (cursor);
  expect(activeIds).not.toContain('community.posts');
});

test('catalog consent becomes ready when granted and revocation invalidates an active cursor', async () => {
  let current = new OwnerActivityPolicy(config());
  const { runtime } = await fixture(trusted(() => current));
  const exact = JSON.parse((await runtime.dispatchTool('search_capabilities', { query: 'community.posts', limit: 3, maxChars: 20000 })).content[0].text);
  expect(exact.endpoints.find((item: any) => item.endpointId === 'community.posts')).toMatchObject({ available: true, state: 'ready' });
  const first = JSON.parse((await runtime.dispatchTool('list_active_capabilities', { limit: 1, maxChars: 20000 })).content[0].text);
  expect(first.nextCursor).toBeTruthy();
  current = new OwnerActivityPolicy(config(true));
  const changed = await runtime.dispatchTool('list_active_capabilities', { limit: 1, maxChars: 20000, cursor: first.nextCursor });
  expect(changed.isError).toBe(true);
  expect(JSON.stringify(changed)).toMatch(/cursor|authority|configuration changed/i);
});

test('catalog cursor fingerprints the currently available overlapping grant set without exposing grant IDs', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T00:00:00.000Z'));
  const input = config();
  input.grants[0] = { ...input.grants[0]!, id: 'short-overlap', expiresAt: '2026-09-12T00:00:01.000Z' };
  input.grants.push({ ...input.grants[0]!, id: 'long-overlap', expiresAt: '2026-09-12T01:00:00.000Z' });
  const { runtime } = await fixture(trusted(() => new OwnerActivityPolicy(input)));
  const first = JSON.parse((await runtime.dispatchTool('list_active_capabilities', { limit: 1, maxChars: 20000 })).content[0].text);
  expect(first.nextCursor).toBeTruthy();
  expect(first.nextCursor).not.toMatch(/short-overlap|long-overlap/);

  vi.setSystemTime(new Date('2026-09-12T00:00:02.000Z'));
  const changed = await runtime.dispatchTool('list_active_capabilities', { limit: 1, maxChars: 20000, cursor: first.nextCursor });
  expect(changed.isError).toBe(true);
  expect(JSON.stringify(changed)).toMatch(/cursor|authority|configuration changed/i);
});

test('every optional activity is gated before an unavailable provider or store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'owner-activity-all-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = createServer(root, { features: { version: 1, selected: [...HOST_FEATURE_IDS_V1] } });
  cleanup.push(() => server.close()); const runtime = getServerRuntime(server)!;
  for (const [endpointId, arguments_] of [
    ['community.posts', {}], ['idea.list', {}], ['explanations.list', {}], ['benchmark.list', {}],
    ['economy.wallet', {}], ['roleplay.world', { op: 'read' }], ['skill.resolve', { skillId: 'example' }],
  ] as const) {
    const response = await runtime.dispatchTool('call_endpoint', { endpointId, arguments: arguments_ });
    expect(response.isError, endpointId).toBe(true);
    expect(JSON.stringify(response), endpointId).toMatch(/owner|consent|authority/i);
  }
});

test('one trusted discovery grant filters candidates before titles and counts', async () => {
  const current = new OwnerActivityPolicy(config());
  const { runtime } = await fixture(trusted(() => current));
  const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'community.posts', arguments: { limit: 10 } });
  expect(response.isError).not.toBe(true);
  const text = response.content[0].text;
  expect(text).toContain('Allowed title');
  expect(text).not.toContain('Secret title');
  expect(JSON.parse(text).total).toBe(1);
});

test('an ancestor-shaped existing file is never readable through traversal admission', async () => {
  const input = config(); input.grants[0]!.dataPrefixes = ['Community/Posts/secret.md/chapter'];
  const current = new OwnerActivityPolicy(input);
  const { runtime } = await fixture(trusted(() => current));
  const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'community.posts', arguments: { limit: 10 } });
  expect(JSON.stringify(response)).not.toContain('Secret title');
  if (response.isError) expect(response.content[0].text).toMatch(/access|director|scope/i);
  else expect(JSON.parse(response.content[0].text).total).toBe(0);
});

test('revocation after a read rejects the buffered output before emit', async () => {
  let current = new OwnerActivityPolicy(config()); let refreshes = 0; let armed = false;
  const { runtime } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (armed && refreshes === 2) current = new OwnerActivityPolicy(config(true));
  }));
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'readeraccount', modelId: 'model', password: 'test-only-password',
  });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const baseline = await runtime.dispatchTool('call_endpoint', { endpointId: 'community.post_read', accessToken, arguments: { slug: 'allowed' } });
  expect(baseline.isError).not.toBe(true);
  refreshes = 0; armed = true; current = new OwnerActivityPolicy(config());
  const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'community.post_read', accessToken, arguments: { slug: 'allowed' } });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain('allowed body');
  expect(refreshes).toBeGreaterThanOrEqual(2);
});

test('dispatch performs a synchronous owner barrier after the final asynchronous refresh settles', async () => {
  const input = config(); let current = new OwnerActivityPolicy(input); let refreshes = 0;
  const { runtime } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes !== 2) return;
    await new Promise<void>(resolve => {
      resolve();
      queueMicrotask(() => { current = new OwnerActivityPolicy({ ...input,
        grants: input.grants.map(grant => ({ ...grant, revoked: true })) }); });
    });
  }));
  const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'community.post_read', arguments: { slug: 'allowed' } });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain('allowed body');
});

test('catalog performs a synchronous owner barrier after its final asynchronous refresh settles', async () => {
  const input = config(); let current = new OwnerActivityPolicy(input); let refreshes = 0;
  const { runtime } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes !== 2) return;
    await new Promise<void>(resolve => {
      resolve();
      queueMicrotask(() => { current = new OwnerActivityPolicy({ ...input,
        grants: input.grants.map(grant => ({ ...grant, revoked: true })) }); });
    });
  }));
  const response = await runtime.dispatchTool('search_capabilities', { query: 'community.posts', limit: 3, maxChars: 20000 });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain('Allowed title');
});

test('catalog retains a validator through the outer document-policy refresh before emission', async () => {
  const input = config(); let current = new OwnerActivityPolicy(input); let policyReads = 0;
  const { runtime } = await fixture(trusted(() => {
    policyReads += 1;
    const snapshot = current;
    if (policyReads === 3) queueMicrotask(() => { current = new OwnerActivityPolicy({ ...input,
      grants: input.grants.map(grant => ({ ...grant, revoked: true })) }); });
    return snapshot;
  }));
  const response = await runtime.dispatchTool('search_capabilities', { query: 'community.posts', limit: 3, maxChars: 20000 });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain('Allowed title');
});

test('catalog refreshes file-backed owner consent again at the final emission barrier', async () => {
  const input = config(); let current = new OwnerActivityPolicy(input); let refreshes = 0;
  const { runtime } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes === 3) current = new OwnerActivityPolicy({ ...input,
      grants: input.grants.map(grant => ({ ...grant, revoked: true })) });
  }));
  const response = await runtime.dispatchTool('search_capabilities', { query: 'community.posts', limit: 3, maxChars: 20000 });
  expect(response.isError).toBe(true);
  expect(refreshes).toBeGreaterThanOrEqual(3);
});

test('pulse performs a synchronous owner barrier after its final asynchronous refresh settles', async () => {
  const input = config(); input.grants[0]!.dataPrefixes = ['.'];
  let current = new OwnerActivityPolicy(input); let refreshes = 0;
  const { runtime } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes < 2) return;
    await new Promise<void>(resolve => {
      resolve();
      queueMicrotask(() => { current = new OwnerActivityPolicy({ ...input,
        grants: input.grants.map(grant => ({ ...grant, revoked: true })) }); });
    });
  }));
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'pulsebarrier', modelId: 'model', password: 'test-only-password',
  });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await runtime.dispatchTool('get_agent_pulse', { accessToken, hostBusy: true, maxChars: 12000 });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toMatch(/Allowed title|Secret title/);
});

test('pulse retains its acquired lease validator through the outer document-policy refresh before emission', async () => {
  const input = config(); input.grants[0]!.dataPrefixes = ['.'];
  const granted = new OwnerActivityPolicy(input);
  let current: OwnerActivityPolicy = granted; let pathlessDecisions = 0;
  const observed = new Proxy(granted, { get(target, property, receiver) {
    if (property !== 'decision') return Reflect.get(target, property, receiver);
    return (request: Parameters<OwnerActivityPolicy['decision']>[0]) => {
      const decision = target.decision(request);
      if (request.paths === undefined) {
        pathlessDecisions += 1;
        if (pathlessDecisions === 3) queueMicrotask(() => { current = new OwnerActivityPolicy({ ...input,
          grants: input.grants.map(grant => ({ ...grant, revoked: true })) }); });
      }
      return decision;
    };
  } });
  const { runtime } = await fixture(trusted(() => current === granted ? observed : current));
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'pulseretained', modelId: 'model', password: 'test-only-password',
  });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await runtime.dispatchTool('get_agent_pulse', { accessToken, hostBusy: true, maxChars: 12000 });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toMatch(/Allowed title|Secret title/);
});

test('pulse refreshes file-backed owner consent again at the final emission barrier', async () => {
  const input = config(); input.grants[0]!.dataPrefixes = ['.'];
  let current = new OwnerActivityPolicy(input); let refreshes = 0;
  const { runtime } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes === 3) current = new OwnerActivityPolicy({ ...input,
      grants: input.grants.map(grant => ({ ...grant, revoked: true })) });
  }));
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'pulsefilerefresh', modelId: 'model', password: 'test-only-password',
  });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await runtime.dispatchTool('get_agent_pulse', { accessToken, hostBusy: true, maxChars: 12000 });
  expect(response.isError).toBe(true);
  expect(refreshes).toBeGreaterThanOrEqual(3);
});

test('a real exact-path owner grant permits the scoped Windows write boundary', async () => {
  const writable = config(); writable.grants[0]!.dataPrefixes = ['Community/Posts/exact.md'];
  const { root, runtime } = await fixture(trusted(() => new OwnerActivityPolicy(writable)));
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'exactwriter', modelId: 'model', password: 'test-only-password', capabilities: ['publish'],
  });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'community.post', accessToken,
    arguments: { slug: 'exact', title: 'Exact path', content: 'scoped write', expectedRevision: 'missing' } });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(await readFile(join(root, 'Community', 'Posts', 'exact.md'), 'utf8')).toContain('scoped write');
});

test('revocation immediately before a physical write leaves no mutation', async () => {
  const writable = config(); writable.grants[0]!.dataPrefixes = ['Community/Posts/new.md'];
  let current = new OwnerActivityPolicy(writable); let refreshes = 0;
  const { root, runtime } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes === 2) current = new OwnerActivityPolicy({ ...writable,
      grants: writable.grants.map(grant => ({ ...grant, revoked: true })) });
  }));
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'authoraccount', modelId: 'model', password: 'test-only-password', capabilities: ['publish'],
  });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'community.post', accessToken,
    arguments: { slug: 'new', title: 'Must not exist', content: 'never write this', expectedRevision: 'missing' } });
  expect(response.isError).toBe(true);
  await expect(access(join(root, 'Community', 'Posts', 'new.md'))).rejects.toThrow();
});

test('REST uses the same owner activity consent boundary', async () => {
  const { server } = await fixture();
  const api = await startRestApi(server, { port: 0 }); cleanup.push(() => api.close());
  const response = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/community.posts?limit=10`);
  expect(response.ok).toBe(false);
  expect(await response.text()).toMatch(/owner|consent|authority/i);
});

test('pulse with no owner consent does not browse or recommend optional activity', async () => {
  const { runtime } = await fixture();
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'pulseaccount', modelId: 'model', password: 'test-only-password',
  });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await runtime.dispatchTool('get_agent_pulse', { accessToken, hostBusy: true, maxChars: 12000 });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const text = response.content[0].text;
  const pulse = JSON.parse(text);
  expect(text).not.toMatch(/Allowed title|Secret title/i);
  expect(pulse.nextAction.tool).toBe('wiki.home');
  for (const source of ['notifications', 'explanations', 'benchmarks', 'posts', 'skills', 'workshops', 'ideas', 'rooms', 'reputation']) {
    expect(pulse.coverage[source].state).toBe('skipped');
  }
});

test('pulse revalidates its bound owner grant after optional reads and before emit', async () => {
  const input = config(); input.grants[0]!.dataPrefixes = ['.'];
  let current = new OwnerActivityPolicy(input); let refreshes = 0;
  const { runtime } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes === 2) current = new OwnerActivityPolicy({ ...input,
      grants: input.grants.map(grant => ({ ...grant, revoked: true })) });
  }));
  const registration = await runtime.dispatchTool('register_scope_account', {
    accountId: 'pulselease', modelId: 'model', password: 'test-only-password',
  });
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await runtime.dispatchTool('get_agent_pulse', { accessToken, hostBusy: true, maxChars: 12000 });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toMatch(/Allowed title|Secret title/);
});

test('enterprise pulse never bypasses owner consent to browse community posts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'owner-enterprise-pulse-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const vault = join(root, 'vault'); await mkdir(join(vault, 'Community', 'Posts'), { recursive: true });
  await writeFile(join(vault, 'Community', 'Posts', 'secret.md'), post('Enterprise secret title', 'enterprise secret body'));
  const registryPath = join(root, 'private', 'registry.json');
  const registry = new EnterpriseRegistry({ registryPath, vaultPath: vault });
  await registry.initialize({ mode: 'company', realmId: 'enterprise', vaultPath: vault });
  await registry.createEmployee({ userId: 'employee', sharedMemoryEnabled: true });
  const certFingerprint = 'e'.repeat(64);
  await registry.registerRuntime({ runtimeId: 'runtime', kind: 'internal', certFingerprint });
  const binding = { accountId: 'enterpriseaccount', agentId: 'agent', modelId: 'model', userId: 'employee', runtimeId: 'runtime', role: 'employee' };
  const secretFile = join(root, 'private', 'invite.txt');
  await registry.createInvite({ binding, expiresAt: new Date(Date.now() + 60_000).toISOString(), secretFile });
  const invitationToken = (await readFile(secretFile, 'utf8')).trim();
  const server = createServer(vault, { enterpriseRegistryPath: registryPath,
    features: { version: 1, selected: ['wiki-core', 'personal-memory', 'collaboration'] } });
  cleanup.push(() => server.close()); const runtime = getServerRuntime(server)!;
  const invoke = <T>(operation: () => T) => withEnterpriseRequestContext({ transport: 'http', certFingerprint }, operation);
  const registration = await invoke(() => runtime.dispatchTool('register_scope_account', {
    ...binding, password: 'test-password-at-least-12', invitationToken, sessionId: 'session',
  }));
  const accessToken = JSON.parse(registration.content[0].text).accessToken;
  const response = await invoke(() => runtime.dispatchTool('get_agent_pulse', { accessToken, hostBusy: true, maxChars: 12000 }));
  expect(response.isError).not.toBe(true);
  expect(response.content[0].text).not.toMatch(/Enterprise secret title|enterprise secret body/);
});
