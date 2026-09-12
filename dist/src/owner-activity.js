import { createHash } from 'node:crypto';
const activities = ['collaboration', 'ideation-research', 'explanation-translation',
    'benchmarks', 'economy', 'roleplay', 'skill-evolution'];
const actions = ['discover', 'read', 'claim', 'execute'];
const invalid = () => new Error('Invalid owner activity policy');
const isId = (value) => typeof value === 'string'
    && value.length >= 1 && value.length <= 100 && /^[a-z0-9]/.test(value) && !/[^a-z0-9._-]/.test(value);
const isActivity = (value) => typeof value === 'string' && activities.includes(value);
const isAction = (value) => typeof value === 'string' && actions.includes(value);
/** Accept plain data properties only; never evaluate caller getters or toJSON.
 * Inputs are JSON-like host data, not executable objects or hostile Proxies. */
function record(value, max, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype)
        throw invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.length > max)
        throw invalid();
    const result = Object.create(null);
    for (const key of keys) {
        if (typeof key !== 'string' || required && !required.includes(key) && !optional.includes(key))
            throw invalid();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
            throw invalid();
        result[key] = descriptor.value;
    }
    if (required?.some(key => !Object.hasOwn(result, key)))
        throw invalid();
    return result;
}
function array(value, max, min = 0) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
        || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1)
        throw invalid();
    const result = [];
    for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
            throw invalid();
        result.push(descriptor.value);
    }
    return result;
}
function list(value, valid) {
    const items = array(value, 32, 1);
    const result = [];
    for (const item of items) {
        if (!valid(item))
            throw invalid();
        result.push(item);
    }
    if (new Set(result).size !== result.length)
        throw invalid();
    return Object.freeze(result.sort());
}
/** Reject aliases rather than normalizing them into an authorized name.
 * Matching is case-sensitive even on a case-insensitive host, hence conservative.
 * Host normalization/PathFilter must additionally resolve physical aliases and
 * symlinks; lexical owner consent cannot establish filesystem identity. */
function isPath(value) {
    if (typeof value !== 'string' || !value || value.length > 500 || value.normalize('NFC') !== value
        || /[\\:*?\[\]{}|<>"%#~\x00-\x1f\x7f\p{Cf}\p{Cs}]/u.test(value))
        return false;
    if (value === '.')
        return true;
    return value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..'
        && part === part.trim() && !/[. ]$/.test(part)
        && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part));
}
function expiry(value) {
    if (typeof value !== 'string' || value.length !== 20 && value.length !== 24
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
        throw invalid();
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds))
        throw invalid();
    const canonical = new Date(milliseconds).toISOString();
    if (canonical !== (value.length === 20 ? value.replace('Z', '.000Z') : value))
        throw invalid();
    return canonical;
}
const deny = (reason) => ({ allowed: false, reason, permissionsGranted: false });
/** Immutable snapshot of validated host policy. The host must replace this
 * instance after revocation/config changes and use the CURRENT instance for
 * discovery, candidate reads, claim and execution. A previous decision is not
 * a reusable authorization token. This is only an additional consent gate;
 * normal document ACLs, PathFilter and execution verification still apply.
 * Main work/personal memory classification is the host's responsibility.
 */
