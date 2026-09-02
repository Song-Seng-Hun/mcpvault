import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod, open as openFile, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { normalizeScopeId } from './scopes.js';

const scrypt = promisify(scryptCallback);
const AUTH_VERSION = 1;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 12;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_BLOCK_MS = 30_000;
const AUTH_DATABASE_CACHE_TTL_MS = 1_000;
const AUTH_LOCK_RETRY_COUNT = 2;
const MAX_LOGIN_FAILURE_ENTRIES = 4_096;
const LOGIN_WINDOW_MS = 60_000;
const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 120;
// Registration can be reached anonymously by design. Keep abuse bounded even
// when the server is used over stdio, where there is no client IP to rate-limit.
const MAX_ACCOUNTS = 4_096;
const MAX_ACCOUNTS_PER_USER = 512;

export const SCOPE_CAPABILITIES = ['write', 'publish', 'comment', 'chat', 'status', 'whisper', 'task', 'profile', 'journal', 'moderate'] as const;
export type ScopeCapability = typeof SCOPE_CAPABILITIES[number];
const DEFAULT_MODEL_CAPABILITIES: ScopeCapability[] = ['write', 'publish', 'comment', 'chat', 'status', 'whisper', 'task', 'profile'];
const DEFAULT_AGENT_CAPABILITIES: ScopeCapability[] = [...DEFAULT_MODEL_CAPABILITIES, 'journal'];

export interface ScopePrincipal {
  accountId: string;
  modelId: string;
  agentId?: string;
  /** Stable owner identity shared by all agents of one human user. */
  userId?: string;
  /** Command center that issued this account. */
  commandCenterId?: string;
  role: 'model' | 'agent';
  capabilities?: ScopeCapability[];
}

interface StoredAccount extends ScopePrincipal {
  salt: string;
  passwordHash: string;
  createdAt: string;
}

interface AuthDatabase {
  version: 1;
  accounts: StoredAccount[];
}

interface SessionRecord {
  principal: ScopePrincipal;
  expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!isRecord(value)) return false;
  if (typeof value.accountId !== 'string' || typeof value.modelId !== 'string' || typeof value.role !== 'string') return false;
  if (value.role !== 'model' && value.role !== 'agent') return false;
  if (value.agentId !== undefined && typeof value.agentId !== 'string') return false;
  if (value.userId !== undefined && typeof value.userId !== 'string') return false;
  if (value.commandCenterId !== undefined && typeof value.commandCenterId !== 'string') return false;
  if (typeof value.salt !== 'string' || typeof value.passwordHash !== 'string' || typeof value.createdAt !== 'string') return false;
  if (Buffer.from(value.salt, 'base64').byteLength !== 16 || Buffer.from(value.passwordHash, 'base64').byteLength !== 32) return false;
  if (!value.accountId || !value.modelId || !value.createdAt || (value.role === 'agent' && !value.agentId)) return false;
  if (value.capabilities !== undefined && (!Array.isArray(value.capabilities) || value.capabilities.some(capability => typeof capability !== 'string' || !(SCOPE_CAPABILITIES as readonly string[]).includes(capability)))) return false;
  try {
    normalizeScopeId(value.accountId, 'accountId');
    normalizeScopeId(value.modelId, 'modelId');
    if (value.agentId) normalizeScopeId(value.agentId, 'agentId');
    if (value.userId) normalizeScopeId(value.userId, 'userId');
    if (value.commandCenterId) normalizeScopeId(value.commandCenterId, 'commandCenterId');
  } catch {
    return false;
  }
  return true;
}

interface AuthFileLock {
  handle: FileHandle;
  nonce: string;
  path: string;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
}

