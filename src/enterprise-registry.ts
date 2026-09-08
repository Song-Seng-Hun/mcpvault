import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { chmod, mkdir, open as openFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeScopeId } from './scopes.js';
import { ensureEnterpriseVaultMarker } from './enterprise-vault-marker.js';

const REGISTRY_VERSION = 1;
const MAX_DATABASE_BYTES = 1_048_576;
const MAX_ENTRIES = 4_096;
const MAX_TEXT_LENGTH = 128;
const LOCK_ATTEMPTS = 500;
const LOCK_WAIT_MS = 10;
const CERTIFICATE_PATTERN = /^[a-f0-9]{64}$/;

export type EnterpriseMode = 'public' | 'company';
export type RuntimeKind = 'external' | 'internal';

export interface EnterpriseProfile {
  mode: EnterpriseMode;
  realmId: string;
  vaultPath: string;
}

export interface EnterpriseEmployee {
  userId: string;
  active: boolean;
  sharedMemoryEnabled: boolean;
  createdAt: string;
  disabledAt?: string;
}

export interface EnterpriseRuntime {
  runtimeId: string;
  kind: RuntimeKind;
  certFingerprint: string;
  active: boolean;
  createdAt: string;
  disabledAt?: string;
}

export interface EnterpriseBinding {
  accountId: string;
  agentId: string;
  userId: string;
  modelId: string;
  runtimeId: string;
  displayLabel?: string;
  role?: string;
}

export interface EnterpriseSessionLease {
  agentId: string;
  sessionId: string;
  generation: number;
  expiresAt: string;
}

interface StoredInvite {
  inviteId: string;
  secretHash: string;
  binding: EnterpriseBinding;
  expiresAt: string;
  createdAt: string;
  registrationId?: string;
  consumedAt?: string;
}

interface RegistrationRecord {
  registrationId: string;
  inviteId: string;
  binding: EnterpriseBinding;
  status: 'reserved' | 'completed';
  createdAt: string;
  completedAt?: string;
}

interface SessionLeaseRecord {
  agentId: string;
  generation: number;
  sessionId?: string;
  expiresAt?: string;
}

interface EnterpriseDatabase {
  version: 1;
  profile: EnterpriseProfile;
  employees: EnterpriseEmployee[];
  runtimes: EnterpriseRuntime[];
  invites: StoredInvite[];
  bindings: EnterpriseBinding[];
  registrations: RegistrationRecord[];
  sessionLeases: SessionLeaseRecord[];
}

interface RegistryLock {
  handle: FileHandle;
  nonce: string;
}

export interface EnterpriseRegistryOptions {
  registryPath: string;
  vaultPath: string;
  servicePaths?: string[];
  now?: () => Date;
}

export interface ReserveInviteInput {
  secret: string;
  realmId: string;
  mode: EnterpriseMode;
  runtimeId: string;
  certFingerprint: string;
  binding?: EnterpriseBinding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalPath(value: string): string {
  let existing = resolve(value);
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(value);
    suffix.unshift(basename(existing));
    existing = parent;
  }
  try { return resolve(realpathSync.native(existing), ...suffix); }
  catch { return resolve(value); }
}