export class OwnerActivityPolicy {
    fingerprint;
    #owners;
    #grants;
    constructor(input) {
        const raw = record(input, 3, ['version', 'owners', 'grants']);
        if (raw.version !== 1)
            throw invalid();
        const bindings = record(raw.owners, 256);
        const owners = Object.create(null);
        for (const account of Object.keys(bindings).sort()) {
            const owner = bindings[account];
            if (!isId(account) || !isId(owner))
                throw invalid();
            owners[account] = owner;
        }
        const ids = new Set();
        const grants = array(raw.grants, 256).map(value => {
            const grant = record(value, 10, ['id', 'ownerId', 'accountIds', 'activities', 'actions',
                'dataPrefixes', 'executionTargets', 'expiresAt'], ['revoked']);
            if (!isId(grant.id) || ids.has(grant.id) || !isId(grant.ownerId)
                || Object.hasOwn(grant, 'revoked') && typeof grant.revoked !== 'boolean')
                throw invalid();
            ids.add(grant.id);
            const accounts = list(grant.accountIds, isId);
            if (accounts.some(account => owners[account] !== grant.ownerId))
                throw invalid();
            return Object.freeze({ id: grant.id, ownerId: grant.ownerId, accountIds: accounts,
                activities: list(grant.activities, isActivity), actions: list(grant.actions, isAction),
                dataPrefixes: list(grant.dataPrefixes, isPath), executionTargets: list(grant.executionTargets, isId),
                expiresAt: expiry(grant.expiresAt), revoked: grant.revoked === true });
        }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        this.#owners = Object.freeze(owners);
        this.#grants = Object.freeze(grants);
        // All order-insensitive lists/bindings are sorted; optional revoked defaults
        // to false and UTC seconds normalize to milliseconds before hashing.
        this.fingerprint = createHash('sha256').update(JSON.stringify({ version: 1,
            owners: this.#owners, grants: this.#grants })).digest('hex');
        Object.freeze(this);
    }
    /** Directory-walk hint for one host-selected grant. This never authorizes
     * the directory, a child, body, output or action. Exact children must still
     * pass decision() with the same grant selected by the runtime. */
    canTraverse(grantId, directoryPath) {
        if (!isId(grantId) || !isPath(directoryPath))
            return false;
        const grant = this.#grants.find(candidate => candidate.id === grantId);
        if (!grant)
            return false;
        return grant.dataPrefixes.some(prefix => prefix === '.'
            || directoryPath === '.' && prefix !== '.'
            || directoryPath !== prefix && prefix.startsWith(`${directoryPath}/`));
    }
    /** Opaque generation of every currently usable grant for one catalog
     * activity/action. IDs and expiries never leave the trusted host boundary. */
    availabilityGeneration(request) {
        const { accountId, executionTarget, activity, action, now } = request;
        if (!isId(accountId) || !isId(executionTarget) || !isActivity(activity) || !isAction(action)
            || typeof now !== 'number' || !Number.isSafeInteger(now))
            return 'unavailable';
        const owner = this.#owners[accountId];
        if (!owner)
            return 'unavailable';
        const available = this.#grants.filter(grant => grant.ownerId === owner && grant.accountIds.includes(accountId)
            && grant.activities.includes(activity) && grant.actions.includes(action)
            && grant.executionTargets.includes(executionTarget) && !grant.revoked && now < Date.parse(grant.expiresAt))
            .map(grant => [grant.id, grant.expiresAt]);
        return createHash('sha256').update(JSON.stringify(available)).digest('hex').slice(0, 32);
    }
    /** After request validation, bounded grant stages are activity/action, target,
     * paths, revocation and expiry. A valid alternative wins; no other account's
     * grants are diagnosed.
     * The returned grantId identifies only the single successful whole grant. */
    decision(request) {
        let input;
        try {
            input = record(request, 6, ['accountId', 'executionTarget', 'activity', 'action'], ['paths', 'now']);
        }
        catch {
            return deny('consent_required');
        }
        const { accountId, executionTarget, activity, action, now } = input;
        if (!isId(accountId) || !isId(executionTarget) || !isActivity(activity) || !isAction(action))
            return deny('consent_required');
        const owner = this.#owners[accountId];
        if (owner === undefined)
            return deny('owner_unknown');
        if (typeof now !== 'number' || !Number.isSafeInteger(now) || Math.abs(now) > 8640000000000000)
            return deny('consent_required');
        let paths;
        try {
            if (!Object.hasOwn(input, 'paths')) {
                if (action !== 'discover')
                    return deny('data_scope_mismatch');
                paths = [];
            }
            else {
                const values = array(input.paths, 32);
                paths = [];
                for (const value of values) {
                    if (!isPath(value))
                        return deny('data_scope_mismatch');
                    paths.push(value);
                }
            }
        }
        catch {
            return deny('data_scope_mismatch');
        }
        let candidates = this.#grants.filter(grant => grant.ownerId === owner && grant.accountIds.includes(accountId)
            && grant.activities.includes(activity) && grant.actions.includes(action));
        if (!candidates.length)
            return deny('consent_required');
        candidates = candidates.filter(grant => grant.executionTargets.includes(executionTarget));
        if (!candidates.length)
            return deny('execution_target_mismatch');
        candidates = candidates.filter(grant => paths.every(path => grant.dataPrefixes.some(prefix => prefix === '.' || path === prefix || path.startsWith(`${prefix}/`))));
        if (!candidates.length)
            return deny('data_scope_mismatch');
        candidates = candidates.filter(grant => !grant.revoked);
        if (!candidates.length)
            return deny('revoked');
        const grant = candidates.find(candidate => now < Date.parse(candidate.expiresAt));
        if (!grant)
            return deny('expired');
        return { allowed: true, reason: 'granted', grantId: grant.id, permissionsGranted: false };
    }
}
