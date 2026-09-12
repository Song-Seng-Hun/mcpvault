import { guidanceError, guidanceText } from './guidance-runtime.js';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod, open as openFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { normalizeScopeId } from './scopes.js';
import { getEnterpriseRequestContext } from './enterprise-request-context.js';
import { authorIdentity } from './enterprise-identity.js';
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
const REGISTRATION_WINDOW_MS = 10 * 60_000;
const MAX_REGISTRATION_ATTEMPTS_PER_WINDOW = 32;
const MAX_ACCOUNTS = 4_096;
const MAX_ACCOUNTS_PER_USER = 512;
export const SCOPE_CAPABILITIES = ['write', 'publish', 'comment', 'chat', 'status', 'whisper', 'task', 'profile', 'journal', 'moderate'];
const DEFAULT_MODEL_CAPABILITIES = ['write', 'publish', 'comment', 'chat', 'status', 'whisper', 'task', 'profile'];
const DEFAULT_AGENT_CAPABILITIES = [...DEFAULT_MODEL_CAPABILITIES, 'journal'];
function verifiedDepartments(employee) {
    return {
        ...(employee.departmentIds !== undefined && { departmentIds: [...employee.departmentIds] }),
        ...(employee.defaultDepartmentId !== undefined && { defaultDepartmentId: employee.defaultDepartmentId }),
    };
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isStoredAccount(value) {
    if (!isRecord(value))
        return false;
    if (typeof value.accountId !== 'string' || typeof value.modelId !== 'string' || typeof value.role !== 'string')
        return false;
    if (value.role !== 'model' && value.role !== 'agent')
        return false;
    if (value.agentId !== undefined && typeof value.agentId !== 'string')
        return false;
    if (value.userId !== undefined && typeof value.userId !== 'string')
        return false;
    if (value.commandCenterId !== undefined && typeof value.commandCenterId !== 'string')
        return false;
    if (value.registrationId !== undefined && typeof value.registrationId !== 'string')
        return false;
    if (typeof value.salt !== 'string' || typeof value.passwordHash !== 'string' || typeof value.createdAt !== 'string')
        return false;
    if (Buffer.from(value.salt, 'base64').byteLength !== 16 || Buffer.from(value.passwordHash, 'base64').byteLength !== 32)
        return false;
    if (!value.accountId || !value.modelId || !value.createdAt || (value.role === 'agent' && !value.agentId))
        return false;
    if (value.capabilities !== undefined && (!Array.isArray(value.capabilities) || value.capabilities.some(capability => typeof capability !== 'string' || !SCOPE_CAPABILITIES.includes(capability))))
        return false;
    try {
        normalizeScopeId(value.accountId, 'accountId');
        normalizeScopeId(value.modelId, 'modelId');
        if (value.agentId)
            normalizeScopeId(value.agentId, 'agentId');
        if (value.userId)
            normalizeScopeId(value.userId, 'userId');
        if (value.commandCenterId)
            normalizeScopeId(value.commandCenterId, 'commandCenterId');
    }
    catch {
        return false;
    }
    return true;
}
function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
    }
}
async function acquireAuthFileLock(path) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < AUTH_LOCK_RETRY_COUNT; attempt += 1) {
        const nonce = randomBytes(16).toString('hex');
        try {
            const handle = await openFile(path, 'wx');
            try {
                await handle.writeFile(`${JSON.stringify({ pid: process.pid, nonce })}\n`, 'utf8');
                await handle.sync();
            }
            catch (error) {
                await handle.close().catch(() => undefined);
                await unlink(path).catch(() => undefined);
                throw error;
            }
            return { handle, nonce, path };
        }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
                throw error;
            let raw;
            try {
                raw = await readFile(path, 'utf8');
            }
            catch (readError) {
                if (readError && typeof readError === 'object' && 'code' in readError && readError.code === 'ENOENT')
                    continue;
                throw readError;
            }
            let record;
            try {
                record = JSON.parse(raw);
            }
            catch {
                throw guidanceError(new Error('Scope authentication lock is corrupt; refusing to remove it automatically'), 'guid-9566cc25881bfa49');
            }
            if (!isRecord(record) || typeof record.pid !== 'number' || !Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.nonce !== 'string' || !record.nonce) {
                throw guidanceError(new Error('Scope authentication lock is invalid; refusing to remove it automatically'), 'guid-0c3f17fa63a7abed');
            }
            if (processIsAlive(record.pid))
                throw guidanceError(new Error(`Scope authentication database is already in use by process ${record.pid}`), 'guid-4d0e1d42ebd8e25e');
            await unlink(path);
        }
    }
    throw guidanceError(new Error('Unable to acquire scope authentication database lock'), 'guid-31d4049410295b1f');
}
async function releaseAuthFileLock(lock) {
    await lock.handle.close().catch(() => undefined);
    try {
        const record = JSON.parse(await readFile(lock.path, 'utf8'));
        if (record.nonce === lock.nonce)
            await unlink(lock.path);
    }
    catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            throw error;
    }
}
function tokenDigest(token) {
    return createHash('sha256').update(token).digest('hex');
}
function validatePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
        throw guidanceError(new Error(`password must be at least ${PASSWORD_MIN_LENGTH} characters`), 'guid-c4efdaab0980464f');
    }
    if (password.length > 1024)
        throw guidanceError(new Error('password is too long'), 'guid-43926910ec5451ff');
    return password;
}
async function passwordDigest(password, salt) {
    return await scrypt(password, salt, 32);
}
/**
 * Persistent model/agent accounts with process-local bearer sessions.
 * Passwords and raw session tokens are never written to disk.
 */
