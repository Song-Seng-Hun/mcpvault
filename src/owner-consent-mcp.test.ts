import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, getServerRuntime, type CreateServerOptions } from './createServer.js';
import { OwnerActivityPolicy, type OwnerActivityConfig } from './owner-activity.js';
import { HOST_FEATURE_IDS_V1 } from './host-features.js';
import { FileSystemService } from './filesystem.js';
import { projectSkill, previewSkills, applySkills } from './skill-library.js';
import { startRestApi } from './rest-api.js';

// Owner consent gates every optional activity at the MCP boundary. Skill
// evolution is the remaining optional activity, so these barriers run on it.
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close(); });
vi.setConfig({ testTimeout: 30000 });
const features = { version: 1 as const, selected: ['wiki-core', 'skill-evolution'] as const };
const skillEvolution = { enabled: true, attestationKey: 'synthetic-only-private-key-1234567890123456789', approverAccounts: ['fixtureaccount'], profiles: [] };
const denied = /owner|consent|authority|scope unavailable/i;

async function fixture(ownerActivity?: CreateServerOptions['ownerActivity']) {
  const root = await mkdtemp(join(tmpdir(), 'owner-consent-mcp-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const fs = new FileSystemService(root);
  for (const id of ['safe-edit', 'other-skill']) {
    const notes = projectSkill({ id, origin: 'fixture', version: '1', license: 'MIT', licenseText: 'MIT License\nPermission is hereby granted, free of charge',
      description: `${id} marker`, files: [{ path: 'SKILL.md', text: `# ${id} marker\nread\n` }], unavailable: [] });
    await applySkills(fs, notes, (await previewSkills(fs, notes)).fingerprint);
  }
  await fs.writeNote({ path: 'Evidence/edit.md', content: 'Observed.' });
  const server = createServer(root, { features, skillEvolution, ...(ownerActivity && { ownerActivity }) });
  cleanup.push(() => server.close());
  const runtime = getServerRuntime(server)!;
  const registration = await runtime.dispatchTool('register_scope_account', { accountId: 'fixtureaccount', modelId: 'model', password: 'test-only-password' });
  const accessToken = JSON.parse(registration.content[0].text).accessToken as string;
  const resolve = (skillId: string) => runtime.dispatchTool('call_endpoint', { endpointId: 'skill.resolve', accessToken, arguments: { skillId } });
  return { root, fs, server, runtime, accessToken, resolve };
}

function config(dataPrefixes = ['Community/Skills/safe-edit']): OwnerActivityConfig {
  return { version: 1, owners: { fixtureaccount: 'fixtureowner' }, grants: [{
    id: 'fixturegrant', ownerId: 'fixtureowner', accountIds: ['fixtureaccount'], activities: ['skill-evolution'],
    actions: ['discover', 'read', 'claim', 'execute'], dataPrefixes, executionTargets: ['fixtureruntime'], expiresAt: '2999-01-01T00:00:00.000Z',
  }] };
}
const revoked = (input: OwnerActivityConfig) => new OwnerActivityPolicy({ ...input, grants: input.grants.map(grant => ({ ...grant, revoked: true })) });
const trusted = (policy: () => OwnerActivityPolicy, refresh?: () => Promise<void>): NonNullable<CreateServerOptions['ownerActivity']> => ({
  ...(refresh && { refresh }), policy, execution: () => ({ accountId: 'fixtureaccount', executionTarget: 'fixtureruntime' }),
});
// Revoke from a microtask queued after the given refresh settles.
const revokeAfterRefresh = (input: OwnerActivityConfig, at: number) => {
  let current = new OwnerActivityPolicy(input), refreshes = 0;
  return trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes === at) await new Promise<void>(done => { done(); queueMicrotask(() => { current = revoked(input); }); });
  });
};
const catalog = (runtime: Awaited<ReturnType<typeof fixture>>['runtime'], accessToken: string) =>
  runtime.dispatchTool('search_capabilities', { query: 'skill.resolve', limit: 3, maxChars: 20000, accessToken });
const pulse = (runtime: Awaited<ReturnType<typeof fixture>>['runtime'], accessToken: string) =>
  runtime.dispatchTool('get_agent_pulse', { accessToken, skillId: 'safe-edit', maxChars: 12000 });

test('a selected optional activity has no owner consent by default', async () => {
  const { resolve } = await fixture();
  const response = await resolve('safe-edit');
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).toMatch(denied);
  expect(JSON.stringify(response)).not.toContain('safe-edit marker');
});

