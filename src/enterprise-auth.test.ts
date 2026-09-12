import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopeAuthService } from './scope-auth.js';
import { EnterpriseRegistry } from './enterprise-registry.js';
import { withEnterpriseRequestContext } from './enterprise-request-context.js';
import { getScopeAuthTools } from './scope-auth-tools.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const cert = 'a'.repeat(64);
const request = <T>(run: () => T, fingerprint = cert) => withEnterpriseRequestContext({ transport: 'http', certFingerprint: fingerprint }, run);
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-auth-')); roots.push(root);
  const vaultPath = join(root, 'vault'); await mkdir(vaultPath);
  const registry = new EnterpriseRegistry({ registryPath: join(root, 'private/policy.json'), vaultPath });
  await registry.initialize({ mode: 'company', realmId: 'acme', vaultPath });
  await registry.createEmployee({ userId: 'employee', sharedMemoryEnabled: true });
  await registry.registerRuntime({ runtimeId: 'local', kind: 'internal', certFingerprint: cert });
  const binding = { accountId: 'network', agentId: 'network', modelId: 'codex', userId: 'employee', runtimeId: 'local', role: 'network' };
  const secretFile = join(root, 'private/invite.txt');
  await registry.createInvite({ binding, expiresAt: new Date(Date.now() + 60000).toISOString(), secretFile });
  const invitationToken = (await readFile(secretFile, 'utf8')).trim();
  const auth = new ScopeAuthService(vaultPath, { commandCenterId: 'acme', enterpriseRegistry: registry, authPath: join(root, 'private/accounts.json') } as any);
  const input = { ...binding, password: 'test-password-at-least-12', invitationToken, sessionId: 's1' };
  return { registry, auth, input, root, vaultPath };
}

test('enterprise registration requires trusted runtime context and admin invitation', async () => {
  const { auth, input } = await setup();
  await expect(auth.register(input)).rejects.toThrow(/runtime|certificate/i);
  await expect(request(() => auth.register({ ...input, invitationToken: undefined } as any))).rejects.toThrow(/invit/i);
  await expect(request(() => auth.register({ ...input, userId: 'victim' }))).rejects.toThrow(/invitation|binding|identity/i);
});

test('same persistent agent survives explicit generation handoff and invalidates stale writer', async () => {
  const { auth, input } = await setup();
  const first = await request(() => auth.register(input));
  expect(first.principal.userId).toBe('employee');
  expect(first.principal.enterprise?.sharedMemoryEnabled).toBe(true);
  expect(first.principal.actorId).toBe('actor:acme:network');
  expect(request(() => auth.authenticate(first.accessToken))?.sessionId).toBe('s1');
  await expect(request(() => auth.login({ accountId: input.accountId, password: input.password, sessionId: 's2' } as any))).rejects.toThrow(/generation|active|handoff/i);
  const second = await request(() => auth.login({ accountId: input.accountId, password: input.password, sessionId: 's2', expectedGeneration: first.principal.sessionGeneration } as any));
  expect(second.principal.agentId).toBe(first.principal.agentId);
  expect(() => request(() => auth.authenticate(first.accessToken))).toThrow(/generation|session|lease/i);
  expect(request(() => auth.authenticate(second.accessToken))?.sessionId).toBe('s2');
});

test('stolen token, disabled runtime and employee cannot reuse a warm authentication session', async () => {
  const { registry, auth, input } = await setup();
  const account = await request(() => auth.register(input));
  expect(() => request(() => auth.authenticate(account.accessToken), 'b'.repeat(64))).toThrow(/certificate|runtime/i);
  expect(() => auth.authenticate(account.accessToken)).toThrow(/certificate|runtime/i);
  await registry.disableEmployee({ userId: 'employee' });
  expect(() => request(() => auth.authenticate(account.accessToken))).toThrow(/disabled|employee/i);
});

test('retrying consumed invite never changes the account password or creates another owner', async () => {
  const { auth, input } = await setup();
  await request(() => auth.register(input));
  await expect(request(() => auth.register({ ...input, password: 'different-test-password' }))).rejects.toThrow();
  expect((await auth.listPrincipals()).filter(p => p.accountId === input.accountId)).toHaveLength(1);
});

test('enterprise credentials require an absolute account store outside the Vault', async () => {
  const { registry, vaultPath } = await setup();
  expect(() => new ScopeAuthService(vaultPath, { enterpriseRegistry: registry, authPath: join(vaultPath, 'accounts.json') })).toThrow(/outside|private/i);
  expect(() => new ScopeAuthService(vaultPath, { enterpriseRegistry: registry, authPath: 'accounts.json' })).toThrow(/absolute/i);
});

