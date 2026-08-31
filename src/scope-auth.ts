import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { normalizeScopeId } from './scopes.js';

const scrypt = promisify(scryptCallback);
const AUTH_VERSION = 1;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 12;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_BLOCK_MS = 30_000;

export interface ScopePrincipal {
  accountId: string;
  modelId: string;
  agentId?: string;
  role: 'model' | 'agent';
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
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly loginFailures = new Map<string, { count: number; blockedUntil: number }>();
  private readonly dummySalt = randomBytes(16);
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(vaultPath: string) {
    this.authPath = join(resolve(vaultPath), '.mcpvault', 'scope-auth.json');
  }

  private async readDatabase(): Promise<AuthDatabase> {
    try {
      const parsed = JSON.parse(await readFile(this.authPath, 'utf8')) as Partial<AuthDatabase>;
      if (parsed.version !== AUTH_VERSION || !Array.isArray(parsed.accounts)) {
        throw new Error('Unsupported or corrupt scope authentication database');
      }
      return { version: AUTH_VERSION, accounts: parsed.accounts as StoredAccount[] };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { version: AUTH_VERSION, accounts: [] };
      }
      throw error;
    }
  }

  private async writeDatabase(database: AuthDatabase): Promise<void> {
    const directory = dirname(this.authPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.authPath}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, this.authPath);
    // Windows may ignore POSIX modes; on Unix this narrows permissions even
    // when the directory already existed with a permissive umask.
    await Promise.allSettled([chmod(directory, 0o700), chmod(this.authPath, 0o600)]);
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.mutationQueue;
    this.mutationQueue = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
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
    return { ...session.principal };
  }

  async register(params: {
    accountId: string;
    password: string;
    modelId: string;
    agentId?: string;
    accessToken?: string;
  }): Promise<{ success: true; principal: ScopePrincipal }> {
    const accountId = normalizeScopeId(params.accountId, 'accountId');
    const modelId = normalizeScopeId(params.modelId, 'modelId');
    const agentId = params.agentId ? normalizeScopeId(params.agentId, 'agentId') : undefined;
    const password = validatePassword(params.password);
    const sponsor = this.authenticate(params.accessToken);

    if (agentId) {
      if (!sponsor || sponsor.role !== 'model' || sponsor.modelId !== modelId) {
        throw new Error('An authenticated owner of this model scope must register agent accounts');
      }
    } else if (sponsor) {
      throw new Error('A model account is self-registered only while its model scope is unclaimed');
    }

    return await this.exclusive(async () => {
      const database = await this.readDatabase();
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
        role: agentId ? 'agent' : 'model',
      };
      database.accounts.push({
        ...principal,
        salt: salt.toString('base64'),
        passwordHash: hash.toString('base64'),
        createdAt: new Date().toISOString(),
      });
      await this.writeDatabase(database);
      return { success: true as const, principal };
    });
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
    const database = await this.readDatabase();
    const account = database.accounts.find(candidate => candidate.accountId === accountId);
    // Run the same expensive password derivation for missing accounts so
    // response timing does not become an account-enumeration shortcut.
    const salt = account ? Buffer.from(account.salt, 'base64') : this.dummySalt;
    const actual = await passwordDigest(password, salt);
    const expected = account ? Buffer.from(account.passwordHash, 'base64') : Buffer.alloc(actual.length);
    if (!account || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      const count = (failure?.blockedUntil && failure.blockedUntil <= Date.now() ? 0 : failure?.count || 0) + 1;
      this.loginFailures.set(accountId, {
        count,
        blockedUntil: count >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_BLOCK_MS : 0,
      });
      throw new Error('Invalid account or password');
    }
    this.loginFailures.delete(accountId);

    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const principal: ScopePrincipal = {
      accountId: account.accountId,
      modelId: account.modelId,
      ...(account.agentId && { agentId: account.agentId }),
      role: account.role,
    };
    this.sessions.set(tokenDigest(accessToken), { principal, expiresAt });
    return { success: true, accessToken, expiresAt: new Date(expiresAt).toISOString(), principal };
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
      account.salt = salt.toString('base64');
      account.passwordHash = (await passwordDigest(newPassword, salt)).toString('base64');
      await this.writeDatabase(database);
    });

    for (const [key, session] of this.sessions) {
      if (session.principal.accountId === principal.accountId) this.sessions.delete(key);
    }
    return { success: true };
  }
}