test('catalogs expose a locked exact schema but omit it from active listings', async () => {
  const { runtime, accessToken } = await fixture();
  const match = JSON.parse((await catalog(runtime, accessToken)).content[0].text).endpoints.find((item: any) => item.endpointId === 'skill.resolve');
  expect(match).toMatchObject({ available: false, state: 'locked' });
  const activeIds: string[] = []; let cursor: string | undefined;
  do {
    const page = JSON.parse((await runtime.dispatchTool('list_active_capabilities', { limit: 100, maxChars: 20000, accessToken, ...(cursor && { cursor }) })).content[0].text);
    activeIds.push(...page.endpoints.map((item: any) => item.endpointId)); cursor = page.nextCursor;
  } while (cursor);
  expect(activeIds).not.toContain('skill.resolve');
});

test('granted consent makes the catalog ready and revocation invalidates an active cursor', async () => {
  let current = new OwnerActivityPolicy(config());
  const { runtime, accessToken } = await fixture(trusted(() => current));
  const match = JSON.parse((await catalog(runtime, accessToken)).content[0].text).endpoints.find((item: any) => item.endpointId === 'skill.resolve');
  expect(match).toMatchObject({ available: true, state: 'ready' });
  const first = JSON.parse((await runtime.dispatchTool('list_active_capabilities', { limit: 1, maxChars: 20000, accessToken })).content[0].text);
  expect(first.nextCursor).toBeTruthy();
  current = revoked(config());
  const changed = await runtime.dispatchTool('list_active_capabilities', { limit: 1, maxChars: 20000, accessToken, cursor: first.nextCursor });
  expect(changed.isError).toBe(true);
});

test('a catalog cursor binds the available grant set without exposing grant IDs', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T00:00:00.000Z'));
  const input = config();
  input.grants[0] = { ...input.grants[0]!, id: 'short-overlap', expiresAt: '2026-09-12T00:00:01.000Z' };
  input.grants.push({ ...input.grants[0]!, id: 'long-overlap', expiresAt: '2026-09-12T01:00:00.000Z' });
  const { runtime, accessToken } = await fixture(trusted(() => new OwnerActivityPolicy(input)));
  const first = JSON.parse((await runtime.dispatchTool('list_active_capabilities', { limit: 1, maxChars: 20000, accessToken })).content[0].text);
  expect(first.nextCursor).not.toMatch(/short-overlap|long-overlap/);
  vi.setSystemTime(new Date('2026-09-12T00:00:02.000Z'));
  const changed = await runtime.dispatchTool('list_active_capabilities', { limit: 1, maxChars: 20000, accessToken, cursor: first.nextCursor });
  expect(changed.isError).toBe(true);
});

test('consent is checked before an unconfigured provider is reached', async () => {
  const root = await mkdtemp(join(tmpdir(), 'owner-consent-all-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = createServer(root, { features: { version: 1, selected: [...HOST_FEATURE_IDS_V1] } });
  cleanup.push(() => server.close());
  const response = await getServerRuntime(server)!.dispatchTool('call_endpoint', { endpointId: 'skill.resolve', arguments: { skillId: 'example' } });
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).toMatch(denied);
});

test('a grant admits only its data prefix', async () => {
  const { resolve } = await fixture(trusted(() => new OwnerActivityPolicy(config())));
  expect((await resolve('safe-edit')).isError).not.toBe(true);
  const other = await resolve('other-skill');
  expect(other.isError).toBe(true);
  expect(JSON.stringify(other)).not.toContain('other-skill marker');
});

test('an ancestor-shaped prefix never admits the existing file above it', async () => {
  const { resolve } = await fixture(trusted(() => new OwnerActivityPolicy(config(['Community/Skills/other-skill/SKILL.md/chapter']))));
  const response = await resolve('other-skill');
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain('other-skill marker');
});

test('revocation after a read rejects the buffered output before emit', async () => {
  let current = new OwnerActivityPolicy(config()), refreshes = 0, armed = false;
  const { resolve } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (armed && refreshes === 2) current = revoked(config());
  }));
  expect((await resolve('safe-edit')).isError).not.toBe(true);
  refreshes = 0; armed = true;
  const response = await resolve('safe-edit');
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain('safe-edit marker');
});

test('dispatch checks consent synchronously after its final refresh settles', async () => {
  const { resolve } = await fixture(revokeAfterRefresh(config(), 2));
  const response = await resolve('safe-edit');
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain('safe-edit marker');
});

