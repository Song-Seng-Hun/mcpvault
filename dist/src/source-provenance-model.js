import { guidanceError } from './guidance-runtime.js';
const REVISION = /^[0-9a-f]{64}$/;
const RELATIONS = new Set(['quotation', 'adaptation', 'republication']);
const MAX_PATH = 500;
const CONTROL = /[\u0000-\u001f\u007f]/;
const CAUTION_LIMIT = 12;
function canonicalPath(value) {
    if (typeof value !== 'string')
        throw guidanceError(new TypeError('invalid path'), 'guid-4a17424f1909b9ae');
    if (value !== value.trim() || value.trim().length === 0)
        throw guidanceError(new TypeError('invalid path'), 'guid-4a17424f1909b9ae');
    const path = value.replaceAll('\\', '/');
    if (path.length > MAX_PATH || CONTROL.test(path) || path.startsWith('/') || path.includes(':')) {
        throw guidanceError(new TypeError('invalid path'), 'guid-4a17424f1909b9ae');
    }
    const parts = path.split('/');
    if (parts.some(part => part.length === 0 || part === '.' || part === '..'))
        throw guidanceError(new TypeError('invalid path'), 'guid-4a17424f1909b9ae');
    return path;
}
function record(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw guidanceError(new TypeError('invalid derivation'), 'guid-c5e64e50eedd8661');
    return value;
}
export function normalizeSourceDerivations(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw guidanceError(new TypeError('derivations must be an array'), 'guid-6fd2105c8446c51d');
    if (value.length > 8)
        throw guidanceError(new RangeError('too many derivations'), 'guid-2e6154e42040ea32');
    const paths = new Set();
    return value.map(item => {
        const entry = record(item);
        const keys = Object.keys(entry);
        if (keys.length !== 3 || !keys.every(key => key === 'path' || key === 'revision' || key === 'relation'))
            throw guidanceError(new TypeError('invalid derivation fields'), 'guid-90e147a47abe726b');
        const path = canonicalPath(entry.path);
        const pathKey = path.toLocaleLowerCase('en-US');
        if (paths.has(pathKey))
            throw guidanceError(new TypeError('duplicate derivation path'), 'guid-f60fdd7597ee6150');
        paths.add(pathKey);
        if (typeof entry.revision !== 'string' || !REVISION.test(entry.revision))
            throw guidanceError(new TypeError('invalid derivation revision'), 'guid-19ac652e91422a91');
        if (typeof entry.relation !== 'string' || !RELATIONS.has(entry.relation))
            throw guidanceError(new TypeError('invalid derivation relation'), 'guid-354c99a8cb978975');
        return { path, revision: entry.revision.toLowerCase(), relation: entry.relation };
    });
}
function validWorkId(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
}
function nodeSnapshot(node, requestedPath, expectedRevision) {
    if (node === null || typeof node !== 'object' || node.integrity !== true || typeof node.path !== 'string' || canonicalPath(node.path).toLocaleLowerCase('en-US') !== requestedPath.toLocaleLowerCase('en-US') || typeof node.revision !== 'string' || !REVISION.test(node.revision))
        throw guidanceError(new TypeError('invalid node'), 'guid-e241479c248e24a2');
    if (expectedRevision !== undefined && node.revision !== expectedRevision)
        throw guidanceError(new RangeError('stale revision'), 'guid-7291687700d499b4');
    if (Object.prototype.hasOwnProperty.call(node, 'workId') && node.workId !== undefined && !validWorkId(node.workId))
        throw guidanceError(new TypeError('invalid work id'), 'guid-73054aa5d2e82d51');
    const snapshot = { path: requestedPath, revision: node.revision };
    if (validWorkId(node.workId))
        snapshot.workId = node.workId;
    return snapshot;
}
export async function traceSourceOrigins(seedPaths, load) {
    const cautions = [];
    const caution = (code) => { if (!cautions.includes(code) && cautions.length < CAUTION_LIMIT)
        cautions.push(code); };
    let unresolved = false;
    let truncated = false;
    const seeds = [];
    const seedKeys = new Set();
    for (const value of Array.isArray(seedPaths) ? seedPaths : []) {
        try {
            const path = canonicalPath(value);
            const key = path.toLocaleLowerCase('en-US');
            if (!seedKeys.has(key)) {
                if (seeds.length < 12) {
                    seeds.push(path);
                    seedKeys.add(key);
                }
                else {
                    truncated = true;
                    caution('seed_limit');
                }
            }
        }
        catch {
            unresolved = true;
            caution('invalid_seed_path');
        }
    }
    const cache = new Map();
    const rejectedCacheKeys = new Set();
    const snapshots = new Map();
    const reaches = new Map();
    const edges = new Map();
    let loads = 0;
    const keyOf = (path) => path.toLocaleLowerCase('en-US');
    const connect = (a, b) => { if (!edges.has(a))
        edges.set(a, new Set()); if (!edges.has(b))
        edges.set(b, new Set()); edges.get(a).add(b); edges.get(b).add(a); };
    const loadNode = async (path, expectedRevision) => {
        const key = keyOf(path);
        if (cache.has(key)) {
            if (rejectedCacheKeys.has(key))
                return undefined;
            const cached = cache.get(key);
            if (!cached) {
                unresolved = true;
                caution('ancestor_unavailable');
                return undefined;
            }
            try {
                const snapshot = nodeSnapshot(cached, path, expectedRevision);
                snapshots.set(key, snapshot);
                return cached;
            }
            catch (error) {
                if (!(error instanceof RangeError))
                    rejectedCacheKeys.add(key);
                unresolved = true;
                caution(error instanceof RangeError ? 'stale_revision' : cached.integrity === false ? 'integrity_failed' : 'malformed_node');
                return undefined;
            }
        }
        if (loads >= 20) {
            unresolved = true;
            truncated = true;
            caution('load_limit');
            return undefined;
        }
        loads++;
        let loaded;
        try {
            loaded = await load(path);
        }
        catch {
            loaded = undefined;
        }
        cache.set(key, loaded);
        if (loaded === undefined) {
            unresolved = true;
            caution('ancestor_unavailable');
            return undefined;
        }
        try {
            const snapshot = nodeSnapshot(loaded, path);
            if (expectedRevision !== undefined && loaded.revision !== expectedRevision)
                throw guidanceError(new RangeError('stale revision'), 'guid-7291687700d499b4');
            snapshots.set(key, snapshot);
            return loaded;
        }
        catch (error) {
            if (!(error instanceof RangeError))
                rejectedCacheKeys.add(key);
            unresolved = true;
            caution(error instanceof RangeError ? 'stale_revision' : loaded.integrity === false ? 'integrity_failed' : 'malformed_node');
            return undefined;
        }
    };
    const walk = async (path, seedIndex, depth, stack) => {
        const key = keyOf(path);
        const node = cache.get(key);
        if (!node || !snapshots.has(key))
            return;
        if (!reaches.has(key))
            reaches.set(key, new Set());
        reaches.get(key).add(seedIndex);
        let derivations;
        try {
            derivations = normalizeSourceDerivations(node.derivations);
        }
        catch {
            unresolved = true;
            caution('malformed_derivations');
            return;
        }
        if (derivations.length === 0) {
            unresolved = true;
            caution('ancestry_not_recorded');
            return;
        }
        for (const derivation of derivations) {
            const childKey = keyOf(derivation.path);
            if (stack.has(childKey)) {
                unresolved = true;
                caution('cycle_detected');
                continue;
            }
            if (depth >= 4) {
                unresolved = true;
                truncated = true;
                caution('depth_limit');
                continue;
            }
            const child = await loadNode(derivation.path, derivation.revision);
            if (!child)
                continue;
            connect(key, childKey);
            await walk(derivation.path, seedIndex, depth + 1, new Set(stack).add(childKey));
        }
    };
    const seedSnapshots = [];
    for (let index = 0; index < seeds.length; index++) {
        const path = seeds[index];
        const loaded = await loadNode(path);
        if (loaded) {
            const key = keyOf(path);
            seedSnapshots.push({ path, key, index });
            await walk(path, index, 0, new Set([key]));
        }
    }
    for (const [key, snapshot] of snapshots) {
        if (!snapshot.workId)
            continue;
        const sameWork = [...snapshots.values()].some(other => other !== snapshot && other.workId?.toLocaleLowerCase('en-US') === snapshot.workId.toLocaleLowerCase('en-US'));
        if (sameWork)
            for (const otherKey of snapshots.keys())
                if (snapshots.get(otherKey)?.workId?.toLocaleLowerCase('en-US') === snapshot.workId.toLocaleLowerCase('en-US'))
                    connect(key, otherKey);
    }
    const workReach = new Map();
    for (const [key, snapshot] of snapshots) {
        if (!snapshot.workId)
            continue;
        const workKey = snapshot.workId.toLocaleLowerCase('en-US');
        if (!workReach.has(workKey))
            workReach.set(workKey, new Set());
        for (const seedIndex of reaches.get(key) ?? [])
            workReach.get(workKey).add(seedIndex);
    }
    const seen = new Set();
    const groups = [];
    for (const seed of seedSnapshots) {
        if (seen.has(seed.key))
            continue;
        const component = new Set([seed.key]);
        const queue = [seed.key];
        while (queue.length)
            for (const next of edges.get(queue.shift()) ?? [])
                if (!component.has(next)) {
                    component.add(next);
                    queue.push(next);
                }
        component.forEach(key => seen.add(key));
        const sourcePaths = seedSnapshots.filter(item => component.has(item.key)).map(item => item.path).slice(0, 12);
        const sharedOriginCandidates = [...component].filter(key => {
            const snapshot = snapshots.get(key);
            const workKey = snapshot?.workId?.toLocaleLowerCase('en-US');
            return (reaches.get(key)?.size ?? 0) > 1 || (workKey !== undefined && (workReach.get(workKey)?.size ?? 0) > 1);
        }).map(key => snapshots.get(key)).filter(Boolean);
        if (sharedOriginCandidates.length > 4) {
            truncated = true;
            unresolved = true;
            caution('origin_limit');
        }
        const sharedOrigins = sharedOriginCandidates.slice(0, 4);
        groups.push({ sourcePaths, sharedOrigins });
    }
    if (groups.length > 12) {
        groups.length = 12;
        truncated = true;
        caution('group_limit');
    }
    if (truncated)
        unresolved = true;
    const hasShared = groups.some(group => group.sharedOrigins.length > 0);
    const hardFailure = cautions.some(code => code !== 'ancestry_not_recorded');
    const status = seedSnapshots.length === 0 ? 'no_sources' : hardFailure ? 'partial' : hasShared ? 'shared_origin_observed' : 'separately_recorded_origins';
    return { status, groups, unresolved, truncated, cautions, notice: 'Observed source-level overlap is not claim-specific proof; separate records, missing ancestry, and repeated agents do not prove independence.' };
}
