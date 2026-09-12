import { guidanceError } from './guidance-runtime.js';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { chmod, mkdir, open as openFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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
const DEPARTMENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_EMPLOYEE_DEPARTMENTS = 32;
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function canonicalPath(value) {
    let existing = resolve(value);
    const suffix = [];
    while (!existsSync(existing)) {
        const parent = dirname(existing);
        if (parent === existing)
            return resolve(value);
        suffix.unshift(basename(existing));
        existing = parent;
    }
    try {
        return resolve(realpathSync.native(existing), ...suffix);
    }
    catch {
        return resolve(value);
    }
}
function isPathInside(parent, target) {
    const parentPath = canonicalPath(parent).toLowerCase();
    const targetPath = canonicalPath(target).toLowerCase();
    const child = relative(parentPath, targetPath);
    return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}
function assertOutside(path, protectedPaths, label) {
    if (!isAbsolute(path))
        throw guidanceError(new Error(`${label} must be an explicit absolute path`), 'guid-622ae60cd2274500');
    if (protectedPaths.some(protectedPath => isPathInside(protectedPath, path))) {
        throw guidanceError(new Error(`${label} must be outside the Vault and all protected service directories`), 'guid-20f74f0535d1dbf2');
    }
}
function normalizeCertificate(value) {
    const fingerprint = String(value || '').trim().toLowerCase().replaceAll(':', '');
    if (!CERTIFICATE_PATTERN.test(fingerprint))
        throw guidanceError(new Error('certFingerprint must be a 64-character SHA-256 fingerprint'), 'guid-521edb0025572c7f');
    return fingerprint;
}
function normalizeOptionalText(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_TEXT_LENGTH) {
        throw guidanceError(new Error(`${field} must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`), 'guid-80da8ff98d7f8ddc');
    }
    return value.trim();
}
function validateEmployeeDepartments(value) {
    const validId = (id) => typeof id === 'string'
        && id === id.trim() && DEPARTMENT_ID_PATTERN.test(id);
    const { departmentIds, defaultDepartmentId } = value;
    const departments = {};
    if (departmentIds !== undefined) {
        if (!Array.isArray(departmentIds) || departmentIds.length > MAX_EMPLOYEE_DEPARTMENTS
            || !Array.from(departmentIds).every(validId) || new Set(departmentIds).size !== departmentIds.length) {
            throw new Error('departmentIds must contain at most 32 unique opaque lowercase IDs of 1-64 characters');
        }
        departments.departmentIds = [...departmentIds];
    }
    if (defaultDepartmentId !== undefined) {
        if (!validId(defaultDepartmentId) || !departments.departmentIds?.includes(defaultDepartmentId)) {
            throw new Error('defaultDepartmentId must be a valid ID in departmentIds');
        }
        departments.defaultDepartmentId = defaultDepartmentId;
    }
    return departments;
}
function assertDepartmentRevision(value, field) {
    if (!Number.isSafeInteger(value) || Number(value) < 0)
        throw new Error(`${field} must be a non-negative safe integer`);
}
function normalizeBinding(value) {
    if (!isRecord(value))
        throw guidanceError(new Error('binding is required'), 'guid-1913f728c9f36b89');
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
function sameBinding(left, right) {
    return left.accountId === right.accountId
        && left.agentId === right.agentId
        && left.userId === right.userId
        && left.modelId === right.modelId
        && left.runtimeId === right.runtimeId
        && left.displayLabel === right.displayLabel
        && left.role === right.role;
}
function sameBindingIdentity(left, right) {
    return left.accountId === right.accountId
        && left.agentId === right.agentId
        && left.userId === right.userId
        && left.modelId === right.modelId
        && left.runtimeId === right.runtimeId;
}
function parseTimestamp(value, field) {
    if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value)))
        throw guidanceError(new Error(`${field} must be an ISO timestamp`), 'guid-19e9477a9c3a1ba9');
    return new Date(value).toISOString();
}
function sleep(ms) {
    return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}