function isPathInside(parent: string, target: string): boolean {
  const parentPath = canonicalPath(parent).toLowerCase();
  const targetPath = canonicalPath(target).toLowerCase();
  const child = relative(parentPath, targetPath);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function assertOutside(path: string, protectedPaths: readonly string[], label: string): void {
  if (!isAbsolute(path)) throw new Error(`${label} must be an explicit absolute path`);
  if (protectedPaths.some(protectedPath => isPathInside(protectedPath, path))) {
    throw new Error(`${label} must be outside the Vault and all protected service directories`);
  }
}

function normalizeCertificate(value: unknown): string {
  const fingerprint = String(value || '').trim().toLowerCase().replaceAll(':', '');
  if (!CERTIFICATE_PATTERN.test(fingerprint)) throw new Error('certFingerprint must be a 64-character SHA-256 fingerprint');
  return fingerprint;
}

function normalizeOptionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_TEXT_LENGTH) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`);
  }
  return value.trim();
}

function normalizeBinding(value: EnterpriseBinding): EnterpriseBinding {
  if (!isRecord(value)) throw new Error('binding is required');
  const displayLabel = normalizeOptionalText(value.displayLabel, 'displayLabel');
  const role = normalizeOptionalText(value.role, 'role');
  return {
    accountId: normalizeScopeId(String(value.accountId || ''), 'accountId'),
    agentId: normalizeScopeId(String(value.agentId || ''), 'agentId'),
    userId: normalizeScopeId(String(value.userId || ''), 'userId'),
    modelId: normalizeScopeId(String(value.modelId || ''), 'modelId'),
    runtimeId: normalizeScopeId(String(value.runtimeId || ''), 'runtimeId'),
    ...(displayLabel && { displayLabel }),
    ...(role && { role }),
  };
}

function sameBinding(left: EnterpriseBinding, right: EnterpriseBinding): boolean {
  return left.accountId === right.accountId
    && left.agentId === right.agentId
    && left.userId === right.userId
    && left.modelId === right.modelId
    && left.runtimeId === right.runtimeId
    && left.displayLabel === right.displayLabel
    && left.role === right.role;
}

function sameBindingIdentity(left: EnterpriseBinding, right: EnterpriseBinding): boolean {
  return left.accountId === right.accountId
    && left.agentId === right.agentId
    && left.userId === right.userId
    && left.modelId === right.modelId
    && left.runtimeId === right.runtimeId;
}

function parseTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(isRecord(error) && error.code === 'ESRCH');
  }
}

function entryCapacity(database: EnterpriseDatabase, key: keyof Pick<EnterpriseDatabase, 'employees' | 'runtimes' | 'invites' | 'bindings' | 'registrations' | 'sessionLeases'>): void {
  if (database[key].length >= MAX_ENTRIES) throw new Error(`${key} capacity reached (${MAX_ENTRIES})`);
}

function validateDatabase(value: unknown, expectedVaultPath: string): EnterpriseDatabase {
  if (!isRecord(value) || value.version !== REGISTRY_VERSION || !isRecord(value.profile)) throw new Error('corrupt enterprise registry');
  const profile: EnterpriseProfile = {
    mode: value.profile.mode === 'public' || value.profile.mode === 'company' ? value.profile.mode : (() => { throw new Error('corrupt enterprise registry'); })(),
    realmId: normalizeScopeId(String(value.profile.realmId || ''), 'realmId'),
    vaultPath: canonicalPath(String(value.profile.vaultPath || '')),
  };
  if (profile.vaultPath.toLowerCase() !== canonicalPath(expectedVaultPath).toLowerCase()) throw new Error('enterprise registry belongs to a different Vault');
  const employeesRaw = value.employees;
  const runtimesRaw = value.runtimes;
  const invitesRaw = value.invites;
  const bindingsRaw = value.bindings;
  const registrationsRaw = value.registrations;
  const sessionLeasesRaw = value.sessionLeases;
  if (!Array.isArray(employeesRaw) || employeesRaw.length > MAX_ENTRIES
    || !Array.isArray(runtimesRaw) || runtimesRaw.length > MAX_ENTRIES
    || !Array.isArray(invitesRaw) || invitesRaw.length > MAX_ENTRIES
    || !Array.isArray(bindingsRaw) || bindingsRaw.length > MAX_ENTRIES
    || !Array.isArray(registrationsRaw) || registrationsRaw.length > MAX_ENTRIES
    || !Array.isArray(sessionLeasesRaw) || sessionLeasesRaw.length > MAX_ENTRIES) throw new Error('corrupt enterprise registry');
  try {
    const employees = employeesRaw.map((item: unknown) => {
      if (!isRecord(item) || typeof item.active !== 'boolean' || typeof item.sharedMemoryEnabled !== 'boolean') throw new Error();
      return {
        userId: normalizeScopeId(String(item.userId || ''), 'userId'), active: item.active, sharedMemoryEnabled: item.sharedMemoryEnabled,
        createdAt: parseTimestamp(item.createdAt, 'createdAt'),
        ...(item.disabledAt !== undefined && { disabledAt: parseTimestamp(item.disabledAt, 'disabledAt') }),
      } satisfies EnterpriseEmployee;
    });
    const runtimes = runtimesRaw.map((item: unknown) => {
      if (!isRecord(item) || (item.kind !== 'external' && item.kind !== 'internal') || typeof item.active !== 'boolean') throw new Error();
      return {
        runtimeId: normalizeScopeId(String(item.runtimeId || ''), 'runtimeId'), kind: item.kind,
        certFingerprint: normalizeCertificate(item.certFingerprint), active: item.active,
        createdAt: parseTimestamp(item.createdAt, 'createdAt'),
        ...(item.disabledAt !== undefined && { disabledAt: parseTimestamp(item.disabledAt, 'disabledAt') }),
      } satisfies EnterpriseRuntime;
    });
    const bindings = bindingsRaw.map((item: unknown) => normalizeBinding(item as EnterpriseBinding));
    const invites = invitesRaw.map((item: unknown) => {
      if (!isRecord(item) || !/^[a-f0-9]{64}$/.test(String(item.secretHash || ''))) throw new Error();
      return {
        inviteId: normalizeScopeId(String(item.inviteId || ''), 'inviteId'), secretHash: String(item.secretHash),
        binding: normalizeBinding(item.binding as unknown as EnterpriseBinding), expiresAt: parseTimestamp(item.expiresAt, 'expiresAt'),
        createdAt: parseTimestamp(item.createdAt, 'createdAt'),
        ...(item.registrationId !== undefined && { registrationId: normalizeScopeId(String(item.registrationId), 'registrationId') }),
        ...(item.consumedAt !== undefined && { consumedAt: parseTimestamp(item.consumedAt, 'consumedAt') }),
      } satisfies StoredInvite;
    });
    const registrations = registrationsRaw.map((item: unknown) => {
      if (!isRecord(item) || (item.status !== 'reserved' && item.status !== 'completed')) throw new Error();
      return {
        registrationId: normalizeScopeId(String(item.registrationId || ''), 'registrationId'), inviteId: normalizeScopeId(String(item.inviteId || ''), 'inviteId'),
        binding: normalizeBinding(item.binding as unknown as EnterpriseBinding), status: item.status,
        createdAt: parseTimestamp(item.createdAt, 'createdAt'),
        ...(item.completedAt !== undefined && { completedAt: parseTimestamp(item.completedAt, 'completedAt') }),
      } satisfies RegistrationRecord;
    });
    const sessionLeases = sessionLeasesRaw.map((item: unknown) => {
      if (!isRecord(item) || !Number.isSafeInteger(item.generation) || Number(item.generation) < 0) throw new Error();
      const sessionId = normalizeOptionalText(item.sessionId, 'sessionId');
      const expiresAt = item.expiresAt === undefined ? undefined : parseTimestamp(item.expiresAt, 'expiresAt');
      if (Boolean(sessionId) !== Boolean(expiresAt)) throw new Error();
      return {
        agentId: normalizeScopeId(String(item.agentId || ''), 'agentId'), generation: Number(item.generation),
        ...(sessionId && { sessionId }), ...(expiresAt && { expiresAt }),
      } satisfies SessionLeaseRecord;
    });
    const unique = <T>(items: T[], select: (item: T) => string) => new Set(items.map(select)).size === items.length;
    if (!unique(employees, item => item.userId) || !unique(runtimes, item => item.runtimeId) || !unique(runtimes, item => item.certFingerprint)
      || !unique(invites, item => item.inviteId) || !unique(bindings, item => item.accountId) || !unique(bindings, item => item.agentId)
      || !unique(registrations, item => item.registrationId) || !unique(sessionLeases, item => item.agentId)) throw new Error();
    if (runtimes.some(runtime => profile.mode === 'company' ? runtime.kind !== 'internal' : runtime.kind !== 'external')) throw new Error();
    return { version: 1, profile, employees, runtimes, invites, bindings, registrations, sessionLeases };
  } catch (error) {
    if (error instanceof Error && error.message === 'enterprise registry belongs to a different Vault') throw error;
    throw new Error('corrupt enterprise registry');
  }
}

export class EnterpriseRegistry {
  readonly registryPath: string;
  private readonly lockPath: string;
  private readonly vaultPath: string;
  private readonly protectedPaths: string[];
  private readonly now: () => Date;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: EnterpriseRegistryOptions) {
    if (!options || typeof options.registryPath !== 'string' || typeof options.vaultPath !== 'string') throw new Error('registryPath and vaultPath are required');
    this.vaultPath = canonicalPath(options.vaultPath);
    const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const packageRoot = basename(moduleRoot) === 'dist' ? dirname(moduleRoot) : moduleRoot;
    this.protectedPaths = [this.vaultPath, canonicalPath(packageRoot), ...(options.servicePaths || []).map(canonicalPath)];
    assertOutside(options.registryPath, this.protectedPaths, 'Enterprise registry path');
    this.registryPath = canonicalPath(options.registryPath);
    this.lockPath = `${this.registryPath}.lock`;
    this.now = options.now || (() => new Date());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private readDatabase(): EnterpriseDatabase {
    let size: number;
    try { size = statSync(this.registryPath).size; } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') throw new Error('Enterprise registry is not initialized');
      throw error;
    }
    if (size > MAX_DATABASE_BYTES) throw new Error('Enterprise registry is too large; refusing to read it');
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(this.registryPath, 'utf8')); } catch { throw new Error('corrupt enterprise registry'); }
    return validateDatabase(parsed, this.vaultPath);
  }

  private async writeDatabase(database: EnterpriseDatabase): Promise<void> {
    const body = `${JSON.stringify(database, null, 2)}\n`;
    if (Buffer.byteLength(body) > MAX_DATABASE_BYTES) throw new Error('Enterprise registry is too large; refusing to write it');
    await mkdir(dirname(this.registryPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.registryPath}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, this.registryPath);
      await Promise.allSettled([chmod(dirname(this.registryPath), 0o700), chmod(this.registryPath, 0o600)]);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async acquireLock(): Promise<RegistryLock> {
    await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
      const nonce = randomBytes(16).toString('hex');
      try {
        const handle = await openFile(this.lockPath, 'wx');
        try {
          await handle.writeFile(`${JSON.stringify({ pid: process.pid, nonce })}\n`, 'utf8');
          await handle.sync();
        } catch (error) {
          await handle.close().catch(() => undefined);
          await unlink(this.lockPath).catch(() => undefined);
          throw error;
        }
        return { handle, nonce };
      } catch (error) {
        if (!(isRecord(error) && error.code === 'EEXIST')) throw error;
        let record: unknown;
        try { record = JSON.parse(await readFile(this.lockPath, 'utf8')); } catch (readError) {
          if (isRecord(readError) && readError.code === 'ENOENT') continue;
          throw new Error('Enterprise registry lock is corrupt; refusing to remove it automatically');
        }
        if (!isRecord(record) || !Number.isSafeInteger(record.pid) || Number(record.pid) <= 0 || typeof record.nonce !== 'string' || !record.nonce) {
          throw new Error('Enterprise registry lock is invalid; refusing to remove it automatically');
        }
        if (!processIsAlive(Number(record.pid))) { await unlink(this.lockPath); continue; }
        await sleep(LOCK_WAIT_MS);
      }
    }
    throw new Error('Unable to acquire enterprise registry lock');
  }

  private async releaseLock(lock: RegistryLock): Promise<void> {
    await lock.handle.close().catch(() => undefined);
    try {
      const record = JSON.parse(await readFile(this.lockPath, 'utf8')) as Record<string, unknown>;
      if (record.nonce === lock.nonce) await unlink(this.lockPath);
    } catch (error) {
      if (!(isRecord(error) && error.code === 'ENOENT')) throw error;
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    let releaseQueue!: () => void;
    const previous = this.mutationQueue;
    this.mutationQueue = new Promise<void>(resolvePromise => { releaseQueue = resolvePromise; });
    await previous;
    let lock: RegistryLock | undefined;
    try {
      lock = await this.acquireLock();
      return await operation();
    } finally {
      if (lock) await this.releaseLock(lock).catch(() => undefined);
      releaseQueue();
    }
  }

  private assertRuntimeMode(profile: EnterpriseProfile, kind: RuntimeKind): void {
    if (profile.mode === 'company' && kind !== 'internal') throw new Error('Company mode permits internal runtimes only');
    if (profile.mode === 'public' && kind !== 'external') throw new Error('Public mode permits external runtimes only');
  }

  private assertActive(database: EnterpriseDatabase, binding: EnterpriseBinding, certFingerprint: string): { employee: EnterpriseEmployee; runtime: EnterpriseRuntime } {
    const employee = database.employees.find(item => item.userId === binding.userId);
    if (!employee) throw new Error(`Unknown enterprise employee: ${binding.userId}`);
    if (!employee.active) throw new Error(`Enterprise employee is disabled: ${binding.userId}`);
    const runtime = database.runtimes.find(item => item.runtimeId === binding.runtimeId);
    if (!runtime) throw new Error(`Unknown enterprise runtime: ${binding.runtimeId}`);
    if (!runtime.active) throw new Error(`Enterprise runtime is disabled: ${binding.runtimeId}`);
    if (runtime.certFingerprint !== certFingerprint) throw new Error('Request certificate does not match the assigned runtime');
    this.assertRuntimeMode(database.profile, runtime.kind);
    return { employee, runtime };
  }

  async initialize(profileInput: EnterpriseProfile): Promise<EnterpriseProfile> {
    const profile: EnterpriseProfile = {
      mode: profileInput.mode,
      realmId: normalizeScopeId(profileInput.realmId, 'realmId'),
      vaultPath: canonicalPath(profileInput.vaultPath),
    };
    if (profile.mode !== 'public' && profile.mode !== 'company') throw new Error('mode must be public or company');
    if (profile.vaultPath.toLowerCase() !== this.vaultPath.toLowerCase()) throw new Error('profile vaultPath must match the configured Vault');
    return await this.exclusive(async () => {
      if (existsSync(this.registryPath)) {
        const existing = this.readDatabase().profile;
        if (existing.mode === profile.mode && existing.realmId === profile.realmId && existing.vaultPath.toLowerCase() === profile.vaultPath.toLowerCase()) {
          await ensureEnterpriseVaultMarker(this.vaultPath, profile);
          return existing;
        }
        throw new Error('Enterprise registry is already initialized with a different profile');
      }
      await ensureEnterpriseVaultMarker(this.vaultPath, profile);
      await this.writeDatabase({ version: 1, profile, employees: [], runtimes: [], invites: [], bindings: [], registrations: [], sessionLeases: [] });
      return profile;
    });
  }

  getPolicy(): EnterpriseProfile {
    return this.readDatabase().profile;
  }

  getEmployee(userIdInput: string): EnterpriseEmployee | undefined {
    const userId = normalizeScopeId(userIdInput, 'userId');
    return this.readDatabase().employees.find(item => item.userId === userId);
  }

  async createEmployee(params: { userId: string; sharedMemoryEnabled?: boolean }): Promise<EnterpriseEmployee> {
    const userId = normalizeScopeId(params.userId, 'userId');
    if (params.sharedMemoryEnabled !== undefined && typeof params.sharedMemoryEnabled !== 'boolean') throw new Error('sharedMemoryEnabled must be boolean');
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      entryCapacity(database, 'employees');
      if (database.employees.some(item => item.userId === userId)) throw new Error(`Enterprise employee already exists: ${userId}`);
      const employee: EnterpriseEmployee = { userId, active: true, sharedMemoryEnabled: params.sharedMemoryEnabled === true, createdAt: this.timestamp() };
      await this.writeDatabase({ ...database, employees: [...database.employees, employee] });
      return employee;
    });
  }

  async disableEmployee(params: { userId: string }): Promise<EnterpriseEmployee> {
    const userId = normalizeScopeId(params.userId, 'userId');
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      const employee = database.employees.find(item => item.userId === userId);
      if (!employee) throw new Error(`Unknown enterprise employee: ${userId}`);
      const disabled: EnterpriseEmployee = employee.active ? { ...employee, active: false, disabledAt: this.timestamp() } : employee;
      await this.writeDatabase({ ...database, employees: database.employees.map(item => item.userId === userId ? disabled : item) });
      return disabled;
    });
  }

  async registerRuntime(params: { runtimeId: string; kind: RuntimeKind; certFingerprint: string }): Promise<EnterpriseRuntime> {
    const runtimeId = normalizeScopeId(params.runtimeId, 'runtimeId');
    const fingerprint = normalizeCertificate(params.certFingerprint);
    if (params.kind !== 'internal' && params.kind !== 'external') throw new Error('runtime kind must be internal or external');
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      this.assertRuntimeMode(database.profile, params.kind);
      entryCapacity(database, 'runtimes');
      if (database.runtimes.some(item => item.runtimeId === runtimeId)) throw new Error(`Enterprise runtime already exists: ${runtimeId}`);
      if (database.runtimes.some(item => item.certFingerprint === fingerprint)) throw new Error('Request certificate is already registered to another runtime');
      const runtime: EnterpriseRuntime = { runtimeId, kind: params.kind, certFingerprint: fingerprint, active: true, createdAt: this.timestamp() };
      await this.writeDatabase({ ...database, runtimes: [...database.runtimes, runtime] });
      return runtime;
    });
  }

  async disableRuntime(params: { runtimeId: string }): Promise<EnterpriseRuntime> {
    const runtimeId = normalizeScopeId(params.runtimeId, 'runtimeId');
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      const runtime = database.runtimes.find(item => item.runtimeId === runtimeId);
      if (!runtime) throw new Error(`Unknown enterprise runtime: ${runtimeId}`);
      const disabled: EnterpriseRuntime = runtime.active ? { ...runtime, active: false, disabledAt: this.timestamp() } : runtime;
      await this.writeDatabase({ ...database, runtimes: database.runtimes.map(item => item.runtimeId === runtimeId ? disabled : item) });
      return disabled;
    });
  }

  async createInvite(params: { binding: EnterpriseBinding; expiresAt: string; secretFile: string }): Promise<{ inviteId: string; expiresAt: string; secretFile: string }> {
    const normalizedBinding = normalizeBinding(params.binding);
    const expiresAt = parseTimestamp(params.expiresAt, 'expiresAt');
    if (Date.parse(expiresAt) <= this.now().getTime()) throw new Error('expiresAt must be in the future');
    assertOutside(params.secretFile, this.protectedPaths, 'Invite secret file');
    const secretFile = canonicalPath(params.secretFile);
    if (secretFile.toLowerCase() === this.registryPath.toLowerCase() || secretFile.toLowerCase() === this.lockPath.toLowerCase()) {
      throw new Error('Invite secret file must not be the enterprise registry or its lock');
    }
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      entryCapacity(database, 'invites');
      if (database.bindings.some(item => item.accountId === normalizedBinding.accountId || item.agentId === normalizedBinding.agentId)) throw new Error('Account or agent is already bound');
      if (database.registrations.some(item => item.status === 'completed' && (item.binding.accountId === normalizedBinding.accountId || item.binding.agentId === normalizedBinding.agentId))) throw new Error('Previously registered account or agent identifiers cannot be reassigned');
      if (database.invites.some(item => !item.consumedAt && (item.binding.accountId === normalizedBinding.accountId || item.binding.agentId === normalizedBinding.agentId))) throw new Error('An active invite already exists for this account or agent');
      const runtime = database.runtimes.find(item => item.runtimeId === normalizedBinding.runtimeId);
      const employee = database.employees.find(item => item.userId === normalizedBinding.userId);
      if (!employee?.active) throw new Error('Invite employee must exist and be active');
      if (!runtime?.active) throw new Error('Invite runtime must exist and be active');
      const secret = randomBytes(32).toString('base64url');
      const inviteId = `invite-${randomBytes(12).toString('hex')}`;
      const stored: StoredInvite = { inviteId, secretHash: createHash('sha256').update(secret).digest('hex'), binding: normalizedBinding, expiresAt, createdAt: this.timestamp() };
      await mkdir(dirname(secretFile), { recursive: true, mode: 0o700 });
      let createdSecretFile = false;
      try {
        const handle = await openFile(secretFile, 'wx', 0o600);
        createdSecretFile = true;
        try {
          await handle.writeFile(`${secret}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await chmod(secretFile, 0o600).catch(() => undefined);
        await this.writeDatabase({ ...database, invites: [...database.invites, stored] });
      } catch (error) {
        if (createdSecretFile) await unlink(secretFile).catch(() => undefined);
        throw error;
      }
      return { inviteId, expiresAt, secretFile };
    });
  }

  private validateReservation(database: EnterpriseDatabase, input: ReserveInviteInput): { invite: StoredInvite; binding: EnterpriseBinding; fingerprint: string } {
    const fingerprint = normalizeCertificate(input.certFingerprint);
    const runtimeId = normalizeScopeId(input.runtimeId, 'runtimeId');
    const realmId = normalizeScopeId(input.realmId, 'realmId');
    const secretHash = createHash('sha256').update(String(input.secret || '')).digest('hex');
    const invite = database.invites.find(item => item.secretHash === secretHash);
    if (!invite) throw new Error('Invalid or used enterprise invite');
    if (input.binding && !sameBinding(invite.binding, normalizeBinding(input.binding))) {
      throw new Error('Invite identity is predetermined; self-assigned identity is not allowed');
    }
    if (invite.consumedAt && !invite.registrationId) throw new Error('Enterprise invite was already used');
    if (Date.parse(invite.expiresAt) <= this.now().getTime() && !invite.registrationId) throw new Error('Enterprise invite expired');
    if (database.profile.realmId !== realmId) throw new Error('Enterprise invite belongs to a different realm');
    if (database.profile.mode !== input.mode) throw new Error('Enterprise invite mode does not match this command center');
    if (invite.binding.runtimeId !== runtimeId) throw new Error('Enterprise invite is assigned to a different runtime');
    this.assertActive(database, invite.binding, fingerprint);
    return { invite, binding: invite.binding, fingerprint };
  }

  async reserveInvite(input: ReserveInviteInput): Promise<{ registrationId: string; binding: EnterpriseBinding }> {
    if (typeof input.secret !== 'string' || input.secret.length < 40 || input.secret.length > 256) throw new Error('Invalid or used enterprise invite');
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      const { invite, binding: reservedBinding } = this.validateReservation(database, input);
      if (invite.registrationId) {
        const registration = database.registrations.find(item => item.registrationId === invite.registrationId);
        if (!registration || !sameBinding(registration.binding, reservedBinding)) throw new Error('corrupt enterprise registry');
        return { registrationId: registration.registrationId, binding: registration.binding };
      }
      entryCapacity(database, 'registrations');
      const registrationId = `registration-${randomBytes(12).toString('hex')}`;
      const registration: RegistrationRecord = { registrationId, inviteId: invite.inviteId, binding: reservedBinding, status: 'reserved', createdAt: this.timestamp() };
      await this.writeDatabase({
        ...database,
        invites: database.invites.map(item => item.inviteId === invite.inviteId ? { ...item, registrationId } : item),
        registrations: [...database.registrations, registration],
      });
      return { registrationId, binding: reservedBinding };
    });
  }

  async completeInvite(params: { registrationId: string }): Promise<{ registrationId: string; binding: EnterpriseBinding }> {
    const registrationId = normalizeScopeId(params.registrationId, 'registrationId');
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      const registration = database.registrations.find(item => item.registrationId === registrationId);
      if (!registration) throw new Error(`Unknown enterprise registration: ${registrationId}`);
      const invite = database.invites.find(item => item.inviteId === registration.inviteId && item.registrationId === registrationId);
      if (!invite || !sameBinding(invite.binding, registration.binding)) throw new Error('corrupt enterprise registry');
      const runtime = database.runtimes.find(item => item.runtimeId === registration.binding.runtimeId);
      if (!runtime) throw new Error('Enterprise runtime no longer exists');
      this.assertActive(database, registration.binding, runtime.certFingerprint);
      if (registration.status === 'completed') {
        const existing = database.bindings.find(item => item.accountId === registration.binding.accountId);
        if (!existing || !sameBinding(existing, registration.binding)) throw new Error('corrupt enterprise registry');
        return { registrationId, binding: existing };
      }
      entryCapacity(database, 'bindings');
      if (database.bindings.some(item => item.accountId === registration.binding.accountId || item.agentId === registration.binding.agentId)) throw new Error('Account or agent binding conflicts with this registration');
      const timestamp = this.timestamp();
      await this.writeDatabase({
        ...database,
        invites: database.invites.map(item => item.inviteId === invite.inviteId ? { ...item, consumedAt: timestamp } : item),
        registrations: database.registrations.map(item => item.registrationId === registrationId ? { ...item, status: 'completed', completedAt: timestamp } : item),
        bindings: [...database.bindings, registration.binding],
      });
      return { registrationId, binding: registration.binding };
    });
  }

  async redeemInvite(input: ReserveInviteInput, registerAccount: (binding: EnterpriseBinding, registrationId: string) => Promise<void>): Promise<{ registrationId: string; binding: EnterpriseBinding }> {
    const reserved = await this.reserveInvite(input);
    const database = this.readDatabase();
    const registration = database.registrations.find(item => item.registrationId === reserved.registrationId);
    if (registration?.status !== 'completed') await registerAccount(reserved.binding, reserved.registrationId);
    return await this.completeInvite({ registrationId: reserved.registrationId });
  }

  getBinding(accountIdInput: string): EnterpriseBinding | undefined {
    const accountId = normalizeScopeId(accountIdInput, 'accountId');
    return this.readDatabase().bindings.find(item => item.accountId === accountId);
  }

  async disableAccount(params: { accountId: string }): Promise<{ accountId: string; disabled: true }> {
    const accountId = normalizeScopeId(params.accountId, 'accountId');
    return this.exclusive(async () => {
      const database = this.readDatabase();
      const binding = database.bindings.find(item => item.accountId === accountId);
      if (!binding) {
        if (database.registrations.some(item => item.binding.accountId === accountId && item.status === 'completed')) return { accountId, disabled: true as const };
        throw new Error('Unknown enterprise account');
      }
      await this.writeDatabase({ ...database,
        bindings: database.bindings.filter(item => item.accountId !== accountId),
        sessionLeases: database.sessionLeases.map(item => item.agentId === binding.agentId ? { agentId: item.agentId, generation: item.generation + 1 } : item),
      });
      return { accountId, disabled: true as const };
    });
  }

  assertRegisteredBinding(bindingInput: EnterpriseBinding): { binding: EnterpriseBinding; employee: EnterpriseEmployee; runtime: EnterpriseRuntime; policy: EnterpriseProfile } {
    const database = this.readDatabase();
    const expected = normalizeBinding(bindingInput);
    const stored = database.bindings.find(item => item.accountId === expected.accountId);
    if (!stored || !sameBindingIdentity(stored, expected)) throw new Error('Enterprise account binding does not match the registered identity');
    const runtime = database.runtimes.find(item => item.runtimeId === stored.runtimeId);
    if (!runtime) throw new Error(`Unknown enterprise runtime: ${stored.runtimeId}`);
    const active = this.assertActive(database, stored, runtime.certFingerprint);
    return { binding: stored, ...active, policy: database.profile };
  }

  resolveRequestCertificate(certFingerprintInput: string): EnterpriseRuntime {
    const fingerprint = normalizeCertificate(certFingerprintInput);
    const runtime = this.readDatabase().runtimes.find(item => item.certFingerprint === fingerprint);
    if (!runtime) throw new Error('Request certificate is not registered');
    if (!runtime.active) throw new Error(`Enterprise runtime is disabled: ${runtime.runtimeId}`);
    return runtime;
  }

  assertBinding(input: EnterpriseBinding & { realmId: string; mode: EnterpriseMode; certFingerprint: string }): { binding: EnterpriseBinding; employee: EnterpriseEmployee; runtime: EnterpriseRuntime; policy: EnterpriseProfile } {
    const database = this.readDatabase();
    const expected = normalizeBinding(input);
    if (normalizeScopeId(input.realmId, 'realmId') !== database.profile.realmId) throw new Error('Enterprise binding belongs to a different realm');
    if (input.mode !== database.profile.mode) throw new Error('Enterprise binding mode does not match this command center');
    const stored = database.bindings.find(item => item.accountId === expected.accountId);
    if (!stored || !sameBindingIdentity(stored, expected)) throw new Error('Enterprise account binding does not match the registered identity');
    const active = this.assertActive(database, stored, normalizeCertificate(input.certFingerprint));
    return { binding: stored, ...active, policy: database.profile };
  }

  getSessionLease(agentIdInput: string): EnterpriseSessionLease | undefined {
    const agentId = normalizeScopeId(agentIdInput, 'agentId');
    const record = this.readDatabase().sessionLeases.find(item => item.agentId === agentId);
    if (!record?.sessionId || !record.expiresAt || Date.parse(record.expiresAt) <= this.now().getTime()) return undefined;
    return { agentId, sessionId: record.sessionId, generation: record.generation, expiresAt: record.expiresAt };
  }

  getSessionGeneration(agentIdInput: string): number {
    const agentId = normalizeScopeId(agentIdInput, 'agentId');
    return this.readDatabase().sessionLeases.find(item => item.agentId === agentId)?.generation || 0;
  }

  async claimSessionLease(params: { agentId: string; sessionId: string; expectedGeneration: number; expiresAt: string }): Promise<EnterpriseSessionLease> {
    const agentId = normalizeScopeId(params.agentId, 'agentId');
    const sessionId = normalizeOptionalText(params.sessionId, 'sessionId');
    if (!sessionId) throw new Error('sessionId is required');
    if (!Number.isSafeInteger(params.expectedGeneration) || params.expectedGeneration < 0) throw new Error('expectedGeneration must be a non-negative safe integer');
    const expiresAt = parseTimestamp(params.expiresAt, 'expiresAt');
    if (Date.parse(expiresAt) <= this.now().getTime()) throw new Error('expiresAt must be in the future');
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      const current = database.sessionLeases.find(item => item.agentId === agentId);
      const currentGeneration = current?.generation || 0;
      if (currentGeneration !== params.expectedGeneration) throw new Error(`Stale session generation: expected ${params.expectedGeneration}, current ${currentGeneration}`);
      if (!current) entryCapacity(database, 'sessionLeases');
      const lease: EnterpriseSessionLease = { agentId, sessionId, generation: currentGeneration + 1, expiresAt };
      const record: SessionLeaseRecord = lease;
      await this.writeDatabase({ ...database, sessionLeases: current
        ? database.sessionLeases.map(item => item.agentId === agentId ? record : item)
        : [...database.sessionLeases, record] });
      return lease;
    });
  }

  assertSessionLease(params: { agentId: string; sessionId: string; generation: number }): EnterpriseSessionLease {
    const agentId = normalizeScopeId(params.agentId, 'agentId');
    const sessionId = normalizeOptionalText(params.sessionId, 'sessionId');
    const lease = this.getSessionLease(agentId);
    if (!sessionId || !lease || lease.sessionId !== sessionId || lease.generation !== params.generation) throw new Error('Session does not hold the current enterprise writer lease');
    return lease;
  }

  async releaseSessionLease(params: { agentId: string; sessionId: string; expectedGeneration: number }): Promise<{ agentId: string; generation: number }> {
    const agentId = normalizeScopeId(params.agentId, 'agentId');
    const sessionId = normalizeOptionalText(params.sessionId, 'sessionId');
    if (!sessionId) throw new Error('sessionId is required');
    return await this.exclusive(async () => {
      const database = this.readDatabase();
      const current = database.sessionLeases.find(item => item.agentId === agentId);
      if (!current || current.generation !== params.expectedGeneration) throw new Error(`Stale session generation: expected ${params.expectedGeneration}, current ${current?.generation || 0}`);
      if (current.sessionId !== sessionId) throw new Error('Session does not hold the current enterprise writer lease');
      const next = { agentId, generation: current.generation + 1 };
      await this.writeDatabase({ ...database, sessionLeases: database.sessionLeases.map(item => item.agentId === agentId ? next : item) });
      return next;
    });
  }
}