test('enterprise does not advertise unavailable messaging capabilities', async () => {
  const { auth, input } = await setup();
  const session = await request(() => auth.register(input));
  expect(session.principal.capabilities).not.toContain('whisper');
});

test('runtime revocation immediately invalidates a warm token and removes directory identity', async () => {
  const { registry, auth, input } = await setup();
  const session = await request(() => auth.register(input));
  expect(request(() => auth.authenticate(session.accessToken))?.agentId).toBe('network');
  await registry.disableRuntime({ runtimeId: 'local' });
  expect(() => request(() => auth.authenticate(session.accessToken))).toThrow(/disabled|runtime/);
  expect(await auth.listPrincipals()).toEqual([]);
});

test('verified departments refresh on a warm session; signup claims never grant membership', async () => {
  const { registry, auth, input } = await setup();
  await registry.updateEmployeeDepartments({ userId: 'employee', departmentIds: ['engineering', 'research'], defaultDepartmentId: 'engineering', expectedDepartmentRevision: 0 });
  const session = await request(() => auth.register({ ...input, departmentIds: ['finance'], defaultDepartmentId: 'finance', local: true } as any));
  expect(session.principal.enterprise?.departmentIds).toEqual(['engineering', 'research']);
  expect(session.principal.enterprise?.defaultDepartmentId).toBe('engineering');
  await registry.updateEmployeeDepartments({ userId: 'employee', departmentIds: ['sales'], defaultDepartmentId: 'sales', expectedDepartmentRevision: 1 });
  const current = request(() => auth.authenticate(session.accessToken));
  expect(current?.enterprise?.departmentIds).toEqual(['sales']);
  expect(current?.enterprise?.defaultDepartmentId).toBe('sales');
  expect((await auth.listPrincipals())[0]?.enterprise?.departmentIds).toEqual(['sales']);
  await registry.updateEmployeeDepartments({ userId: 'employee', departmentIds: [], expectedDepartmentRevision: 2 });
  expect(request(() => auth.authenticate(session.accessToken))?.enterprise?.departmentIds).toEqual([]);
  expect(request(() => auth.authenticate(session.accessToken))?.enterprise?.defaultDepartmentId).toBeUndefined();
});

test('signup schema accepts account purpose and a department claim without treating either as authority', () => {
  const schema = getScopeAuthTools().find(t => t.name === 'register_scope_account')!.inputSchema as any;
  expect(schema.properties.accountType.enum).toEqual(['personal', 'enterprise']);
  expect(schema.properties.departmentId.type).toBe('string');
});

test('enterprise signup rejects an unverified department and permits a verified claim', async () => {
  const { registry, auth, input } = await setup();
  await registry.updateEmployeeDepartments({ userId: 'employee', departmentIds: ['engineering'], defaultDepartmentId: 'engineering', expectedDepartmentRevision: 0 });
  await expect(request(() => auth.register({ ...input, accountType: 'enterprise', departmentId: 'finance' }))).rejects.toThrow(/department|verified/i);
  expect(await auth.listPrincipals()).toHaveLength(0);
  const result = await request(() => auth.register({ ...input, accountType: 'enterprise', departmentId: 'engineering' }));
  expect(result.principal.enterprise?.defaultDepartmentId).toBe('engineering');
});

test('signup purpose must match the host authority and personal claims do not self-provision enterprise membership', async () => {
  const { auth, input, root } = await setup();
  await expect(request(() => auth.register({ ...input, accountType: 'personal' }))).rejects.toThrow(/account type|enterprise/i);
  const personal = new ScopeAuthService(join(root, 'personal-vault'));
  const base = { accountId: 'person', userId: 'human', modelId: 'codex', agentId: 'worker', password: 'test-password-at-least-12' };
  await expect(personal.register({ ...base, accountType: 'enterprise', departmentId: 'finance' })).rejects.toThrow(/enterprise|host/i);
  await expect(personal.register({ ...base, accountType: 'personal', departmentId: 'finance' })).rejects.toThrow(/department|enterprise/i);
  await expect(personal.register({ ...base, accountType: 'invalid' } as any)).rejects.toThrow(/account type/i);
  const result = await personal.register({ ...base, accountType: 'personal' });
  expect(result.principal.enterprise).toBeUndefined();
  expect(result.principal.userId).toBe('human');
});