function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return !(isRecord(error) && error.code === 'ESRCH');
    }
}
function entryCapacity(database, key) {
    if (database[key].length >= MAX_ENTRIES)
        throw guidanceError(new Error(`${key} capacity reached (${MAX_ENTRIES})`), 'guid-a0d463f5f4bec0f9');
}
function validateDatabase(value, expectedVaultPath) {
    if (!isRecord(value) || value.version !== REGISTRY_VERSION || !isRecord(value.profile))
        throw guidanceError(new Error('corrupt enterprise registry'), 'guid-50b11807feb66974');
    const profile = {
        mode: value.profile.mode === 'public' || value.profile.mode === 'company' ? value.profile.mode : (() => { throw guidanceError(new Error('corrupt enterprise registry'), 'guid-50b11807feb66974'); })(),
        realmId: normalizeScopeId(String(value.profile.realmId || ''), 'realmId'),
        vaultPath: canonicalPath(String(value.profile.vaultPath || '')),
    };
    if (profile.vaultPath.toLowerCase() !== canonicalPath(expectedVaultPath).toLowerCase())
        throw guidanceError(new Error('enterprise registry belongs to a different Vault'), 'guid-804b1a93df31110a');
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
        || !Array.isArray(sessionLeasesRaw) || sessionLeasesRaw.length > MAX_ENTRIES)
        throw guidanceError(new Error('corrupt enterprise registry'), 'guid-50b11807feb66974');
    try {
        const employees = employeesRaw.map((item) => {
            if (!isRecord(item) || typeof item.active !== 'boolean' || typeof item.sharedMemoryEnabled !== 'boolean')
                throw new Error();
            const departments = validateEmployeeDepartments(item);
            if (profile.mode === 'public' && departments.departmentIds?.length)
                throw new Error();
            if (item.departmentRevision !== undefined)
                assertDepartmentRevision(item.departmentRevision, 'departmentRevision');
            return {
                userId: normalizeScopeId(String(item.userId || ''), 'userId'), active: item.active, sharedMemoryEnabled: item.sharedMemoryEnabled,
                createdAt: parseTimestamp(item.createdAt, 'createdAt'),
                ...(item.disabledAt !== undefined && { disabledAt: parseTimestamp(item.disabledAt, 'disabledAt') }),
                ...departments,
                ...(item.departmentRevision !== undefined && { departmentRevision: item.departmentRevision }),
            };
        });
        const runtimes = runtimesRaw.map((item) => {
            if (!isRecord(item) || (item.kind !== 'external' && item.kind !== 'internal') || typeof item.active !== 'boolean')
                throw new Error();
            return {
                runtimeId: normalizeScopeId(String(item.runtimeId || ''), 'runtimeId'), kind: item.kind,
                certFingerprint: normalizeCertificate(item.certFingerprint), active: item.active,
                createdAt: parseTimestamp(item.createdAt, 'createdAt'),
                ...(item.disabledAt !== undefined && { disabledAt: parseTimestamp(item.disabledAt, 'disabledAt') }),
            };
        });
        const bindings = bindingsRaw.map((item) => normalizeBinding(item));
        const invites = invitesRaw.map((item) => {
            if (!isRecord(item) || !/^[a-f0-9]{64}$/.test(String(item.secretHash || '')))
                throw new Error();
            return {
                inviteId: normalizeScopeId(String(item.inviteId || ''), 'inviteId'), secretHash: String(item.secretHash),
                binding: normalizeBinding(item.binding), expiresAt: parseTimestamp(item.expiresAt, 'expiresAt'),
                createdAt: parseTimestamp(item.createdAt, 'createdAt'),
                ...(item.registrationId !== undefined && { registrationId: normalizeScopeId(String(item.registrationId), 'registrationId') }),
                ...(item.consumedAt !== undefined && { consumedAt: parseTimestamp(item.consumedAt, 'consumedAt') }),
            };
        });
        const registrations = registrationsRaw.map((item) => {
            if (!isRecord(item) || (item.status !== 'reserved' && item.status !== 'completed'))
                throw new Error();
            return {
                registrationId: normalizeScopeId(String(item.registrationId || ''), 'registrationId'), inviteId: normalizeScopeId(String(item.inviteId || ''), 'inviteId'),
                binding: normalizeBinding(item.binding), status: item.status,
                createdAt: parseTimestamp(item.createdAt, 'createdAt'),
                ...(item.completedAt !== undefined && { completedAt: parseTimestamp(item.completedAt, 'completedAt') }),
            };
        });
        const sessionLeases = sessionLeasesRaw.map((item) => {
            if (!isRecord(item) || !Number.isSafeInteger(item.generation) || Number(item.generation) < 0)
                throw new Error();
            const sessionId = normalizeOptionalText(item.sessionId, 'sessionId');
            const expiresAt = item.expiresAt === undefined ? undefined : parseTimestamp(item.expiresAt, 'expiresAt');
            if (Boolean(sessionId) !== Boolean(expiresAt))
                throw new Error();
            return {
                agentId: normalizeScopeId(String(item.agentId || ''), 'agentId'), generation: Number(item.generation),
                ...(sessionId && { sessionId }), ...(expiresAt && { expiresAt }),
            };
        });
        const unique = (items, select) => new Set(items.map(select)).size === items.length;
        if (!unique(employees, item => item.userId) || !unique(runtimes, item => item.runtimeId) || !unique(runtimes, item => item.certFingerprint)
            || !unique(invites, item => item.inviteId) || !unique(bindings, item => item.accountId) || !unique(bindings, item => item.agentId)
            || !unique(registrations, item => item.registrationId) || !unique(sessionLeases, item => item.agentId))
            throw new Error();
        if (runtimes.some(runtime => profile.mode === 'company' ? runtime.kind !== 'internal' : runtime.kind !== 'external'))
            throw new Error();
        return { version: 1, profile, employees, runtimes, invites, bindings, registrations, sessionLeases };
    }
    catch (error) {
        if (error instanceof Error && error.message === 'enterprise registry belongs to a different Vault')
            throw error;
        throw guidanceError(new Error('corrupt enterprise registry'), 'guid-50b11807feb66974');
    }
}
export class EnterpriseRegistry {
    registryPath;
    lockPath;
    vaultPath;
    protectedPaths;
    now;
    mutationQueue = Promise.resolve();
    constructor(options) {
        if (!options || typeof options.registryPath !== 'string' || typeof options.vaultPath !== 'string')
            throw guidanceError(new Error('registryPath and vaultPath are required'), 'guid-c70921b5014d543b');
        this.vaultPath = canonicalPath(options.vaultPath);
        const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
        const packageRoot = basename(moduleRoot) === 'dist' ? dirname(moduleRoot) : moduleRoot;
        this.protectedPaths = [this.vaultPath, canonicalPath(packageRoot), ...(options.servicePaths || []).map(canonicalPath)];
        assertOutside(options.registryPath, this.protectedPaths, 'Enterprise registry path');
        this.registryPath = canonicalPath(options.registryPath);
        this.lockPath = `${this.registryPath}.lock`;
        this.now = options.now || (() => new Date());
    }
    timestamp() {
        return this.now().toISOString();
    }
    readDatabase() {
        let size;
        try {
            size = statSync(this.registryPath).size;
        }
        catch (error) {
            if (isRecord(error) && error.code === 'ENOENT')
                throw guidanceError(new Error('Enterprise registry is not initialized'), 'guid-752e4be12a1b78f1');
            throw error;
        }
        if (size > MAX_DATABASE_BYTES)
            throw guidanceError(new Error('Enterprise registry is too large; refusing to read it'), 'guid-ed5aa3995994cf5c');
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(this.registryPath, 'utf8'));
        }
        catch {
            throw guidanceError(new Error('corrupt enterprise registry'), 'guid-50b11807feb66974');
        }
        return validateDatabase(parsed, this.vaultPath);
    }
    async writeDatabase(database) {
        const body = `${JSON.stringify(database, null, 2)}\n`;
        if (Buffer.byteLength(body) > MAX_DATABASE_BYTES)
            throw guidanceError(new Error('Enterprise registry is too large; refusing to write it'), 'guid-b1eeb3145e2817c8');
        await mkdir(dirname(this.registryPath), { recursive: true, mode: 0o700 });
        const temporary = `${this.registryPath}.${randomBytes(8).toString('hex')}.tmp`;
        try {
            await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            await rename(temporary, this.registryPath);
            await Promise.allSettled([chmod(dirname(this.registryPath), 0o700), chmod(this.registryPath, 0o600)]);
        }
        catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
    }
    async acquireLock() {
        await mkdir(dirname(this.lockPath), { recursive: true, mode: 0o700 });
        for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
            const nonce = randomBytes(16).toString('hex');
            try {
                const handle = await openFile(this.lockPath, 'wx');
                try {
                    await handle.writeFile(`${JSON.stringify({ pid: process.pid, nonce })}\n`, 'utf8');
                    await handle.sync();
                }
                catch (error) {
                    await handle.close().catch(() => undefined);
                    await unlink(this.lockPath).catch(() => undefined);
                    throw error;
                }
                return { handle, nonce };
            }
            catch (error) {
                if (!(isRecord(error) && error.code === 'EEXIST'))
                    throw error;
                let record;
                try {
                    record = JSON.parse(await readFile(this.lockPath, 'utf8'));
                }
                catch (readError) {
                    if (isRecord(readError) && readError.code === 'ENOENT')
                        continue;
                    throw guidanceError(new Error('Enterprise registry lock is corrupt; refusing to remove it automatically'), 'guid-12d3f8649a8afdf3');
                }
                if (!isRecord(record) || !Number.isSafeInteger(record.pid) || Number(record.pid) <= 0 || typeof record.nonce !== 'string' || !record.nonce) {
                    throw guidanceError(new Error('Enterprise registry lock is invalid; refusing to remove it automatically'), 'guid-5c37b8b89d0b2e5c');
                }
                if (!processIsAlive(Number(record.pid))) {
                    await unlink(this.lockPath);
                    continue;
                }
                await sleep(LOCK_WAIT_MS);
            }
        }
        throw guidanceError(new Error('Unable to acquire enterprise registry lock'), 'guid-6b4a59465ff40a82');
    }
    async releaseLock(lock) {
        await lock.handle.close().catch(() => undefined);
        try {
            const record = JSON.parse(await readFile(this.lockPath, 'utf8'));
            if (record.nonce === lock.nonce)
                await unlink(this.lockPath);
        }
        catch (error) {
            if (!(isRecord(error) && error.code === 'ENOENT'))
                throw error;
        }
    }
    async exclusive(operation) {
        let releaseQueue;
        const previous = this.mutationQueue;
        this.mutationQueue = new Promise(resolvePromise => { releaseQueue = resolvePromise; });
        await previous;
        let lock;
        try {
            lock = await this.acquireLock();
            return await operation();
        }
        finally {
            if (lock)
                await this.releaseLock(lock).catch(() => undefined);
            releaseQueue();
        }
    }
    assertRuntimeMode(profile, kind) {
        if (profile.mode === 'company' && kind !== 'internal')
            throw guidanceError(new Error('Company mode permits internal runtimes only'), 'guid-b68188dcd9ff0d99');
        if (profile.mode === 'public' && kind !== 'external')
            throw guidanceError(new Error('Public mode permits external runtimes only'), 'guid-3d7e596aa314f350');
    }
    assertActive(database, binding, certFingerprint) {
        const employee = database.employees.find(item => item.userId === binding.userId);
        if (!employee)
            throw guidanceError(new Error(`Unknown enterprise employee: ${binding.userId}`), 'guid-fa77b46d6e0bca27');
        if (!employee.active)
            throw guidanceError(new Error(`Enterprise employee is disabled: ${binding.userId}`), 'guid-577e119b6df7aebc');
        const runtime = database.runtimes.find(item => item.runtimeId === binding.runtimeId);
        if (!runtime)
            throw guidanceError(new Error(`Unknown enterprise runtime: ${binding.runtimeId}`), 'guid-cee936246b89d804');
        if (!runtime.active)
            throw guidanceError(new Error(`Enterprise runtime is disabled: ${binding.runtimeId}`), 'guid-006f7acac47c0e81');
        if (runtime.certFingerprint !== certFingerprint)
            throw guidanceError(new Error('Request certificate does not match the assigned runtime'), 'guid-1e9d83a350a9b3b0');
        this.assertRuntimeMode(database.profile, runtime.kind);
        return { employee, runtime };
    }
    async initialize(profileInput) {
        const profile = {
            mode: profileInput.mode,
            realmId: normalizeScopeId(profileInput.realmId, 'realmId'),
            vaultPath: canonicalPath(profileInput.vaultPath),
        };
        if (profile.mode !== 'public' && profile.mode !== 'company')
            throw guidanceError(new Error('mode must be public or company'), 'guid-57970225d28c73f8');
        if (profile.vaultPath.toLowerCase() !== this.vaultPath.toLowerCase())
            throw guidanceError(new Error('profile vaultPath must match the configured Vault'), 'guid-2a43f3b178dc4d87');
        return await this.exclusive(async () => {
            if (existsSync(this.registryPath)) {
                const existing = this.readDatabase().profile;
                if (existing.mode === profile.mode && existing.realmId === profile.realmId && existing.vaultPath.toLowerCase() === profile.vaultPath.toLowerCase()) {
                    await ensureEnterpriseVaultMarker(this.vaultPath, profile);
                    return existing;
                }
                throw guidanceError(new Error('Enterprise registry is already initialized with a different profile'), 'guid-fab0beae11fae37c');
            }
            await ensureEnterpriseVaultMarker(this.vaultPath, profile);
            await this.writeDatabase({ version: 1, profile, employees: [], runtimes: [], invites: [], bindings: [], registrations: [], sessionLeases: [] });
            return profile;
        });
    }
    getPolicy() {
        return this.readDatabase().profile;
    }
    getEmployee(userIdInput) {
        const userId = normalizeScopeId(userIdInput, 'userId');
        return this.readDatabase().employees.find(item => item.userId === userId);
    }
    async createEmployee(params) {
        const userId = normalizeScopeId(params.userId, 'userId');
        if (params.sharedMemoryEnabled !== undefined && typeof params.sharedMemoryEnabled !== 'boolean')
            throw guidanceError(new Error('sharedMemoryEnabled must be boolean'), 'guid-5fd94ae7c0bcddf6');
        const departments = validateEmployeeDepartments(params);
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            if (database.profile.mode !== 'company' && departments.departmentIds?.length)
                throw new Error('Public mode cannot grant company departments');
            entryCapacity(database, 'employees');
            if (database.employees.some(item => item.userId === userId))
                throw guidanceError(new Error(`Enterprise employee already exists: ${userId}`), 'guid-d28f2d52be263dff');
            const employee = { userId, active: true, sharedMemoryEnabled: params.sharedMemoryEnabled === true, createdAt: this.timestamp(),
                ...departments, ...(departments.departmentIds !== undefined && { departmentRevision: 0 }) };
            await this.writeDatabase({ ...database, employees: [...database.employees, employee] });
            return employee;
        });
    }
    /** Host administrator API only. Replaces memberships; an omitted default clears it. */
    async updateEmployeeDepartments(params) {
        const userId = normalizeScopeId(params.userId, 'userId');
        const departments = validateEmployeeDepartments(params);
        if (departments.departmentIds === undefined)
            throw new Error('departmentIds is required');
        const expectedRevision = params.expectedDepartmentRevision;
        assertDepartmentRevision(expectedRevision, 'expectedDepartmentRevision');
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            if (database.profile.mode !== 'company')
                throw new Error('Department updates require company mode');
            const employee = database.employees.find(item => item.userId === userId);
            if (!employee)
                throw guidanceError(new Error(`Unknown enterprise employee: ${userId}`), 'guid-fa77b46d6e0bca27');
            const currentRevision = employee.departmentRevision ?? 0;
            if (currentRevision !== expectedRevision)
                throw new Error(`Stale department revision: expected ${expectedRevision}, current ${currentRevision}`);
            if (currentRevision === Number.MAX_SAFE_INTEGER)
                throw new Error('departmentRevision capacity reached');
            const updated = { ...employee, ...departments, departmentRevision: currentRevision + 1 };
            if (departments.defaultDepartmentId === undefined)
                delete updated.defaultDepartmentId;
            await this.writeDatabase({ ...database, employees: database.employees.map(item => item.userId === userId ? updated : item) });
            return updated;
        });
    }
    async disableEmployee(params) {
        const userId = normalizeScopeId(params.userId, 'userId');
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            const employee = database.employees.find(item => item.userId === userId);
            if (!employee)
                throw guidanceError(new Error(`Unknown enterprise employee: ${userId}`), 'guid-fa77b46d6e0bca27');
            const disabled = employee.active ? { ...employee, active: false, disabledAt: this.timestamp() } : employee;
            await this.writeDatabase({ ...database, employees: database.employees.map(item => item.userId === userId ? disabled : item) });
            return disabled;
        });
    }
    async registerRuntime(params) {
        const runtimeId = normalizeScopeId(params.runtimeId, 'runtimeId');
        const fingerprint = normalizeCertificate(params.certFingerprint);
        if (params.kind !== 'internal' && params.kind !== 'external')
            throw guidanceError(new Error('runtime kind must be internal or external'), 'guid-9eaa6dc5f595e6fc');
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            this.assertRuntimeMode(database.profile, params.kind);
            entryCapacity(database, 'runtimes');
            if (database.runtimes.some(item => item.runtimeId === runtimeId))
                throw guidanceError(new Error(`Enterprise runtime already exists: ${runtimeId}`), 'guid-b5794b1794a318a8');
            if (database.runtimes.some(item => item.certFingerprint === fingerprint))
                throw guidanceError(new Error('Request certificate is already registered to another runtime'), 'guid-c17bd8cf504ec0b2');
            const runtime = { runtimeId, kind: params.kind, certFingerprint: fingerprint, active: true, createdAt: this.timestamp() };
            await this.writeDatabase({ ...database, runtimes: [...database.runtimes, runtime] });
            return runtime;
        });
    }
    async disableRuntime(params) {
        const runtimeId = normalizeScopeId(params.runtimeId, 'runtimeId');
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            const runtime = database.runtimes.find(item => item.runtimeId === runtimeId);
            if (!runtime)
                throw guidanceError(new Error(`Unknown enterprise runtime: ${runtimeId}`), 'guid-cee936246b89d804');
            const disabled = runtime.active ? { ...runtime, active: false, disabledAt: this.timestamp() } : runtime;
            await this.writeDatabase({ ...database, runtimes: database.runtimes.map(item => item.runtimeId === runtimeId ? disabled : item) });
            return disabled;
        });
    }
    async createInvite(params) {
        const normalizedBinding = normalizeBinding(params.binding);
        const expiresAt = parseTimestamp(params.expiresAt, 'expiresAt');
        if (Date.parse(expiresAt) <= this.now().getTime())
            throw guidanceError(new Error('expiresAt must be in the future'), 'guid-a1b211fe48b40a17');
        assertOutside(params.secretFile, this.protectedPaths, 'Invite secret file');
        const secretFile = canonicalPath(params.secretFile);
        if (secretFile.toLowerCase() === this.registryPath.toLowerCase() || secretFile.toLowerCase() === this.lockPath.toLowerCase()) {
            throw guidanceError(new Error('Invite secret file must not be the enterprise registry or its lock'), 'guid-5556b7edea4ff75d');
        }
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            entryCapacity(database, 'invites');
            if (database.bindings.some(item => item.accountId === normalizedBinding.accountId || item.agentId === normalizedBinding.agentId))
                throw guidanceError(new Error('Account or agent is already bound'), 'guid-b5ad143b529b15cb');
            if (database.registrations.some(item => item.status === 'completed' && (item.binding.accountId === normalizedBinding.accountId || item.binding.agentId === normalizedBinding.agentId)))
                throw guidanceError(new Error('Previously registered account or agent identifiers cannot be reassigned'), 'guid-1e9b9ba5aaebb011');
            if (database.invites.some(item => !item.consumedAt && (item.binding.accountId === normalizedBinding.accountId || item.binding.agentId === normalizedBinding.agentId)))
                throw guidanceError(new Error('An active invite already exists for this account or agent'), 'guid-d2545601f400e22b');
            const runtime = database.runtimes.find(item => item.runtimeId === normalizedBinding.runtimeId);
            const employee = database.employees.find(item => item.userId === normalizedBinding.userId);
            if (!employee?.active)
                throw guidanceError(new Error('Invite employee must exist and be active'), 'guid-ef6f19e5c4fd484a');
            if (!runtime?.active)
                throw guidanceError(new Error('Invite runtime must exist and be active'), 'guid-90c65b97972bf61a');
            const secret = randomBytes(32).toString('base64url');
            const inviteId = `invite-${randomBytes(12).toString('hex')}`;
            const stored = { inviteId, secretHash: createHash('sha256').update(secret).digest('hex'), binding: normalizedBinding, expiresAt, createdAt: this.timestamp() };
            await mkdir(dirname(secretFile), { recursive: true, mode: 0o700 });
            let createdSecretFile = false;
            try {
                const handle = await openFile(secretFile, 'wx', 0o600);
                createdSecretFile = true;
                try {
                    await handle.writeFile(`${secret}\n`, 'utf8');
                    await handle.sync();
                }
                finally {
                    await handle.close();
                }
                await chmod(secretFile, 0o600).catch(() => undefined);
                await this.writeDatabase({ ...database, invites: [...database.invites, stored] });
            }
            catch (error) {
                if (createdSecretFile)
                    await unlink(secretFile).catch(() => undefined);
                throw error;
            }
            return { inviteId, expiresAt, secretFile };
        });
    }
    validateReservation(database, input) {
        const fingerprint = normalizeCertificate(input.certFingerprint);
        const runtimeId = normalizeScopeId(input.runtimeId, 'runtimeId');
        const realmId = normalizeScopeId(input.realmId, 'realmId');
        const secretHash = createHash('sha256').update(String(input.secret || '')).digest('hex');
        const invite = database.invites.find(item => item.secretHash === secretHash);
        if (!invite)
            throw guidanceError(new Error('Invalid or used enterprise invite'), 'guid-686f18a23d499b8a');
        if (input.binding && !sameBinding(invite.binding, normalizeBinding(input.binding))) {
            throw guidanceError(new Error('Invite identity is predetermined; self-assigned identity is not allowed'), 'guid-044da821311fdef1');
        }
        if (invite.consumedAt && !invite.registrationId)
            throw guidanceError(new Error('Enterprise invite was already used'), 'guid-06d24577581ed3c2');
        if (Date.parse(invite.expiresAt) <= this.now().getTime() && !invite.registrationId)
            throw guidanceError(new Error('Enterprise invite expired'), 'guid-fe0497a7e2475b13');
        if (database.profile.realmId !== realmId)
            throw guidanceError(new Error('Enterprise invite belongs to a different realm'), 'guid-80752c4c469dbd5a');
        if (database.profile.mode !== input.mode)
            throw guidanceError(new Error('Enterprise invite mode does not match this command center'), 'guid-e322a859a315fba2');
        if (invite.binding.runtimeId !== runtimeId)
            throw guidanceError(new Error('Enterprise invite is assigned to a different runtime'), 'guid-742da69b81417d06');
        this.assertActive(database, invite.binding, fingerprint);
        return { invite, binding: invite.binding, fingerprint };
    }
    async reserveInvite(input) {
        if (typeof input.secret !== 'string' || input.secret.length < 40 || input.secret.length > 256)
            throw guidanceError(new Error('Invalid or used enterprise invite'), 'guid-686f18a23d499b8a');
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            const { invite, binding: reservedBinding } = this.validateReservation(database, input);
            if (invite.registrationId) {
                const registration = database.registrations.find(item => item.registrationId === invite.registrationId);
                if (!registration || !sameBinding(registration.binding, reservedBinding))
                    throw guidanceError(new Error('corrupt enterprise registry'), 'guid-50b11807feb66974');
                return { registrationId: registration.registrationId, binding: registration.binding };
            }
            entryCapacity(database, 'registrations');
            const registrationId = `registration-${randomBytes(12).toString('hex')}`;
            const registration = { registrationId, inviteId: invite.inviteId, binding: reservedBinding, status: 'reserved', createdAt: this.timestamp() };
            await this.writeDatabase({
                ...database,
                invites: database.invites.map(item => item.inviteId === invite.inviteId ? { ...item, registrationId } : item),
                registrations: [...database.registrations, registration],
            });
            return { registrationId, binding: reservedBinding };
        });
    }
    async completeInvite(params) {
        const registrationId = normalizeScopeId(params.registrationId, 'registrationId');
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            const registration = database.registrations.find(item => item.registrationId === registrationId);
            if (!registration)
                throw guidanceError(new Error(`Unknown enterprise registration: ${registrationId}`), 'guid-d85ea43e34c2fbf8');
            const invite = database.invites.find(item => item.inviteId === registration.inviteId && item.registrationId === registrationId);
            if (!invite || !sameBinding(invite.binding, registration.binding))
                throw guidanceError(new Error('corrupt enterprise registry'), 'guid-50b11807feb66974');
            const runtime = database.runtimes.find(item => item.runtimeId === registration.binding.runtimeId);
            if (!runtime)
                throw guidanceError(new Error('Enterprise runtime no longer exists'), 'guid-6366dc3ea6666144');
            this.assertActive(database, registration.binding, runtime.certFingerprint);
            if (registration.status === 'completed') {
                const existing = database.bindings.find(item => item.accountId === registration.binding.accountId);
                if (!existing || !sameBinding(existing, registration.binding))
                    throw guidanceError(new Error('corrupt enterprise registry'), 'guid-50b11807feb66974');
                return { registrationId, binding: existing };
            }
            entryCapacity(database, 'bindings');
            if (database.bindings.some(item => item.accountId === registration.binding.accountId || item.agentId === registration.binding.agentId))
                throw guidanceError(new Error('Account or agent binding conflicts with this registration'), 'guid-8f19008ca29bb70e');
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
    async redeemInvite(input, registerAccount) {
        const reserved = await this.reserveInvite(input);
        const database = this.readDatabase();
        const registration = database.registrations.find(item => item.registrationId === reserved.registrationId);
        if (registration?.status !== 'completed')
            await registerAccount(reserved.binding, reserved.registrationId);
        return await this.completeInvite({ registrationId: reserved.registrationId });
    }
    getBinding(accountIdInput) {
        const accountId = normalizeScopeId(accountIdInput, 'accountId');
        return this.readDatabase().bindings.find(item => item.accountId === accountId);
    }
    async disableAccount(params) {
        const accountId = normalizeScopeId(params.accountId, 'accountId');
        return this.exclusive(async () => {
            const database = this.readDatabase();
            const binding = database.bindings.find(item => item.accountId === accountId);
            if (!binding) {
                if (database.registrations.some(item => item.binding.accountId === accountId && item.status === 'completed'))
                    return { accountId, disabled: true };
                throw guidanceError(new Error('Unknown enterprise account'), 'guid-06857e36dec188b5');
            }
            await this.writeDatabase({ ...database,
                bindings: database.bindings.filter(item => item.accountId !== accountId),
                sessionLeases: database.sessionLeases.map(item => item.agentId === binding.agentId ? { agentId: item.agentId, generation: item.generation + 1 } : item),
            });
            return { accountId, disabled: true };
        });
    }
    assertRegisteredBinding(bindingInput) {
        const database = this.readDatabase();
        const expected = normalizeBinding(bindingInput);
        const stored = database.bindings.find(item => item.accountId === expected.accountId);
        if (!stored || !sameBindingIdentity(stored, expected))
            throw guidanceError(new Error('Enterprise account binding does not match the registered identity'), 'guid-631f25a28d47a721');
        const runtime = database.runtimes.find(item => item.runtimeId === stored.runtimeId);
        if (!runtime)
            throw guidanceError(new Error(`Unknown enterprise runtime: ${stored.runtimeId}`), 'guid-cee936246b89d804');
        const active = this.assertActive(database, stored, runtime.certFingerprint);
        return { binding: stored, ...active, policy: database.profile };
    }
    resolveRequestCertificate(certFingerprintInput) {
        const fingerprint = normalizeCertificate(certFingerprintInput);
        const runtime = this.readDatabase().runtimes.find(item => item.certFingerprint === fingerprint);
        if (!runtime)
            throw guidanceError(new Error('Request certificate is not registered'), 'guid-1e85a887213bdc41');
        if (!runtime.active)
            throw guidanceError(new Error(`Enterprise runtime is disabled: ${runtime.runtimeId}`), 'guid-006f7acac47c0e81');
        return runtime;
    }
    assertBinding(input) {
        const database = this.readDatabase();
        const expected = normalizeBinding(input);
        if (normalizeScopeId(input.realmId, 'realmId') !== database.profile.realmId)
            throw guidanceError(new Error('Enterprise binding belongs to a different realm'), 'guid-44d2781bb39e3c5d');
        if (input.mode !== database.profile.mode)
            throw guidanceError(new Error('Enterprise binding mode does not match this command center'), 'guid-6dc20fb62c37201f');
        const stored = database.bindings.find(item => item.accountId === expected.accountId);
        if (!stored || !sameBindingIdentity(stored, expected))
            throw guidanceError(new Error('Enterprise account binding does not match the registered identity'), 'guid-631f25a28d47a721');
        const active = this.assertActive(database, stored, normalizeCertificate(input.certFingerprint));
        return { binding: stored, ...active, policy: database.profile };
    }
    getSessionLease(agentIdInput) {
        const agentId = normalizeScopeId(agentIdInput, 'agentId');
        const record = this.readDatabase().sessionLeases.find(item => item.agentId === agentId);
        if (!record?.sessionId || !record.expiresAt || Date.parse(record.expiresAt) <= this.now().getTime())
            return undefined;
        return { agentId, sessionId: record.sessionId, generation: record.generation, expiresAt: record.expiresAt };
    }
    getSessionGeneration(agentIdInput) {
        const agentId = normalizeScopeId(agentIdInput, 'agentId');
        return this.readDatabase().sessionLeases.find(item => item.agentId === agentId)?.generation || 0;
    }
    async claimSessionLease(params) {
        const agentId = normalizeScopeId(params.agentId, 'agentId');
        const sessionId = normalizeOptionalText(params.sessionId, 'sessionId');
        if (!sessionId)
            throw guidanceError(new Error('sessionId is required'), 'guid-17efc95442af7d0e');
        if (!Number.isSafeInteger(params.expectedGeneration) || params.expectedGeneration < 0)
            throw guidanceError(new Error('expectedGeneration must be a non-negative safe integer'), 'guid-6683a0a54ca59d5d');
        const expiresAt = parseTimestamp(params.expiresAt, 'expiresAt');
        if (Date.parse(expiresAt) <= this.now().getTime())
            throw guidanceError(new Error('expiresAt must be in the future'), 'guid-a1b211fe48b40a17');
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            const current = database.sessionLeases.find(item => item.agentId === agentId);
            const currentGeneration = current?.generation || 0;
            if (currentGeneration !== params.expectedGeneration)
                throw guidanceError(new Error(`Stale session generation: expected ${params.expectedGeneration}, current ${currentGeneration}`), 'guid-996bbf0dfd95077a');
            if (!current)
                entryCapacity(database, 'sessionLeases');
            const lease = { agentId, sessionId, generation: currentGeneration + 1, expiresAt };
            const record = lease;
            await this.writeDatabase({ ...database, sessionLeases: current
                    ? database.sessionLeases.map(item => item.agentId === agentId ? record : item)
                    : [...database.sessionLeases, record] });
            return lease;
        });
    }
    assertSessionLease(params) {
        const agentId = normalizeScopeId(params.agentId, 'agentId');
        const sessionId = normalizeOptionalText(params.sessionId, 'sessionId');
        const lease = this.getSessionLease(agentId);
        if (!sessionId || !lease || lease.sessionId !== sessionId || lease.generation !== params.generation)
            throw guidanceError(new Error('Session does not hold the current enterprise writer lease'), 'guid-d106f85ab416354d');
        return lease;
    }
    async releaseSessionLease(params) {
        const agentId = normalizeScopeId(params.agentId, 'agentId');
        const sessionId = normalizeOptionalText(params.sessionId, 'sessionId');
        if (!sessionId)
            throw guidanceError(new Error('sessionId is required'), 'guid-17efc95442af7d0e');
        return await this.exclusive(async () => {
            const database = this.readDatabase();
            const current = database.sessionLeases.find(item => item.agentId === agentId);
            if (!current || current.generation !== params.expectedGeneration)
                throw guidanceError(new Error(`Stale session generation: expected ${params.expectedGeneration}, current ${current?.generation || 0}`), 'guid-996bbf0dfd95077a');
            if (current.sessionId !== sessionId)
                throw guidanceError(new Error('Session does not hold the current enterprise writer lease'), 'guid-d106f85ab416354d');
            const next = { agentId, generation: current.generation + 1 };
            await this.writeDatabase({ ...database, sessionLeases: database.sessionLeases.map(item => item.agentId === agentId ? next : item) });
            return next;
        });
    }
}
