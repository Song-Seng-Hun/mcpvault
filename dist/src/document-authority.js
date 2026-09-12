import { posix } from 'node:path';
import { createHash } from 'node:crypto';
const invalid = () => new Error('Invalid or cyclic protected document policy');
const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
export function documentPolicyPath(value) {
    if (typeof value !== 'string' || !value || value.length > 32768 || value !== value.trim() || /^[\\/]|:|[\x00-\x1f\x7f]/.test(value))
        throw invalid();
    const path = value.replace(/\\/g, '/');
    if (path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)))
        throw invalid();
    return posix.normalize(path).toLowerCase();
}
function identifiers(value) {
    if (value === undefined)
        return;
    if (!Array.isArray(value) || !value.length || value.length > 128 || value.some(v => !id(v)) || new Set(value).size !== value.length)
        throw invalid();
    return Object.freeze([...value]);
}
/** Fixed lossless capture layout: the Markdown envelope and its raw companion
 * are one source family for restrictions only, never for granting scope access. */
function capturedSourceFamily(path) {
    const match = /^(?:(.*)\/)?_sources\/([^/]+)\.md$/.exec(path)
        ?? /^(?:(.*)\/)?_sources\/([^/]+)\/original\.[a-z0-9]+$/.exec(path)
        ?? /^(?:(.*)\/)?_sources\/([^/]+)$/.exec(path);
    return match ? `${match[1] ? `${match[1]}/` : ''}_sources/${match[2]}` : undefined;
}
/** Disposable compiled lookup. Exact path/prefix/ancestry lookups replace
 * repeated whole-policy scans; all constraints combine by intersection. */