test('the catalog checks consent synchronously after its final refresh settles', async () => {
  const { runtime, accessToken } = await fixture(revokeAfterRefresh(config(), 2));
  expect((await catalog(runtime, accessToken)).isError).toBe(true);
});

test('the catalog keeps its validator through the document-policy refresh', async () => {
  const input = config(); let current = new OwnerActivityPolicy(input), reads = 0;
  const { runtime, accessToken } = await fixture(trusted(() => {
    reads += 1;
    const snapshot = current;
    if (reads === 3) queueMicrotask(() => { current = revoked(input); });
    return snapshot;
  }));
  expect((await catalog(runtime, accessToken)).isError).toBe(true);
});

test('the catalog refreshes file-backed consent again before emission', async () => {
  let current = new OwnerActivityPolicy(config()), refreshes = 0;
  const { runtime, accessToken } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes === 3) current = revoked(config());
  }));
  expect((await catalog(runtime, accessToken)).isError).toBe(true);
  expect(refreshes).toBeGreaterThanOrEqual(3);
});

test('pulse checks consent synchronously after its final refresh settles', async () => {
  const { runtime, accessToken } = await fixture(revokeAfterRefresh(config(['.']), 2));
  const response = await pulse(runtime, accessToken);
  expect(response.isError).toBe(true);
  expect(JSON.stringify(response)).not.toContain('skill.candidate');
});

test('pulse refreshes file-backed consent again before emission', async () => {
  let current = new OwnerActivityPolicy(config(['.'])), refreshes = 0;
  const { runtime, accessToken } = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (refreshes === 3) current = revoked(config(['.']));
  }));
  expect((await pulse(runtime, accessToken)).isError).toBe(true);
  expect(refreshes).toBeGreaterThanOrEqual(3);
});

test('pulse without consent skips skill sources and recommends no optional activity', async () => {
  const { runtime, accessToken } = await fixture();
  const response = await pulse(runtime, accessToken);
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const packet = JSON.parse(response.content[0].text);
  expect(packet.coverage.skills.state).toBe('skipped');
  expect(JSON.stringify(packet.nextAction)).not.toMatch(/skill\./);
});

test('a scoped grant permits the write and revocation just before it leaves no mutation', async () => {
  const prepare = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const resolved = JSON.parse((await f.resolve('safe-edit')).content[0].text);
    const evidence = { path: 'Evidence/edit.md', revision: (await f.fs.readNote('Evidence/edit.md')).revision };
    return (requestId: string) => f.runtime.dispatchTool('call_endpoint', { endpointId: 'skill.experience', accessToken: f.accessToken, arguments: {
      skillId: 'safe-edit', requestId, expectedRevision: 'missing', usedVersion: { path: resolved.path, revision: resolved.revision },
      applied: true, outcome: 'failure', shareable: true, context: 'Synthetic', summary: 'Verify.', evidence: [evidence] } });
  };
  const allowed = await fixture(trusted(() => new OwnerActivityPolicy(config(['.']))));
  const written = await (await prepare(allowed))('allowed');
  expect(written.isError, JSON.stringify(written)).not.toBe(true);

  let current = new OwnerActivityPolicy(config(['.'])), refreshes = 0, armed = false;
  const blocked = await fixture(trusted(() => current, async () => {
    refreshes += 1;
    if (armed && refreshes === 2) current = revoked(config(['.']));
  }));
  const write = await prepare(blocked);
  const vaultFiles = async () => (await readdir(blocked.root, { recursive: true })).filter(path => !path.startsWith('.mcpvault'));
  const before = await vaultFiles();
  refreshes = 0; armed = true;
  expect((await write('blocked')).isError).toBe(true);
  const after = await vaultFiles();
  // The request receipt is reserved before the final barrier (reported
  // separately); the experience record itself must not be written.
  expect(after.filter(path => !before.includes(path) && !/_evolution([\\/]receipts)?([\\/]|$)/.test(path))).toEqual([]);
});

test('REST shares the owner consent boundary', async () => {
  const { server } = await fixture();
  const api = await startRestApi(server, { port: 0 }); cleanup.push(() => api.close());
  const response = await fetch(`http://127.0.0.1:${api.port}/api/endpoint/skill.resolve?skillId=safe-edit`);
  expect(response.ok).toBe(false);
  expect(await response.text()).toMatch(denied);
});
