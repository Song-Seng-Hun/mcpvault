import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EnterpriseRegistry, type EnterpriseBinding } from './enterprise-registry.js';
import { previewAccountMigration, runEnterpriseAdmin } from '../enterprise-admin.js';

const CERT_A = 'a'.repeat(64);
const CERT_B = 'b'.repeat(64);

let root: string;
let vaultPath: string;
let registryPath: string;
let secretPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-enterprise-'));
  vaultPath = join(root, 'vault');
  registryPath = join(root, 'host-policy', 'enterprise.json');
  secretPath = join(root, 'private', 'invite.secret');
  await mkdir(vaultPath, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function registry(now = new Date('2026-09-08T00:00:00.000Z')) {
  return new EnterpriseRegistry({ registryPath, vaultPath, now: () => now });
}

const binding: EnterpriseBinding = {
  accountId: 'acct-one',
  agentId: 'agent-one',
  userId: 'employee-one',
  modelId: 'codex',
  runtimeId: 'runtime-one',
  displayLabel: 'Codex worker',
  role: 'developer',
};

async function initializedRegistry(options: { sharedMemoryEnabled?: boolean } = {}) {
  const value = registry();
  await value.initialize({ mode: 'company', realmId: 'acme', vaultPath });
  await value.createEmployee({ userId: binding.userId, ...options });
  await value.registerRuntime({ runtimeId: binding.runtimeId, kind: 'internal', certFingerprint: CERT_A });
  return value;
}

async function invite(value: EnterpriseRegistry, expiresAt = '2026-09-08T01:00:00.000Z') {
  const result = await value.createInvite({ binding, expiresAt, secretFile: secretPath });
  const secret = (await readFile(secretPath, 'utf8')).trim();
  return { ...result, secret };
}

function reservationInput(secret: string, overrides: Record<string, unknown> = {}) {
  return {
    secret,
    realmId: 'acme',
    mode: 'company' as const,
    runtimeId: binding.runtimeId,
    certFingerprint: CERT_A,
    ...overrides,
  };
}

describe('host-only policy storage', () => {
  test('rejects registry and invite secret paths inside the Vault or service directories', async () => {
    expect(() => new EnterpriseRegistry({ registryPath: join(vaultPath, '.mcpvault', 'enterprise.json'), vaultPath }))
      .toThrow(/outside.*Vault/i);

    const servicePath = join(root, 'service');
    const value = new EnterpriseRegistry({ registryPath, vaultPath, servicePaths: [servicePath], now: () => new Date('2026-09-08T00:00:00.000Z') });
    await value.initialize({ mode: 'company', realmId: 'acme', vaultPath });
    await value.createEmployee({ userId: binding.userId });
    await value.registerRuntime({ runtimeId: binding.runtimeId, kind: 'internal', certFingerprint: CERT_A });
    await expect(value.createInvite({ binding, expiresAt: '2026-09-08T01:00:00.000Z', secretFile: join(servicePath, 'invite') }))
      .rejects.toThrow(/outside.*protected/i);
  });

  test('rejects a registry path that enters the Vault through a junction', async () => {
    const junction = join(root, 'vault-junction');
    await symlink(vaultPath, junction, 'junction');
    expect(() => new EnterpriseRegistry({ registryPath: join(junction, 'enterprise.json'), vaultPath }))
      .toThrow(/outside.*Vault/i);
  });

  test('fails closed for corrupt, oversized, and invalid records', async () => {
    await mkdir(resolve(registryPath, '..'), { recursive: true });
    await writeFile(registryPath, '{broken');
    expect(() => registry().getPolicy()).toThrow(/corrupt/i);

    await writeFile(registryPath, ' '.repeat(1_100_000));
    expect(() => registry().getPolicy()).toThrow(/too large/i);

    await writeFile(registryPath, JSON.stringify({ version: 1, profile: { mode: 'company', realmId: 'acme', vaultPath }, employees: [{ userId: '../escape', active: true }], runtimes: [], invites: [], bindings: [], registrations: [], sessionLeases: [] }));
    expect(() => registry().getPolicy()).toThrow(/corrupt/i);
  });

  test('never removes an existing secret target or allows the registry itself as a secret file', async () => {
    const value = await initializedRegistry();
    const occupied = join(root, 'private', 'occupied.secret');
    await mkdir(resolve(occupied, '..'), { recursive: true });
    await writeFile(occupied, 'keep-me');
    await expect(value.createInvite({ binding, expiresAt: '2026-09-08T01:00:00.000Z', secretFile: occupied })).rejects.toThrow();
    expect(await readFile(occupied, 'utf8')).toBe('keep-me');

    await expect(value.createInvite({ binding, expiresAt: '2026-09-08T01:00:00.000Z', secretFile: registryPath })).rejects.toThrow(/registry/i);
    expect(value.getPolicy().realmId).toBe('acme');
  });
});

describe('policy, employees, and runtimes', () => {
  test('initializes one immutable realm/mode/vault profile and defaults shared memory off', async () => {
    const value = registry();
    await value.initialize({ mode: 'company', realmId: 'Acme', vaultPath });
    await value.initialize({ mode: 'company', realmId: 'acme', vaultPath });
    expect(value.getPolicy()).toMatchObject({ mode: 'company', realmId: 'acme', vaultPath: resolve(vaultPath) });

    await value.createEmployee({ userId: 'Employee-One' });
    expect(value.getEmployee('employee-one')).toMatchObject({ userId: 'employee-one', active: true, sharedMemoryEnabled: false });
    await expect(value.initialize({ mode: 'public', realmId: 'acme', vaultPath })).rejects.toThrow(/already initialized/i);
  });

  test('enforces runtime kind per mode, certificate uniqueness, and SHA-256 fingerprints', async () => {
    const company = registry();
    await company.initialize({ mode: 'company', realmId: 'acme', vaultPath });
    await expect(company.registerRuntime({ runtimeId: 'outside', kind: 'external', certFingerprint: CERT_A })).rejects.toThrow(/company.*internal/i);
    await expect(company.registerRuntime({ runtimeId: 'bad', kind: 'internal', certFingerprint: 'xyz' })).rejects.toThrow(/SHA-256/i);
    await company.registerRuntime({ runtimeId: 'inside', kind: 'internal', certFingerprint: CERT_A });
    await expect(company.registerRuntime({ runtimeId: 'duplicate-cert', kind: 'internal', certFingerprint: CERT_A })).rejects.toThrow(/certificate.*registered/i);

    const publicRoot = join(root, 'public-registry.json');
    const publicVault = join(root, 'public-vault'); await mkdir(publicVault);
    const publicRegistry = new EnterpriseRegistry({ registryPath: publicRoot, vaultPath: publicVault });
    await publicRegistry.initialize({ mode: 'public', realmId: 'public-realm', vaultPath: publicVault });
    await expect(publicRegistry.registerRuntime({ runtimeId: 'inside', kind: 'internal', certFingerprint: CERT_B })).rejects.toThrow(/public.*external/i);
  });
});

describe('verified employee departments', () => {
  test('legacy employees remain valid and internal runtimes confer no departments', async () => {
    const value = await initializedRegistry();
    const created = await invite(value);
    await value.redeemInvite(reservationInput(created.secret), async () => {});
    const employee = registry().getEmployee(binding.userId);
    expect(employee).not.toHaveProperty('departmentIds');
    expect(employee).not.toHaveProperty('defaultDepartmentId');
    expect(employee).not.toHaveProperty('departmentRevision');
    expect(registry().assertRegisteredBinding(binding).employee).toEqual(employee);
  });

  test('creates bounded verified memberships and persists an explicit member default', async () => {
    const value = registry();
    await value.initialize({ mode: 'company', realmId: 'acme', vaultPath });
    const departmentIds = ['a'.repeat(64), ...Array.from({ length: 31 }, (_, index) => `dept-${index}._x`)];
    const employee = await value.createEmployee({ userId: binding.userId, sharedMemoryEnabled: true,
      departmentIds, defaultDepartmentId: departmentIds[0]! });
    expect(employee).toMatchObject({ departmentIds, defaultDepartmentId: departmentIds[0], departmentRevision: 0 });
    expect(registry().getEmployee(binding.userId)).toEqual(employee);
    departmentIds.push('mutated-after-create');
    expect(employee.departmentIds).toHaveLength(32);
  });

  test('does not infer a default from a single membership and permits an explicit empty list', async () => {
    const value = await initializedRegistry();
    for (const departmentIds of [['engineering'], []]) {
      const userId = departmentIds.length ? 'member' : 'empty';
      const employee = await value.createEmployee({ userId, departmentIds });
      expect(employee).toMatchObject({ departmentIds, departmentRevision: 0 });
      expect(employee).not.toHaveProperty('defaultDepartmentId');
      expect(registry().getEmployee(userId)).toEqual(employee);
    }
  });

  const invalidDepartments = [
    { departmentIds: null }, { departmentIds: 'engineering' }, { departmentIds: [1] },
    { departmentIds: ['Engineering'] }, { departmentIds: [' engineering'] }, { departmentIds: ['engineering '] },
    { departmentIds: ['../engineering'] }, { departmentIds: ['a/b'] }, { departmentIds: ['a\\b'] },
    { departmentIds: ['аdmin'] }, { departmentIds: [''] }, { departmentIds: ['a\n'] },
    { departmentIds: ['a'.repeat(65)] }, { departmentIds: ['engineering', 'engineering'] },
    { departmentIds: Array.from({ length: 33 }, (_, index) => `dept-${index}`) },
    { defaultDepartmentId: 'engineering' }, { departmentIds: [], defaultDepartmentId: 'engineering' },
    { departmentIds: ['engineering'], defaultDepartmentId: 'finance' },
    { departmentIds: ['engineering'], defaultDepartmentId: null },
    { departmentIds: ['engineering'], defaultDepartmentId: 'Engineering' },
  ];

  test.each(invalidDepartments)('rejects explicit invalid department inputs %# without writing', async input => {
    const value = await initializedRegistry();
    const before = await readFile(registryPath, 'utf8');
    await expect(value.createEmployee({ userId: 'invalid', ...input } as Parameters<EnterpriseRegistry['createEmployee']>[0]))
      .rejects.toThrow(/department/i);
    expect(await readFile(registryPath, 'utf8')).toBe(before);
    await expect(value.updateEmployeeDepartments({ userId: binding.userId, expectedDepartmentRevision: 0,
      ...input } as Parameters<EnterpriseRegistry['updateEmployeeDepartments']>[0])).rejects.toThrow(/department/i);
    expect(await readFile(registryPath, 'utf8')).toBe(before);
  });

  test('changes and revokes departments across reloads, preserving other employee fields', async () => {
    const first = await initializedRegistry({ sharedMemoryEnabled: true });
    const original = await first.disableEmployee({ userId: binding.userId });
    const changed = await first.updateEmployeeDepartments({ userId: binding.userId,
      departmentIds: ['engineering', 'finance'], defaultDepartmentId: 'finance', expectedDepartmentRevision: 0 });
    expect(changed).toEqual({ ...original, departmentIds: ['engineering', 'finance'], defaultDepartmentId: 'finance', departmentRevision: 1 });
    const second = registry();
    expect(second.getEmployee(binding.userId)).toEqual(changed);
    const moved = await second.updateEmployeeDepartments({ userId: binding.userId,
      departmentIds: ['operations'], expectedDepartmentRevision: 1 });
    expect(moved).toEqual({ ...original, departmentIds: ['operations'], departmentRevision: 2 });
    const revoked = await registry().updateEmployeeDepartments({ userId: binding.userId, departmentIds: [], expectedDepartmentRevision: 2 });
    expect(revoked).toEqual({ ...original, departmentIds: [], departmentRevision: 3 });
    expect(registry().getEmployee(binding.userId)).toEqual(revoked);
  });

  test('fresh binding checks expose host memberships and ignore client self-grants', async () => {
    const value = await initializedRegistry();
    const created = await invite(value);
    await value.redeemInvite(reservationInput(created.secret, {
      departmentIds: ['spoofed'], defaultDepartmentId: 'spoofed', departmentRevision: 999,
      binding: { ...binding, departmentIds: ['spoofed'] },
    }), async () => {});
    expect(value.getEmployee(binding.userId)).not.toHaveProperty('departmentIds');
    const changed = await value.updateEmployeeDepartments({ userId: binding.userId,
      departmentIds: ['engineering'], defaultDepartmentId: 'engineering', expectedDepartmentRevision: 0 });
    const asserted = registry().assertBinding({ ...binding, realmId: 'acme', mode: 'company', certFingerprint: CERT_A });
    expect(asserted.employee).toEqual(changed);
    expect(asserted.binding).not.toHaveProperty('departmentIds');
    await value.updateEmployeeDepartments({ userId: binding.userId, departmentIds: [], expectedDepartmentRevision: 1 });
    expect(registry().assertRegisteredBinding(binding).employee).toMatchObject({ departmentIds: [], departmentRevision: 2 });
  });

  test('rejects stale updates before writing', async () => {
    const value = await initializedRegistry();
    await value.updateEmployeeDepartments({ userId: binding.userId, departmentIds: ['engineering'], expectedDepartmentRevision: 0 });
    const before = await readFile(registryPath, 'utf8');
    await expect(registry().updateEmployeeDepartments({ userId: binding.userId, departmentIds: [], expectedDepartmentRevision: 0 }))
      .rejects.toThrow(/stale.*department.*revision/i);
    expect(await readFile(registryPath, 'utf8')).toBe(before);
  });

  test('only one concurrent update wins across independent registry instances', async () => {
    const first = await initializedRegistry();
    const outcomes = await Promise.allSettled([first, registry()].map((value, index) => value.updateEmployeeDepartments({
      userId: binding.userId, departmentIds: [`dept-${index}`], expectedDepartmentRevision: 0,
    })));
    const successes = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const failures = outcomes.filter(outcome => outcome.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason.message).toMatch(/stale.*department.*revision/i);
    expect(registry().getEmployee(binding.userId)).toEqual(successes[0]!.value);
    expect(successes[0]!.value.departmentRevision).toBe(1);
  });

  test.each([undefined, null, -1, 0.5, '0', Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid expected revision %s', async revision => {
    const value = await initializedRegistry();
    const before = await readFile(registryPath, 'utf8');
    await expect(value.updateEmployeeDepartments({ userId: binding.userId, departmentIds: [],
      expectedDepartmentRevision: revision as number })).rejects.toThrow(/revision/i);
    expect(await readFile(registryPath, 'utf8')).toBe(before);
  });

  test('rejects unknown employees without writing', async () => {
    const value = await initializedRegistry();
    const before = await readFile(registryPath, 'utf8');
    await expect(value.updateEmployeeDepartments({ userId: 'missing', departmentIds: [], expectedDepartmentRevision: 0 }))
      .rejects.toThrow(/unknown.*employee/i);
    expect(await readFile(registryPath, 'utf8')).toBe(before);
  });

  test.each([
    ...invalidDepartments, { departmentRevision: null }, { departmentRevision: -1 }, { departmentRevision: '0' },
    { departmentRevision: 0.5 }, { departmentRevision: Number.MAX_SAFE_INTEGER + 1 },
  ])('fails closed for invalid persisted department metadata %#', async input => {
    await initializedRegistry();
    const database = JSON.parse(await readFile(registryPath, 'utf8'));
    Object.assign(database.employees[0], input);
    await writeFile(registryPath, JSON.stringify(database));
    expect(() => registry().getEmployee(binding.userId)).toThrow(/corrupt/i);
  });

  test('does not overflow the persisted revision', async () => {
    const value = await initializedRegistry();
    const database = JSON.parse(await readFile(registryPath, 'utf8'));
    database.employees[0].departmentRevision = Number.MAX_SAFE_INTEGER;
    await writeFile(registryPath, JSON.stringify(database));
    const before = await readFile(registryPath, 'utf8');
    await expect(value.updateEmployeeDepartments({ userId: binding.userId, departmentIds: [], expectedDepartmentRevision: Number.MAX_SAFE_INTEGER }))
      .rejects.toThrow(/revision/i);
    expect(await readFile(registryPath, 'utf8')).toBe(before);
  });

  test('public mode rejects company grants and department updates', async () => {
    const value = registry();
    await value.initialize({ mode: 'public', realmId: 'public-realm', vaultPath });
    await value.createEmployee({ userId: binding.userId });
    const before = await readFile(registryPath, 'utf8');
    await expect(value.createEmployee({ userId: 'company-employee', departmentIds: ['engineering'] })).rejects.toThrow(/company|public/i);
    await expect(value.updateEmployeeDepartments({ userId: binding.userId, departmentIds: ['engineering'], expectedDepartmentRevision: 0 }))
      .rejects.toThrow(/company|public/i);
    await expect(value.updateEmployeeDepartments({ userId: binding.userId, departmentIds: [], expectedDepartmentRevision: 0 }))
      .rejects.toThrow(/company|public/i);
    expect(await readFile(registryPath, 'utf8')).toBe(before);
    const database = JSON.parse(before);
    database.employees[0].departmentIds = ['engineering'];
    await writeFile(registryPath, JSON.stringify(database));
    expect(() => registry().getEmployee(binding.userId)).toThrow(/corrupt/i);
  });
});

describe('invite registration', () => {
  test('writes the one-use secret only to the explicit private file and never returns it', async () => {
    const value = await initializedRegistry({ sharedMemoryEnabled: true });
    const created = await invite(value);
    expect(created.secret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(created).not.toHaveProperty('inviteSecret');
    expect(created).not.toHaveProperty('secretValue');
    expect(value.getEmployee(binding.userId)?.sharedMemoryEnabled).toBe(true);
  });

  test('rejects self-assigned identity injection, invalid certificates, and wrong realm or mode', async () => {
    const value = await initializedRegistry();
    const created = await invite(value);
    await expect(value.reserveInvite(reservationInput(created.secret, { binding: { ...binding, userId: 'attacker' } }))).rejects.toThrow(/predetermined/i);
    await expect(value.reserveInvite(reservationInput(created.secret, { certFingerprint: CERT_B }))).rejects.toThrow(/certificate/i);
    await expect(value.reserveInvite(reservationInput(created.secret, { realmId: 'other' }))).rejects.toThrow(/realm/i);
    await expect(value.reserveInvite(reservationInput(created.secret, { mode: 'public' }))).rejects.toThrow(/mode/i);
  });

  test('rejects revoked employees and runtimes before reserving or authenticating', async () => {
    const employeeRegistry = await initializedRegistry();
    const employeeInvite = await invite(employeeRegistry);
    await employeeRegistry.disableEmployee({ userId: binding.userId });
    await expect(employeeRegistry.reserveInvite(reservationInput(employeeInvite.secret))).rejects.toThrow(/employee.*disabled/i);

    await rm(secretPath, { force: true });
    const runtimeRegistryPath = join(root, 'runtime-policy', 'enterprise.json');
    registryPath = runtimeRegistryPath;
    const runtimeRegistry = await initializedRegistry();
    const runtimeInvite = await invite(runtimeRegistry);
    await runtimeRegistry.disableRuntime({ runtimeId: binding.runtimeId });
    await expect(runtimeRegistry.reserveInvite(reservationInput(runtimeInvite.secret))).rejects.toThrow(/runtime.*disabled/i);
  });

  test('reserves durably, retries an interrupted callback with the same registration, and completes once', async () => {
    const value = await initializedRegistry();
    const created = await invite(value);
    const calls: string[] = [];
    await expect(value.redeemInvite(reservationInput(created.secret), async (_binding, registrationId) => {
      calls.push(registrationId);
      throw new Error('simulated interruption');
    })).rejects.toThrow('simulated interruption');

    const completed = await value.redeemInvite(reservationInput(created.secret), async (reservedBinding, registrationId) => {
      calls.push(registrationId);
      expect(reservedBinding).toEqual(binding);
    });
    expect(calls[0]).toBe(calls[1]);
    expect(completed.registrationId).toBe(calls[0]);
    expect(value.getBinding(binding.accountId)).toEqual(binding);

    const retry = await value.completeInvite({ registrationId: completed.registrationId });
    expect(retry).toEqual(completed);
    await expect(value.reserveInvite(reservationInput(created.secret, { binding: { ...binding, accountId: 'another' } }))).rejects.toThrow(/used|predetermined/i);
  });

  test('serializes concurrent mutations across registry instances', async () => {
    const first = registry();
    await first.initialize({ mode: 'company', realmId: 'acme', vaultPath });
    const second = registry();
    await Promise.all([
      first.createEmployee({ userId: 'employee-a' }),
      second.createEmployee({ userId: 'employee-b' }),
    ]);
    expect(first.getEmployee('employee-a')?.active).toBe(true);
    expect(first.getEmployee('employee-b')?.active).toBe(true);
  });
});

describe('fresh authorization decisions and session leases', () => {
  test('maps request certificates and asserts the exact active binding from fresh policy', async () => {
    const value = await initializedRegistry({ sharedMemoryEnabled: true });
    const created = await invite(value);
    const reserved = await value.reserveInvite(reservationInput(created.secret));
    await value.completeInvite({ registrationId: reserved.registrationId });

    expect(value.resolveRequestCertificate(CERT_A)).toMatchObject({ runtimeId: binding.runtimeId, active: true });
    expect(value.assertRegisteredBinding(binding)).toMatchObject({ binding, employee: { userId: binding.userId }, runtime: { runtimeId: binding.runtimeId } });
    const { displayLabel: _displayLabel, role: _role, ...clientIdentity } = binding;
    expect(value.assertBinding({ ...clientIdentity, realmId: 'acme', mode: 'company', certFingerprint: CERT_A }))
      .toMatchObject({ binding, employee: { sharedMemoryEnabled: true }, runtime: { runtimeId: binding.runtimeId }, policy: { realmId: 'acme' } });

    await value.disableRuntime({ runtimeId: binding.runtimeId });
    expect(() => value.assertRegisteredBinding(binding)).toThrow(/runtime.*disabled/i);
    expect(() => value.assertBinding({ ...clientIdentity, realmId: 'acme', mode: 'company', certFingerprint: CERT_A })).toThrow(/runtime.*disabled/i);
  });

  test('uses persistent generation CAS so one agent session is the writer', async () => {
    const first = await initializedRegistry();
    expect(first.getSessionLease(binding.agentId)).toBeUndefined();
    expect(first.getSessionGeneration(binding.agentId)).toBe(0);
    const claimed = await first.claimSessionLease({ agentId: binding.agentId, sessionId: 'session-a', expectedGeneration: 0, expiresAt: '2026-09-08T00:30:00.000Z' });
    expect(claimed).toMatchObject({ agentId: binding.agentId, sessionId: 'session-a', generation: 1 });

    const second = registry();
    await expect(second.claimSessionLease({ agentId: binding.agentId, sessionId: 'session-b', expectedGeneration: 0, expiresAt: '2026-09-08T00:30:00.000Z' })).rejects.toThrow(/stale.*generation/i);
    expect(second.assertSessionLease({ agentId: binding.agentId, sessionId: 'session-a', generation: 1 })).toEqual(claimed);

    const released = await first.releaseSessionLease({ agentId: binding.agentId, sessionId: 'session-a', expectedGeneration: 1 });
    expect(released.generation).toBe(2);
    expect(first.getSessionLease(binding.agentId)).toBeUndefined();
    expect(first.getSessionGeneration(binding.agentId)).toBe(2);
  });
});

describe('enterprise administrator CLI', () => {
  test('migration preview is bounded, omits authentication material, and does not change files', async () => {
    const accountsPath = join(root, 'scope-auth.json');
    const body = `${JSON.stringify({
      version: 1,
      accounts: [{ accountId: 'acct-one', agentId: 'agent-one', userId: 'employee-one', modelId: 'codex', role: 'agent', salt: 'secret-salt', passwordHash: 'secret-hash', createdAt: '2026-09-08T00:00:00.000Z' }],
    })}\n`;
    await writeFile(accountsPath, body);
    const preview = previewAccountMigration(accountsPath);
    expect(preview).toEqual({ total: 1, shown: 1, truncated: false, accounts: [{ accountId: 'acct-one', agentId: 'agent-one', userId: 'employee-one', modelId: 'codex', role: 'agent' }] });
    expect(JSON.stringify(preview)).not.toMatch(/salt|hash/i);
    expect(await readFile(accountsPath, 'utf8')).toBe(body);
  });

  test('memory-preview inventories legacy memory without changing or assigning ownership', async () => {
    const legacyPath = join(vaultPath, '_scopes', 'users', 'legacy-user', 'Memory.md');
    await mkdir(resolve(legacyPath, '..'), { recursive: true });
    await writeFile(legacyPath, '# private legacy memory\n');
    const output: string[] = [];
    const exitCode = await runEnterpriseAdmin([
      'memory-preview', '--vault', vaultPath, '--limit', '10',
    ], { stdout: value => output.push(value), stderr: value => output.push(`error:${value}`) });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output.join('\n'))).toMatchObject({
      automaticMigration: false,
      entries: [{ scope: 'user', identity: 'legacy-user', disposition: 'keep-host-private' }],
    });
    expect(await readFile(legacyPath, 'utf8')).toBe('# private legacy memory\n');
  });

  test('invite-create prints metadata but never prints the generated secret', async () => {
    const value = await initializedRegistry();
    void value;
    const output: string[] = [];
    const exitCode = await runEnterpriseAdmin([
      'invite-create', '--registry', registryPath, '--vault', vaultPath,
      '--account', binding.accountId, '--agent', binding.agentId, '--user', binding.userId,
      '--model', binding.modelId, '--runtime', binding.runtimeId,
      '--expires-at', '2026-09-08T01:00:00.000Z', '--secret-file', secretPath,
    ], { stdout: value => output.push(value), stderr: value => output.push(`error:${value}`), now: () => new Date('2026-09-08T00:00:00.000Z') });
    expect(exitCode).toBe(0);
    const secret = (await readFile(secretPath, 'utf8')).trim();
    expect(output.join('\n')).not.toContain(secret);
    expect(JSON.parse(output.join('\n'))).toMatchObject({ secretFile: resolve(secretPath) });
  });
});

 test('account revocation invalidates its lease and prevents identity reassignment', async () => {
  const value = await initializedRegistry();
  const issued = await invite(value);
  const reservation = await value.reserveInvite(reservationInput(issued.secret));
  await value.completeInvite({ registrationId: reservation.registrationId });
  await value.claimSessionLease({ agentId: binding.agentId, sessionId: 'old-session', expectedGeneration: 0, expiresAt: '2026-09-08T00:30:00.000Z' });
  await value.disableAccount({ accountId: binding.accountId });
  expect(value.getBinding(binding.accountId)).toBeUndefined();
  expect(() => value.assertRegisteredBinding(binding)).toThrow(/binding/);
  expect(value.getSessionLease(binding.agentId)).toBeUndefined();
  await expect(value.createInvite({ binding, expiresAt: '2026-09-08T01:00:00.000Z', secretFile: join(root, 'new-secret') })).rejects.toThrow(/reassigned/);
  await expect(value.disableAccount({ accountId: binding.accountId })).resolves.toMatchObject({ disabled: true });
});