async function acquireAuthFileLock(path: string): Promise<AuthFileLock> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < AUTH_LOCK_RETRY_COUNT; attempt += 1) {
    const nonce = randomBytes(16).toString('hex');
    try {
      const handle = await openFile(path, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, nonce })}\n`, 'utf8');
        await handle.sync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(path).catch(() => undefined);
        throw error;
      }
      return { handle, nonce, path };
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
      let raw: string;
      try { raw = await readFile(path, 'utf8'); } catch (readError) {
        if (readError && typeof readError === 'object' && 'code' in readError && readError.code === 'ENOENT') continue;
        throw readError;
      }
      let record: unknown;
      try { record = JSON.parse(raw); } catch { throw new Error('Scope authentication lock is corrupt; refusing to remove it automatically'); }
      if (!isRecord(record) || typeof record.pid !== 'number' || !Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.nonce !== 'string' || !record.nonce) {
        throw new Error('Scope authentication lock is invalid; refusing to remove it automatically');
      }
      if (processIsAlive(record.pid)) throw new Error(`Scope authentication database is already in use by process ${record.pid}`);
      await unlink(path);
    }
  }
  throw new Error('Unable to acquire scope authentication database lock');
}

async function releaseAuthFileLock(lock: AuthFileLock): Promise<void> {
  await lock.handle.close().catch(() => undefined);
  try {
    const record = JSON.parse(await readFile(lock.path, 'utf8')) as Record<string, unknown>;
    if (record.nonce === lock.nonce) await unlink(lock.path);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > 1024) throw new Error('password is too long');
  return password;
}

async function passwordDigest(password: string, salt: Buffer): Promise<Buffer> {
  return await scrypt(password, salt, 32) as Buffer;
}

/**
 * Persistent model/agent accounts with process-local bearer sessions.
 * Passwords and raw session tokens are never written to disk.
 */
export class ScopeAuthService {
  private readonly authPath: string;
  private readonly authLockPath: string;
  private readonly moderatorAccounts: Set<string>;
  private readonly commandCenterId: string;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly loginFailures = new Map<string, { count: number; blockedUntil: number }>();
  private loginWindow: { startedAt: number; count: number } = { startedAt: Date.now(), count: 0 };
  private readonly dummySalt = randomBytes(16);
  private mutationQueue: Promise<void> = Promise.resolve();
  private databaseCache: { expiresAt: number; value: AuthDatabase } | undefined;
  private databaseInFlight: Promise<AuthDatabase> | undefined;
  private principalCache: { expiresAt: number; value: ScopePrincipal[] } | undefined;

  constructor(vaultPath: string, options: { moderatorAccounts?: string[]; commandCenterId?: string } = {}) {
    this.authPath = join(resolve(vaultPath), '.mcpvault', 'scope-auth.json');
    this.authLockPath = join(resolve(vaultPath), '.mcpvault', 'scope-auth.lock');
    const configured = options.moderatorAccounts || String(process.env.MCPVAULT_MODERATOR_ACCOUNTS || '').split(',');
    this.moderatorAccounts = new Set(configured.map(value => String(value).trim().toLowerCase()).filter(Boolean));
    this.commandCenterId = normalizeScopeId(options.commandCenterId || process.env.MCPVAULT_COMMAND_CENTER_ID || 'local', 'commandCenterId');
  }

  private effectiveCapabilities(principal: ScopePrincipal): ScopeCapability[] {
    const capabilities = Array.from(new Set(principal.capabilities || this.defaultCapabilities(principal.role)));
    if (this.moderatorAccounts.has(principal.accountId)) capabilities.push('moderate');
    return Array.from(new Set(capabilities));
  }

  private async readDatabase(): Promise<AuthDatabase> {
    const cached = this.databaseCache;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (this.databaseInFlight) return this.databaseInFlight;
    const computation = (async (): Promise<AuthDatabase> => {
      try {
        const parsed = JSON.parse(await readFile(this.authPath, 'utf8')) as Partial<AuthDatabase>;
        if (parsed.version !== AUTH_VERSION || !Array.isArray(parsed.accounts)) {
          throw new Error('Unsupported or corrupt scope authentication database');
        }
        if (!parsed.accounts.every(isStoredAccount)) throw new Error('Unsupported or corrupt scope authentication database');
        const accountIds = new Set<string>();
        const agentIds = new Set<string>();
        for (const account of parsed.accounts) {
          if (accountIds.has(account.accountId) || (account.agentId && agentIds.has(account.agentId))) {
            throw new Error('Unsupported or corrupt scope authentication database');
          }
          accountIds.add(account.accountId);
          if (account.agentId) agentIds.add(account.agentId);
        }
        return { version: AUTH_VERSION, accounts: parsed.accounts };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return { version: AUTH_VERSION, accounts: [] };
        }
        throw error;
      }
    })();
    this.databaseInFlight = computation;
    try {
      const database = await computation;
      this.databaseCache = { expiresAt: Date.now() + AUTH_DATABASE_CACHE_TTL_MS, value: database };
      return database;
    } finally {
      if (this.databaseInFlight === computation) this.databaseInFlight = undefined;
    }
  }

  private async writeDatabase(database: AuthDatabase): Promise<void> {
    const directory = dirname(this.authPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.authPath}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, this.authPath);
    this.databaseCache = { expiresAt: Date.now() + AUTH_DATABASE_CACHE_TTL_MS, value: database };
    this.principalCache = undefined;
    // Windows may ignore POSIX modes; on Unix this narrows permissions even
    // when the directory already existed with a permissive umask.
    await Promise.allSettled([chmod(directory, 0o700), chmod(this.authPath, 0o600)]);
  }

  private defaultCapabilities(role: ScopePrincipal['role']): ScopeCapability[] {
    return [...(role === 'agent' ? DEFAULT_AGENT_CAPABILITIES : DEFAULT_MODEL_CAPABILITIES)];
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.mutationQueue;
    this.mutationQueue = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    await previous;
    let fileLock: AuthFileLock | undefined;
    try {
      fileLock = await acquireAuthFileLock(this.authLockPath);
      // Another process may have committed while this instance's short cache
      // was still warm. Always reload under the OS lock before read-modify-write.
      this.databaseCache = undefined;
      this.principalCache = undefined;
      return await operation();
    } finally {
      if (fileLock) await releaseAuthFileLock(fileLock).catch(() => undefined);
      release();
    }
  }

  private consumeLoginAttempt(): void {
    const now = Date.now();
    if (now - this.loginWindow.startedAt >= LOGIN_WINDOW_MS) this.loginWindow = { startedAt: now, count: 0 };
    if (this.loginWindow.count >= MAX_LOGIN_ATTEMPTS_PER_WINDOW) {
      throw new Error('Too many login attempts; try again later');
    }
    this.loginWindow.count += 1;
    for (const [accountId, failure] of this.loginFailures) {
      if (failure.blockedUntil > 0 && failure.blockedUntil <= now) this.loginFailures.delete(accountId);
    }
  }

  private rememberLoginFailure(accountId: string, previous?: { count: number; blockedUntil: number }): void {
    if (!this.loginFailures.has(accountId) && this.loginFailures.size >= MAX_LOGIN_FAILURE_ENTRIES) {
      const oldest = this.loginFailures.keys().next().value;
      if (typeof oldest === 'string') this.loginFailures.delete(oldest);
    }
    const count = (previous?.blockedUntil && previous.blockedUntil <= Date.now() ? 0 : previous?.count || 0) + 1;
    this.loginFailures.set(accountId, {
      count,
      blockedUntil: count >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_BLOCK_MS : 0,
    });
  }

  authenticate(accessToken: unknown): ScopePrincipal | undefined {
    if (typeof accessToken !== 'string' || !accessToken) return undefined;
    const key = tokenDigest(accessToken);
    const session = this.sessions.get(key);
    if (!session) throw new Error('Invalid access token; call login_scope again');
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      throw new Error('Access token expired; call login_scope again');
    }
    return { ...session.principal, capabilities: this.effectiveCapabilities(session.principal) };
  }

  async register(params: {
    accountId: string;
    password: string;
    modelId: string;
    agentId?: string;
    userId?: string;
    accessToken?: string;
  }): Promise<{
    success: true;
    accessToken: string;
    expiresAt: string;
    principal: ScopePrincipal;
    next: string;
  }> {
    const accountId = normalizeScopeId(params.accountId, 'accountId');
    const modelId = normalizeScopeId(params.modelId, 'modelId');
    const agentId = params.agentId ? normalizeScopeId(params.agentId, 'agentId') : undefined;
    const password = validatePassword(params.password);
    const sponsor = this.authenticate(params.accessToken);
    const requestedUserId = params.userId ? normalizeScopeId(params.userId, 'userId') : undefined;
    const userId = requestedUserId || sponsor?.userId || accountId;

    if (sponsor?.userId && requestedUserId && sponsor.userId !== requestedUserId) {
      throw new Error('An agent must use the sponsoring model owner\'s userId; different users cannot share a family scope');
    }

    if (agentId) {
      if (sponsor && (sponsor.role !== 'model' || sponsor.modelId !== modelId)) {
        throw new Error('Only an authenticated owner of this model scope may register an agent account under it');
      }
      // A first-time session may claim its own agent identity. This keeps
      // model-level ownership meaningful while allowing multiple sessions of
      // the same model family (for example, several Codex workers) to sign up
      // independently with distinct agentIds.
    } else if (sponsor) {
      throw new Error('A model account is self-registered only while its model scope is unclaimed');
    }

    const principal = await this.exclusive(async () => {
      const database = await this.readDatabase();
      if (database.accounts.length >= MAX_ACCOUNTS) {
        throw new Error(`Account capacity reached (${MAX_ACCOUNTS}); ask the server operator to remove inactive accounts`);
      }
      const accountsForUser = database.accounts.filter(account => (account.userId || account.accountId) === userId).length;
      if (accountsForUser >= MAX_ACCOUNTS_PER_USER) {
        throw new Error(`User family account capacity reached (${MAX_ACCOUNTS_PER_USER})`);
      }
      if (database.accounts.some(account => account.accountId === accountId)) {
        throw new Error(`Account already exists: ${accountId}`);
      }
      if (!agentId && database.accounts.some(account => account.role === 'model' && account.modelId === modelId)) {
        throw new Error(`Model scope is already claimed: ${modelId}`);
      }
      if (agentId && database.accounts.some(account => account.agentId === agentId)) {
        throw new Error(`Agent scope is already claimed: ${agentId}`);
      }

      const salt = randomBytes(16);
      const hash = await passwordDigest(password, salt);
      const principal: ScopePrincipal = {
        accountId,
        modelId,
        ...(agentId && { agentId }),
        userId,
        commandCenterId: this.commandCenterId,
        role: agentId ? 'agent' : 'model',
        capabilities: this.defaultCapabilities(agentId ? 'agent' : 'model'),
      };
      const account: StoredAccount = {
        ...principal,
        salt: salt.toString('base64'),
        passwordHash: hash.toString('base64'),
        createdAt: new Date().toISOString(),
      };
      await this.writeDatabase({ ...database, accounts: [...database.accounts, account] });
      return principal;
    });

    // Registration is also the first login. Returning a live session removes
    // an unnecessary second round trip and prevents a new agent from stopping
    // between account creation and login. The password is still only used to
    // create the salted hash above; the raw value is never persisted.
    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(tokenDigest(accessToken), { principal, expiresAt });
    return {
      success: true,
      accessToken,
      expiresAt: new Date(expiresAt).toISOString(),
      principal: { ...principal, capabilities: this.effectiveCapabilities(principal) },
      next: 'Use accessToken for get_agent_pulse and public/private tools; keep the password in the host secret store for future sessions.',
    };
  }

  async login(params: { accountId: string; password: string }): Promise<{
    success: true;
    accessToken: string;
    expiresAt: string;
    principal: ScopePrincipal;
  }> {
    const accountId = normalizeScopeId(params.accountId, 'accountId');
    const password = validatePassword(params.password);
    const failure = this.loginFailures.get(accountId);
    if (failure?.blockedUntil && failure.blockedUntil > Date.now()) {
      throw new Error('Too many failed login attempts; try again later');
    }
    this.consumeLoginAttempt();
    const database = await this.readDatabase();
    const account = database.accounts.find(candidate => candidate.accountId === accountId);
    // Run the same expensive password derivation for missing accounts so
    // response timing does not become an account-enumeration shortcut.
    const salt = account ? Buffer.from(account.salt, 'base64') : this.dummySalt;
    const actual = await passwordDigest(password, salt);
    const expected = account ? Buffer.from(account.passwordHash, 'base64') : Buffer.alloc(actual.length);
    if (!account || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      this.rememberLoginFailure(accountId, failure);
      throw new Error('Invalid account or password');
    }
    if (account.commandCenterId && account.commandCenterId !== this.commandCenterId) {
      throw new Error('This account belongs to a different command center');
    }
    this.loginFailures.delete(accountId);

    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
      const principal: ScopePrincipal = {
        accountId: account.accountId,
        modelId: account.modelId,
        ...(account.agentId && { agentId: account.agentId }),
        userId: account.userId || account.accountId,
        commandCenterId: account.commandCenterId || this.commandCenterId,
        role: account.role,
        capabilities: Array.isArray(account.capabilities)
          ? account.capabilities.filter((capability): capability is ScopeCapability => (SCOPE_CAPABILITIES as readonly string[]).includes(capability))
          : this.defaultCapabilities(account.role),
      };
    const effectivePrincipal = { ...principal, capabilities: this.effectiveCapabilities(principal) };
    this.sessions.set(tokenDigest(accessToken), { principal: effectivePrincipal, expiresAt });
    return { success: true, accessToken, expiresAt: new Date(expiresAt).toISOString(), principal: effectivePrincipal };
  }

  logout(accessToken: unknown): { success: true } {
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('accessToken is required');
    this.sessions.delete(tokenDigest(accessToken));
    return { success: true };
  }

  whoami(accessToken: unknown): ScopePrincipal | { role: 'global'; note: string } {
    return this.authenticate(accessToken) || {
      role: 'global',
      note: 'No access token supplied. Only the public global scope is accessible.',
    };
  }

  async listPrincipals(): Promise<ScopePrincipal[]> {
    const cached = this.principalCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value.map(principal => ({ ...principal, ...(principal.capabilities && { capabilities: [...principal.capabilities] }) }));
    }
    const database = await this.readDatabase();
    const value = database.accounts
      .filter(account => !account.commandCenterId || account.commandCenterId === this.commandCenterId)
      .map(account => ({
      accountId: account.accountId,
      modelId: account.modelId,
      ...(account.agentId && { agentId: account.agentId }),
      userId: account.userId || account.accountId,
      commandCenterId: account.commandCenterId || this.commandCenterId,
      role: account.role,
      capabilities: this.effectiveCapabilities({
        accountId: account.accountId,
        modelId: account.modelId,
        ...(account.agentId && { agentId: account.agentId }),
        userId: account.userId || account.accountId,
        commandCenterId: account.commandCenterId || this.commandCenterId,
        role: account.role,
        capabilities: Array.isArray(account.capabilities)
          ? account.capabilities.filter((capability): capability is ScopeCapability => (SCOPE_CAPABILITIES as readonly string[]).includes(capability))
          : this.defaultCapabilities(account.role),
      }),
      }));
    this.principalCache = { expiresAt: Date.now() + AUTH_DATABASE_CACHE_TTL_MS, value };
    return value.map(principal => ({ ...principal, ...(principal.capabilities && { capabilities: [...principal.capabilities] }) }));
  }

  async updateAgentCapabilities(params: { accessToken: string; agentId: string; capabilities: unknown }): Promise<{ success: true; agentId: string; capabilities: ScopeCapability[] }> {
    const sponsor = this.authenticate(params.accessToken);
    if (!sponsor || sponsor.role !== 'model') throw new Error('Only an authenticated model owner can change agent capabilities');
    const agentId = normalizeScopeId(params.agentId, 'agentId');
    if (!Array.isArray(params.capabilities) || params.capabilities.length === 0) throw new Error('capabilities must be a non-empty array');
    const capabilities = Array.from(new Set(params.capabilities.map(String))) as ScopeCapability[];
    if (capabilities.some(capability => !(SCOPE_CAPABILITIES as readonly string[]).includes(capability))) {
      throw new Error(`capabilities must be chosen from: ${SCOPE_CAPABILITIES.join(', ')}`);
    }
    if (capabilities.includes('moderate')) throw new Error('moderate capability is reserved for accounts configured by the server operator');
    return await this.exclusive(async () => {
      const database = await this.readDatabase();
      const account = database.accounts.find(candidate => candidate.agentId === agentId);
      if (!account || account.modelId !== sponsor.modelId || (sponsor.userId && (account.userId || account.accountId) !== sponsor.userId)) {
        throw new Error(`Agent account '${agentId}' does not belong to this model/user scope`);
      }
      await this.writeDatabase({
        ...database,
        accounts: database.accounts.map(candidate => candidate === account ? { ...candidate, capabilities } : candidate),
      });
      for (const [key, session] of this.sessions) {
        if (session.principal.agentId === agentId) this.sessions.delete(key);
      }
      return { success: true as const, agentId, capabilities };
    });
  }

  hasCapability(principal: ScopePrincipal | undefined, capability: ScopeCapability): boolean {
    return Boolean(principal && this.effectiveCapabilities(principal).includes(capability));
  }

  async changePassword(params: { accessToken: string; currentPassword: string; newPassword: string }): Promise<{ success: true }> {
    const principal = this.authenticate(params.accessToken);
    if (!principal) throw new Error('accessToken is required');
    const currentPassword = validatePassword(params.currentPassword);
    const newPassword = validatePassword(params.newPassword);

    await this.exclusive(async () => {
      const database = await this.readDatabase();
      const account = database.accounts.find(candidate => candidate.accountId === principal.accountId);
      if (!account) throw new Error('Account no longer exists');
      const current = await passwordDigest(currentPassword, Buffer.from(account.salt, 'base64'));
      const expected = Buffer.from(account.passwordHash, 'base64');
      if (current.length !== expected.length || !timingSafeEqual(current, expected)) {
        throw new Error('Current password is incorrect');
      }
      const salt = randomBytes(16);
      const passwordHash = (await passwordDigest(newPassword, salt)).toString('base64');
      await this.writeDatabase({
        ...database,
        accounts: database.accounts.map(candidate => candidate === account
          ? { ...candidate, salt: salt.toString('base64'), passwordHash }
          : candidate),
      });
    });

    for (const [key, session] of this.sessions) {
      if (session.principal.accountId === principal.accountId) this.sessions.delete(key);
    }
    return { success: true };
  }
}