export class DocumentAuthority {
    fingerprint;
    rules;
    exact = new Map();
    prefixes = new Map();
    resolved = new Map();
    effective = new Map();
    sourceFamilies = new Map();
    constructor(input) {
        if (!Array.isArray(input) || input.length > 4096)
            throw invalid();
        for (const raw of input) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['path', 'recursive', 'confidential', 'realmId', 'departmentIds', 'accountIds', 'derivedFrom'].includes(k))
                || raw.recursive !== undefined && typeof raw.recursive !== 'boolean'
                || raw.confidential !== undefined && typeof raw.confidential !== 'boolean'
                || raw.realmId !== undefined && !id(raw.realmId))
                throw invalid();
            const path = documentPolicyPath(raw.path), departments = identifiers(raw.departmentIds), accounts = identifiers(raw.accountIds);
            if (departments && !raw.realmId)
                throw invalid();
            if (this.exact.has(path))
                throw invalid();
            let derivedFrom;
            if (raw.derivedFrom !== undefined) {
                if (!Array.isArray(raw.derivedFrom) || !raw.derivedFrom.length || raw.derivedFrom.length > 32)
                    throw invalid();
                const parents = raw.derivedFrom.map(documentPolicyPath);
                if (new Set(parents).size !== parents.length)
                    throw invalid();
                derivedFrom = Object.freeze(parents);
            }
            const rule = Object.freeze({ path, ...(raw.recursive !== undefined && { recursive: raw.recursive }),
                ...(raw.confidential !== undefined && { confidential: raw.confidential }), ...(raw.realmId && { realmId: raw.realmId }),
                ...(departments && { departmentIds: departments }), ...(accounts && { accountIds: accounts }), ...(derivedFrom && { derivedFrom }) });
            this.exact.set(path, rule);
            if (rule.recursive)
                this.prefixes.set(path, rule);
            const family = capturedSourceFamily(path);
            if (family)
                this.sourceFamilies.set(family, [...(this.sourceFamilies.get(family) ?? []), path]);
        }
        // Validate ancestry before ANY public read, including unrelated paths.
        for (const path of this.exact.keys())
            this.constraints(path);
        for (const path of this.exact.keys())
            this.effectiveConstraints(path);
        this.rules = Object.freeze([...this.exact.values()].sort((a, b) => a.path.localeCompare(b.path)));
        this.fingerprint = createHash('sha256').update(JSON.stringify(this.rules)).digest('hex');
    }
    /** Apply source-family equivalence to every ancestor. Equivalence itself is
     * not a derivation cycle; explicit ancestry cycles were validated above. */
    effectiveConstraints(pathInput) {
        const path = documentPolicyPath(pathInput), cached = this.effective.get(path);
        if (cached)
            return cached;
        const pending = [path], seen = new Set(), result = new Set();
        while (pending.length) {
            const next = pending.pop();
            if (seen.has(next))
                continue;
            seen.add(next);
            if (seen.size > 1024)
                throw invalid();
            const family = capturedSourceFamily(next);
            if (family)
                pending.push(...(this.sourceFamilies.get(family) ?? []));
            for (const rule of this.constraints(next)) {
                result.add(rule);
                if (result.size > 128)
                    throw invalid();
                pending.push(rule.path, ...(rule.derivedFrom ?? []));
            }
        }
        const value = Object.freeze([...result]);
        if (this.exact.has(path))
            this.effective.set(path, value);
        return value;
    }
    constraints(pathInput, visiting = new Set()) {
        const path = documentPolicyPath(pathInput), cached = this.resolved.get(path);
        if (cached)
            return cached;
        if (visiting.has(path) || visiting.size >= 32)
            throw invalid();
        visiting.add(path);
        const own = [], exact = this.exact.get(path);
        if (exact)
            own.push(exact);
        for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
            const prefix = this.prefixes.get(path.slice(0, slash));
            if (prefix)
                own.push(prefix);
        }
        const result = new Set(own);
        for (const rule of own)
            for (const parent of rule.derivedFrom ?? [])
                for (const inherited of this.constraints(parent, visiting)) {
                    result.add(inherited);
                    if (result.size > 128)
                        throw invalid();
                }
        visiting.delete(path);
        const value = Object.freeze([...result]);
        // Unknown path strings are supplied by clients; do not grow an unbounded cache.
        if (this.exact.has(path))
            this.resolved.set(path, value);
        return value;
    }
    canRead(path, principal, localInferenceAllowed) {
        if (!path || path === '.')
            return true;
        const constraints = this.effectiveConstraints(path);
        return constraints.every(rule => {
            if (rule.confidential && (!principal || localInferenceAllowed?.(principal) !== true))
                return false;
            if (rule.realmId && (principal?.enterprise?.mode !== 'company' || principal.enterprise.realmId !== rule.realmId))
                return false;
            if (rule.departmentIds && !rule.departmentIds.some(department => principal?.enterprise?.departmentIds?.includes(department)))
                return false;
            return !rule.accountIds || Boolean(principal && rule.accountIds.includes(principal.accountId));
        });
    }
    canFlow(container, source) {
        const target = this.effectiveConstraints(container), origin = this.effectiveConstraints(source);
        const accountSets = target.flatMap(rule => rule.accountIds ? [rule.accountIds] : []);
        const accounts = accountSets.length ? accountSets.reduce((a, b) => a.filter(id => b.includes(id))) : undefined;
        return origin.every(rule => (!rule.confidential || target.some(t => t.confidential))
            && (!rule.realmId || target.some(t => t.realmId === rule.realmId))
            && (!rule.accountIds || accounts !== undefined && accounts.every(id => rule.accountIds.includes(id)))
            && (!rule.departmentIds || target.some(t => t.realmId === rule.realmId && t.departmentIds?.every(id => rule.departmentIds.includes(id)))));
    }
}
export function documentAuthorityReader(options) {
    let prior, authority;
    const immutable = new WeakSet();
    return () => {
        const rules = options.documentRules?.();
        if (rules === undefined)
            return undefined;
        // Only frozen definitions have identity-stable semantics; host reload returns
        // a new frozen definition. Mutable in-process callers get fresh validation.
        if (rules !== prior || !immutable.has(rules)) {
            authority = new DocumentAuthority(rules);
            prior = rules;
            if (Object.isFrozen(rules) && rules.every(rule => Object.isFrozen(rule)
                && [rule.departmentIds, rule.accountIds, rule.derivedFrom].every(list => list === undefined || Object.isFrozen(list))))
                immutable.add(rules);
        }
        return authority;
    };
}