export class ScopeAuthService {
    enterpriseRegistry;
    authPath;
    authLockPath;
    moderatorAccounts;
    commandCenterId;
    sessions = new Map();
    loginFailures = new Map();
    loginWindow = { startedAt: Date.now(), count: 0 };
    registrationWindow = { startedAt: Date.now(), count: 0 };
    dummySalt = randomBytes(16);
    mutationQueue = Promise.resolve();
    databaseCache;
    databaseInFlight;
    principalCache;
    constructor(vaultPath, options = {}) {
        this.enterpriseRegistry = options.enterpriseRegistry;
        if (this.enterpriseRegistry && !options.authPath)
            throw guidanceError(new Error('Enterprise authentication requires an explicit host-private account store'), 'guid-5684d8bebbaf600d');
        if (this.enterpriseRegistry && options.authPath) {
            if (!isAbsolute(options.authPath))
                throw guidanceError(new Error('Enterprise account store must use an absolute path'), 'guid-f863721fba805398');
            const canonical = (path) => {
                if (existsSync(path))
                    return realpathSync(path);
                const parent = dirname(path);
                return parent === path ? path : join(canonical(parent), relative(parent, path));
            };
            const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
            const packageRoot = basename(moduleRoot) === 'dist' ? dirname(moduleRoot) : moduleRoot;
            for (const protectedPath of [vaultPath, packageRoot, ...(options.protectedServicePaths ?? [])]) {
                const child = relative(canonical(resolve(protectedPath)).toLowerCase(), canonical(resolve(options.authPath)).toLowerCase());
                if (!child || (!child.startsWith('..') && !isAbsolute(child)))
                    throw guidanceError(new Error('Enterprise account store must be outside the Vault and protected service directories'), 'guid-f6ded6094e327fe8');
            }
        }
        this.authPath = options.authPath ? resolve(options.authPath) : join(resolve(vaultPath), '.mcpvault', 'scope-auth.json');
        this.authLockPath = this.enterpriseRegistry ? `${this.authPath}.lock` : join(resolve(vaultPath), '.mcpvault', 'scope-auth.lock');
        const configured = options.moderatorAccounts || String(process.env.MCPVAULT_MODERATOR_ACCOUNTS || '').split(',');
        this.moderatorAccounts = new Set(configured.map(value => String(value).trim().toLowerCase()).filter(Boolean));
        this.commandCenterId = normalizeScopeId(options.commandCenterId || process.env.MCPVAULT_COMMAND_CENTER_ID || 'local', 'commandCenterId');
    }
    effectiveCapabilities(principal) {
        const mode = this.enterpriseRegistry?.getPolicy().mode;
        const capabilities = Array.from(new Set(principal.capabilities || this.defaultCapabilities(principal.role)))
            .filter(capability => !mode || (capability !== 'whisper' && (mode !== 'public' || capability !== 'chat')));
        if (this.moderatorAccounts.has(principal.accountId))
            capabilities.push('moderate');
        return Array.from(new Set(capabilities));
    }
    async readDatabase(fresh = false) {
        const cached = this.databaseCache;
        if (!fresh && cached && cached.expiresAt > Date.now())
            return cached.value;
        if (!fresh && this.databaseInFlight)
            return this.databaseInFlight;
        const computation = (async () => {
            try {
                const parsed = JSON.parse(await readFile(this.authPath, 'utf8'));
                if (parsed.version !== AUTH_VERSION || !Array.isArray(parsed.accounts)) {
                    throw guidanceError(new Error('Unsupported or corrupt scope authentication database'), 'guid-ff0f1da51d90dfd7');
                }
                if (!parsed.accounts.every(isStoredAccount))
                    throw guidanceError(new Error('Unsupported or corrupt scope authentication database'), 'guid-ff0f1da51d90dfd7');
                const accountIds = new Set();
                const agentIds = new Set();
                for (const account of parsed.accounts) {
                    if (accountIds.has(account.accountId) || (account.agentId && agentIds.has(account.agentId))) {
                        throw guidanceError(new Error('Unsupported or corrupt scope authentication database'), 'guid-ff0f1da51d90dfd7');
                    }
                    accountIds.add(account.accountId);
                    if (account.agentId)
                        agentIds.add(account.agentId);
                }
                return { version: AUTH_VERSION, accounts: parsed.accounts };
            }
            catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                    return { version: AUTH_VERSION, accounts: [] };
                }
                throw error;
            }
        })();
        // Host workers need a new disk snapshot even while a legacy read is in flight.
        // Keep the forced read independent of both short-lived cache publications.
        if (fresh)
            return computation;
        this.databaseInFlight = computation;
        try {
            const database = await computation;
            this.databaseCache = { expiresAt: Date.now() + AUTH_DATABASE_CACHE_TTL_MS, value: database };
            return database;
        }
        finally {
            if (this.databaseInFlight === computation)
                this.databaseInFlight = undefined;
        }
    }
    async writeDatabase(database) {
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
    defaultCapabilities(role) {
        return [...(role === 'agent' ? DEFAULT_AGENT_CAPABILITIES : DEFAULT_MODEL_CAPABILITIES)];
    }
    async exclusive(operation) {
        let release;
        const previous = this.mutationQueue;
        this.mutationQueue = new Promise((resolvePromise) => { release = resolvePromise; });
        await previous;
        let fileLock;
        try {
            fileLock = await acquireAuthFileLock(this.authLockPath);
            // Another process may have committed while this instance's short cache
            // was still warm. Always reload under the OS lock before read-modify-write.
            this.databaseCache = undefined;
            this.principalCache = undefined;
            return await operation();
        }
        finally {
            if (fileLock)
                await releaseAuthFileLock(fileLock).catch(() => undefined);
            release();
        }
    }
    consumeLoginAttempt() {
        const now = Date.now();
        if (now - this.loginWindow.startedAt >= LOGIN_WINDOW_MS)
            this.loginWindow = { startedAt: now, count: 0 };
        if (this.loginWindow.count >= MAX_LOGIN_ATTEMPTS_PER_WINDOW) {
            throw guidanceError(new Error('Too many login attempts; try again later'), 'guid-d92cd92d632ce5a6');
        }
        this.loginWindow.count += 1;
        for (const [accountId, failure] of this.loginFailures) {
            if (failure.blockedUntil > 0 && failure.blockedUntil <= now)
                this.loginFailures.delete(accountId);
        }
    }
    consumeRegistrationAttempt() {
        const now = Date.now();
        if (now - this.registrationWindow.startedAt >= REGISTRATION_WINDOW_MS) {
            this.registrationWindow = { startedAt: now, count: 0 };
        }
        if (this.registrationWindow.count >= MAX_REGISTRATION_ATTEMPTS_PER_WINDOW) {
            throw guidanceError(new Error('Too many registration attempts; try again later'), 'guid-93c307ec5aadc4f1');
        }
        this.registrationWindow.count += 1;
    }
    rememberLoginFailure(accountId, previous) {
        if (!this.loginFailures.has(accountId) && this.loginFailures.size >= MAX_LOGIN_FAILURE_ENTRIES) {
            const oldest = this.loginFailures.keys().next().value;
            if (typeof oldest === 'string')
                this.loginFailures.delete(oldest);
        }
        const count = (previous?.blockedUntil && previous.blockedUntil <= Date.now() ? 0 : previous?.count || 0) + 1;
        this.loginFailures.set(accountId, {
            count,
            blockedUntil: count >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_BLOCK_MS : 0,
        });
    }
    authenticate(accessToken) {
        if (typeof accessToken !== 'string' || !accessToken) {
            if (this.enterpriseRegistry)
                throw guidanceError(new Error('Enterprise authentication is required; use the administrator invitation or log in'), 'guid-7571c6963333e20b');
            return undefined;
        }
        const key = tokenDigest(accessToken);
        const session = this.sessions.get(key);
        if (!session)
            throw guidanceError(new Error('Invalid access token; call login_scope again'), 'guid-61fb9739883ff60c');
        if (session.expiresAt <= Date.now()) {
            this.sessions.delete(key);
            throw guidanceError(new Error('Access token expired; call login_scope again'), 'guid-c7bcb3b8d59984a9');
        }
        if (this.enterpriseRegistry) {
            const verified = this.assertEnterprisePrincipal(session.principal);
            this.enterpriseRegistry.assertSessionLease({ agentId: session.principal.agentId, sessionId: session.principal.sessionId, generation: session.principal.sessionGeneration });
            return { ...session.principal, capabilities: this.effectiveCapabilities(session.principal), enterprise: {
                    mode: verified.policy.mode, realmId: verified.policy.realmId, runtimeId: verified.runtime.runtimeId,
                    sharedMemoryEnabled: verified.employee.sharedMemoryEnabled, ...verifiedDepartments(verified.employee),
                } };
        }
        return { ...session.principal, capabilities: this.effectiveCapabilities(session.principal) };
    }
    /** Called before auth endpoints as well, preventing REST/stdio from bypassing mTLS. */
    requireEnterpriseRuntime() {
        if (!this.enterpriseRegistry)
            return undefined;
        const context = getEnterpriseRequestContext();
        if (context?.transport !== 'http' || !context.certFingerprint)
            throw guidanceError(new Error('An authenticated runtime client certificate is required'), 'guid-852ad1ae20b64785');
        return this.enterpriseRegistry.resolveRequestCertificate(context.certFingerprint);
    }
    assertEnterprisePrincipal(principal) {
        const registry = this.enterpriseRegistry;
        const runtime = this.requireEnterpriseRuntime();
        const policy = registry.getPolicy();
        const binding = registry.getBinding(principal.accountId);
        if (!binding)
            throw guidanceError(new Error('No administrator-approved account binding'), 'guid-c114a811f3229f7a');
        return registry.assertBinding({ ...binding, accountId: principal.accountId, agentId: principal.agentId, userId: principal.userId, modelId: principal.modelId,
            runtimeId: runtime.runtimeId, realmId: policy.realmId, mode: policy.mode, certFingerprint: getEnterpriseRequestContext().certFingerprint });
    }
    async enterpriseSession(principal, params) {
        const registry = this.enterpriseRegistry;
        const verified = this.assertEnterprisePrincipal(principal);
        const sessionId = normalizeScopeId(params.sessionId || '', 'sessionId');
        const active = registry.getSessionLease(principal.agentId);
        if (active && Date.parse(active.expiresAt) > Date.now() && active.sessionId !== sessionId && params.expectedGeneration === undefined) {
            throw guidanceError(new Error(`An active session holds this agent; explicit handoff expectedGeneration=${active.generation} is required`), 'guid-5fa3568695bfd16a');
        }
        const expiresAt = Date.now() + SESSION_TTL_MS;
        const lease = await registry.claimSessionLease({ agentId: principal.agentId, sessionId,
            expectedGeneration: params.expectedGeneration ?? registry.getSessionGeneration(principal.agentId), expiresAt: new Date(expiresAt).toISOString() });
        const identity = authorIdentity(principal, verified.binding.role || verified.binding.displayLabel, (await this.readDatabase()).accounts);
        const next = { ...principal, capabilities: this.effectiveCapabilities(principal), ...identity, sessionId, sessionGeneration: lease.generation,
            enterprise: { mode: verified.policy.mode, realmId: verified.policy.realmId, runtimeId: verified.runtime.runtimeId, sharedMemoryEnabled: verified.employee.sharedMemoryEnabled,
                ...verifiedDepartments(verified.employee) } };
        const accessToken = randomBytes(32).toString('base64url');
        this.sessions.set(tokenDigest(accessToken), { principal: next, expiresAt });
        return { success: true, accessToken, expiresAt: new Date(expiresAt).toISOString(), principal: next };
    }
    async registerEnterprise(params) {
        const registry = this.enterpriseRegistry;
        const runtime = this.requireEnterpriseRuntime();
        if (!params.invitationToken)
            throw guidanceError(new Error('An administrator invitation is required'), 'guid-86665d30dfbde3b7');
        const password = validatePassword(params.password);
        this.consumeRegistrationAttempt();
        const policy = registry.getPolicy();
        const reserved = await registry.reserveInvite({ secret: params.invitationToken, realmId: policy.realmId, mode: policy.mode,
            runtimeId: runtime.runtimeId, certFingerprint: getEnterpriseRequestContext().certFingerprint });
        const binding = reserved.binding;
        if (params.accountId !== binding.accountId || params.agentId !== binding.agentId || params.modelId !== binding.modelId
            || (params.userId !== undefined && params.userId !== binding.userId))
            throw guidanceError(new Error('Registration identity must match the administrator invitation binding'), 'guid-259e7e4be2592911');
        if (params.departmentId !== undefined) {
            const department = normalizeScopeId(params.departmentId, 'departmentId');
            const employee = registry.getEmployee(binding.userId);
            if (department !== params.departmentId || !employee?.departmentIds?.includes(department)) {
                throw new Error('Department claim requires administrator-verified membership');
            }
        }
        const principal = await this.exclusive(async () => {
            const database = await this.readDatabase();
            const existing = database.accounts.find(account => account.accountId === binding.accountId);
            if (existing) {
                if (existing.registrationId !== reserved.registrationId || existing.userId !== binding.userId || existing.agentId !== binding.agentId
                    || existing.modelId !== binding.modelId || existing.commandCenterId !== policy.realmId)
                    throw guidanceError(new Error('Account is already bound to a different registration'), 'guid-e0ca904616a8250d');
                const digest = await passwordDigest(password, Buffer.from(existing.salt, 'base64'));
                if (!timingSafeEqual(digest, Buffer.from(existing.passwordHash, 'base64')))
                    throw guidanceError(new Error('Invalid registration credentials'), 'guid-d8e9967c80dd93d3');
                const { salt: _salt, passwordHash: _hash, createdAt: _created, registrationId: _registration, ...identity } = existing;
                return identity;
            }
            if (database.accounts.length >= MAX_ACCOUNTS || database.accounts.some(account => account.agentId === binding.agentId))
                throw guidanceError(new Error('Account capacity or agent identity conflict'), 'guid-480202c7a519fbbe');
            if (database.accounts.filter(account => account.userId === binding.userId).length >= MAX_ACCOUNTS_PER_USER)
                throw guidanceError(new Error('Employee account capacity reached'), 'guid-2ba21a8f88c5bcc3');
            const identity = { accountId: binding.accountId, agentId: binding.agentId, modelId: binding.modelId,
                userId: binding.userId, commandCenterId: policy.realmId, role: 'agent', capabilities: this.defaultCapabilities('agent') };
            const salt = randomBytes(16);
            const digest = await passwordDigest(password, salt);
            await this.writeDatabase({ ...database, accounts: [...database.accounts, { ...identity, salt: salt.toString('base64'), passwordHash: digest.toString('base64'),
                        registrationId: reserved.registrationId, createdAt: new Date().toISOString() }] });
            return identity;
        });
        await registry.completeInvite({ registrationId: reserved.registrationId });
        return { ...await this.enterpriseSession(principal, params), next: 'Keep this agent identity for the next session; use explicit generation handoff for a different active session.' };
    }
    async register(params) {
        if (params.accountType !== undefined && !['personal', 'enterprise'].includes(params.accountType))
            throw new Error('Invalid account type');
        if (params.accountType !== undefined && params.accountType !== (this.enterpriseRegistry ? 'enterprise' : 'personal')) {
            throw new Error('Account type must match the personal or enterprise host authority');
        }
        if (!this.enterpriseRegistry && params.departmentId !== undefined)
            throw new Error('Department claims require an enterprise host');
        if (this.enterpriseRegistry)
            return this.registerEnterprise(params);
        const accountId = normalizeScopeId(params.accountId, 'accountId');
        const modelId = normalizeScopeId(params.modelId, 'modelId');
        const agentId = params.agentId ? normalizeScopeId(params.agentId, 'agentId') : undefined;
        const password = validatePassword(params.password);
        const sponsor = this.authenticate(params.accessToken);
        const requestedUserId = params.userId ? normalizeScopeId(params.userId, 'userId') : undefined;
        const userId = requestedUserId || sponsor?.userId || accountId;
        if (sponsor?.userId && requestedUserId && sponsor.userId !== requestedUserId) {
            throw guidanceError(new Error('An agent must use the sponsoring model owner\'s userId; different users cannot share a family scope'), 'guid-ff05e0ff40a1adaa');
        }
        if (agentId) {
            if (sponsor && (sponsor.role !== 'model' || sponsor.modelId !== modelId)) {
                throw guidanceError(new Error('Only an authenticated owner of this model scope may register an agent account under it'), 'guid-80e4bf87b4671766');
            }
            // A first-time session may claim its own agent identity. This keeps
            // model-level ownership meaningful while allowing multiple sessions of
            // the same model family (for example, several Codex workers) to sign up
            // independently with distinct agentIds.
        }
        else if (sponsor) {
            throw guidanceError(new Error('A model account is self-registered only while its model scope is unclaimed'), 'guid-49d1ff3caec4c152');
        }
        this.consumeRegistrationAttempt();
        const principal = await this.exclusive(async () => {
            const database = await this.readDatabase();
            if (database.accounts.length >= MAX_ACCOUNTS) {
                throw guidanceError(new Error(`Account capacity reached (${MAX_ACCOUNTS}); ask the server operator to remove inactive accounts`), 'guid-055a9a2cf6523359');
            }
            const accountsForUser = database.accounts.filter(account => (account.userId || account.accountId) === userId).length;
            if (accountsForUser >= MAX_ACCOUNTS_PER_USER) {
                throw guidanceError(new Error(`User family account capacity reached (${MAX_ACCOUNTS_PER_USER})`), 'guid-2216cb60f6c936e8');
            }
            if (database.accounts.some(account => account.accountId === accountId)) {
                throw guidanceError(new Error(`Account already exists: ${accountId}`), 'guid-4a88d23ca4350a2a');
            }
            if (!agentId && database.accounts.some(account => account.role === 'model' && account.modelId === modelId)) {
                throw guidanceError(new Error(`Model scope is already claimed: ${modelId}`), 'guid-06962a47f16b1fac');
            }
            if (agentId && database.accounts.some(account => account.agentId === agentId)) {
                throw guidanceError(new Error(`Agent scope is already claimed: ${agentId}`), 'guid-a353fff6febcd84a');
            }
            const salt = randomBytes(16);
            const hash = await passwordDigest(password, salt);
            const principal = {
                accountId,
                modelId,
                ...(agentId && { agentId }),
                userId,
                commandCenterId: this.commandCenterId,
                role: agentId ? 'agent' : 'model',
                capabilities: this.defaultCapabilities(agentId ? 'agent' : 'model'),
            };
            const account = {
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
        // Runtime-only opaque delivery identity, not a persistent agent identity or
        // caller-selected session. It lets read receipts distinguish separate logins.
        const sessionPrincipal = { ...principal, sessionId: randomBytes(16).toString('hex') };
        this.sessions.set(tokenDigest(accessToken), { principal: sessionPrincipal, expiresAt });
        return {
            success: true,
            accessToken,
            expiresAt: new Date(expiresAt).toISOString(),
            principal: { ...sessionPrincipal, capabilities: this.effectiveCapabilities(principal) },
            next: 'Use accessToken for get_agent_pulse and public/private tools; keep the password in the host secret store for future sessions.',
        };
    }
    async login(params) {
        this.requireEnterpriseRuntime();
        const accountId = normalizeScopeId(params.accountId, 'accountId');
        const password = validatePassword(params.password);
        const failure = this.loginFailures.get(accountId);
        if (failure?.blockedUntil && failure.blockedUntil > Date.now()) {
            throw guidanceError(new Error('Too many failed login attempts; try again later'), 'guid-4eabe69c34114732');
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
            throw guidanceError(new Error('Invalid account or password'), 'guid-41cc828259f82ace');
        }
        if (account.commandCenterId && account.commandCenterId !== this.commandCenterId) {
            throw guidanceError(new Error('This account belongs to a different command center'), 'guid-a628d4af94fccb87');
        }
        this.loginFailures.delete(accountId);
        const accessToken = randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + SESSION_TTL_MS;
        const principal = {
            accountId: account.accountId,
            modelId: account.modelId,
            ...(account.agentId && { agentId: account.agentId }),
            userId: account.userId || account.accountId,
            commandCenterId: account.commandCenterId || this.commandCenterId,
            role: account.role,
            capabilities: Array.isArray(account.capabilities)
                ? account.capabilities.filter((capability) => SCOPE_CAPABILITIES.includes(capability))
                : this.defaultCapabilities(account.role),
        };
        const effectivePrincipal = { ...principal, capabilities: this.effectiveCapabilities(principal) };
        if (this.enterpriseRegistry)
            return this.enterpriseSession(effectivePrincipal, params);
        const sessionPrincipal = { ...effectivePrincipal, sessionId: randomBytes(16).toString('hex') };
        this.sessions.set(tokenDigest(accessToken), { principal: sessionPrincipal, expiresAt });
        return { success: true, accessToken, expiresAt: new Date(expiresAt).toISOString(), principal: sessionPrincipal };
    }
    logout(accessToken) {
        if (this.enterpriseRegistry)
            this.authenticate(accessToken);
        if (typeof accessToken !== 'string' || !accessToken)
            throw guidanceError(new Error('accessToken is required'), 'guid-f562b6c2bcf192b1');
        this.sessions.delete(tokenDigest(accessToken));
        return { success: true };
    }
    whoami(accessToken) {
        return this.authenticate(accessToken) || {
            role: 'global',
            note: guidanceText('guid-6685dc6096206864', 'No access token supplied. Only the public global scope is accessible.'),
        };
    }
    async endSession(accessToken) {
        if (!this.enterpriseRegistry)
            return this.logout(accessToken);
        const principal = this.authenticate(accessToken);
        if (this.enterpriseRegistry && principal)
            await this.enterpriseRegistry.releaseSessionLease({
                agentId: principal.agentId, sessionId: principal.sessionId, expectedGeneration: principal.sessionGeneration,
            });
        if (typeof accessToken === 'string')
            this.sessions.delete(tokenDigest(accessToken));
        return { success: true };
    }
    async handoffEnterpriseSession(accessToken, params) {
        const principal = this.authenticate(accessToken);
        if (!this.enterpriseRegistry || !principal?.enterprise || params.agentId !== principal.agentId
            || (params.fromSessionId !== undefined && params.fromSessionId !== principal.sessionId))
            throw guidanceError(new Error('Session handoff is not authorized'), 'guid-14f0345c872c9367');
        const lease = await this.enterpriseRegistry.claimSessionLease({ agentId: principal.agentId, sessionId: normalizeScopeId(params.toSessionId, 'toSessionId'),
            expectedGeneration: params.expectedGeneration, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
        return { success: true, agentId: principal.agentId, generation: lease.generation, currentSession: lease.sessionId,
            nextAction: { tool: 'call_endpoint', arguments: { endpointId: 'auth.login', arguments: { accountId: principal.accountId, sessionId: lease.sessionId } } } };
    }
    async listPrincipals(options = {}) {
        const cached = this.principalCache;
        if (!options.fresh && !this.enterpriseRegistry && cached && cached.expiresAt > Date.now()) {
            return cached.value.map(principal => ({ ...principal, ...(principal.capabilities && { capabilities: [...principal.capabilities] }) }));
        }
        const database = await this.readDatabase(options.fresh);
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
                    ? account.capabilities.filter((capability) => SCOPE_CAPABILITIES.includes(capability))
                    : this.defaultCapabilities(account.role),
            }),
        }));
        if (this.enterpriseRegistry) {
            const registry = this.enterpriseRegistry;
            const policy = registry.getPolicy();
            return value.flatMap(principal => {
                const binding = registry.getBinding(principal.accountId);
                const employee = binding && registry.getEmployee(binding.userId);
                if (!binding || !employee?.active || binding.agentId !== principal.agentId || binding.userId !== principal.userId || binding.modelId !== principal.modelId)
                    return [];
                try {
                    registry.assertRegisteredBinding(binding);
                }
                catch {
                    return [];
                }
                return [{ ...principal, ...authorIdentity(principal, binding.role || binding.displayLabel, value),
                        enterprise: { mode: policy.mode, realmId: policy.realmId, runtimeId: binding.runtimeId, sharedMemoryEnabled: employee.sharedMemoryEnabled,
                            ...verifiedDepartments(employee) } }];
            });
        }
        if (!options.fresh)
            this.principalCache = { expiresAt: Date.now() + AUTH_DATABASE_CACHE_TTL_MS, value };
        return value.map(principal => ({ ...principal, ...(principal.capabilities && { capabilities: [...principal.capabilities] }) }));
    }
    async updateAgentCapabilities(params) {
        const sponsor = this.authenticate(params.accessToken);
        if (!sponsor || sponsor.role !== 'model')
            throw guidanceError(new Error('Only an authenticated model owner can change agent capabilities'), 'guid-5d25b2ec92a12894');
        const agentId = normalizeScopeId(params.agentId, 'agentId');
        if (!Array.isArray(params.capabilities) || params.capabilities.length === 0)
            throw guidanceError(new Error('capabilities must be a non-empty array'), 'guid-b607dd35e595d945');
        const capabilities = Array.from(new Set(params.capabilities.map(String)));
        if (capabilities.some(capability => !SCOPE_CAPABILITIES.includes(capability))) {
            throw guidanceError(new Error(`capabilities must be chosen from: ${SCOPE_CAPABILITIES.join(', ')}`), 'guid-5df485ae2f8a5865');
        }
        if (capabilities.includes('moderate'))
            throw guidanceError(new Error('moderate capability is reserved for accounts configured by the server operator'), 'guid-0820e356b2033c7f');
        return await this.exclusive(async () => {
            const database = await this.readDatabase();
            const account = database.accounts.find(candidate => candidate.agentId === agentId);
            if (!account || account.modelId !== sponsor.modelId || (sponsor.userId && (account.userId || account.accountId) !== sponsor.userId)) {
                throw guidanceError(new Error(`Agent account '${agentId}' does not belong to this model/user scope`), 'guid-dcc78dd6bca1a8bb');
            }
            await this.writeDatabase({
                ...database,
                accounts: database.accounts.map(candidate => candidate === account ? { ...candidate, capabilities } : candidate),
            });
            for (const [key, session] of this.sessions) {
                if (session.principal.agentId === agentId)
                    this.sessions.delete(key);
            }
            return { success: true, agentId, capabilities };
        });
    }
    hasCapability(principal, capability) {
        return Boolean(principal && this.effectiveCapabilities(principal).includes(capability));
    }
    async changePassword(params) {
        const principal = this.authenticate(params.accessToken);
        if (!principal)
            throw guidanceError(new Error('accessToken is required'), 'guid-f562b6c2bcf192b1');
        const currentPassword = validatePassword(params.currentPassword);
        const newPassword = validatePassword(params.newPassword);
        await this.exclusive(async () => {
            const database = await this.readDatabase();
            const account = database.accounts.find(candidate => candidate.accountId === principal.accountId);
            if (!account)
                throw guidanceError(new Error('Account no longer exists'), 'guid-7759a3091578ea45');
            const current = await passwordDigest(currentPassword, Buffer.from(account.salt, 'base64'));
            const expected = Buffer.from(account.passwordHash, 'base64');
            if (current.length !== expected.length || !timingSafeEqual(current, expected)) {
                throw guidanceError(new Error('Current password is incorrect'), 'guid-c5a8dd67d69eb5e2');
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
            if (session.principal.accountId === principal.accountId)
                this.sessions.delete(key);
        }
        return { success: true };
    }
}
