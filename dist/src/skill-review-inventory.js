import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync, opendirSync } from 'node:fs';
import { resolve, join, relative, parse, isAbsolute } from 'node:path';
const LIMITS = { maxFiles: 4096, maxTotalBytes: 64 * 1024 * 1024, maxDepth: 32, maxDirectories: 2048, timeoutMs: 30000 };
const hash = (s) => createHash('sha256').update(s).digest('hex');
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function fail(code) { throw new Error(code); }
function options(input) {
    if (Object.keys(input).some(k => !Object.hasOwn(LIMITS, k)))
        fail('invalid_inventory_limit');
    const out = { ...LIMITS, ...input };
    for (const [key, value] of Object.entries(out))
        if (!Number.isSafeInteger(value) || value < (key === 'maxDepth' ? 0 : 1) || value > LIMITS[key])
            fail('invalid_inventory_limit');
    return out;
}
function unchanged(a, b) {
    return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.isFile() === b.isFile();
}
function binding(path) {
    const absolute = resolve(path), base = parse(absolute).root;
    let current = base, stat = lstatSync(base);
    for (const part of relative(base, absolute).split(/[\\/]/).filter(Boolean)) {
        current = join(current, part);
        stat = lstatSync(current);
        if (stat.isSymbolicLink())
            fail('linked_path');
    }
    // Every ancestor is still inspected on every call. Canonicalize the complete
    // path once: repeating realpath at each ancestor dominates bounded NAS scans.
    if (!same(realpathSync(absolute), absolute))
        fail('linked_path');
    return stat;
}
function names(dir, max) {
    const output = [], handle = opendirSync(dir);
    try {
        for (let entry; (entry = handle.readSync());) {
            if (output.length >= max)
                fail('entry_limit');
            output.push(entry.name);
        }
    }
    finally {
        handle.closeSync();
    }
    return output.sort(order);
}
function byteFile(root, path, before, remaining, check) {
    if (!before.isFile())
        fail('special_file');
    if (before.nlink > 1)
        fail('linked_file');
    if (before.size > remaining)
        fail('byte_limit');
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const held = fstatSync(fd);
        if (!unchanged(before, held))
            fail('file_changed');
        const digest = createHash('sha256'), buffer = Buffer.alloc(Math.min(65536, before.size + 1));
        let count = 0;
        for (;;) {
            check();
            const n = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - count + 1), count);
            if (!n)
                break;
            count += n;
            if (count > before.size || count > remaining)
                fail('file_changed');
            digest.update(buffer.subarray(0, n));
        }
        if (count !== before.size || !unchanged(held, fstatSync(fd)) || !unchanged(held, binding(path)))
            fail('file_changed');
        return { path: relative(root, path).replaceAll('\\', '/'), bytes: count, sha256: digest.digest('hex') };
    }
    finally {
        closeSync(fd);
    }
}
const CODES = new Set(['entry_limit', 'file_limit', 'directory_limit', 'depth_limit', 'byte_limit', 'time_limit', 'linked_file', 'linked_path', 'special_file', 'file_changed', 'directory_changed', 'root_changed', 'root_unavailable']);
function reason(error) { const code = error instanceof Error ? error.message : ''; return CODES.has(code) ? code : 'source_unavailable'; }
export async function snapshotSkillBundle(rootInput, input = {}) {
    const budget = options(input);
    if (typeof rootInput !== 'string' || !isAbsolute(rootInput))
        fail('absolute_source_root_required');
    const root = resolve(rootInput), rootId = hash(process.platform === 'win32' ? root.toLowerCase() : root);
    const result = { version: 1, rootId, complete: false, fingerprint: null, files: [], reasons: [], executionAuthorized: false };
    const deadline = Date.now() + budget.timeoutMs;
    const check = () => { if (Date.now() > deadline)
        fail('time_limit'); };
    try {
        const before = binding(root);
        if (!before.isDirectory())
            fail('root_unavailable');
        const pass = () => {
            let bytes = 0, dirs = 0;
            const files = [];
            const walk = (dir, depth) => {
                check();
                if (depth > budget.maxDepth)
                    fail('depth_limit');
                if (++dirs > budget.maxDirectories)
                    fail('directory_limit');
                const first = names(dir, budget.maxFiles + budget.maxDirectories);
                for (const name of first) {
                    check();
                    const path = join(dir, name), stat = binding(path);
                    if (stat.isDirectory())
                        walk(path, depth + 1);
                    else {
                        if (files.length >= budget.maxFiles)
                            fail('file_limit');
                        const row = byteFile(root, path, stat, budget.maxTotalBytes - bytes, check);
                        bytes += row.bytes;
                        files.push(row);
                    }
                }
                if (JSON.stringify(first) !== JSON.stringify(names(dir, budget.maxFiles + budget.maxDirectories)))
                    fail('directory_changed');
            };
            walk(root, 0);
            return files.sort((a, b) => order(a.path, b.path));
        };
        result.files = pass();
        const verified = pass();
        if (JSON.stringify(result.files) !== JSON.stringify(verified))
            fail('file_changed');
        if (!unchanged(before, binding(root)))
            fail('root_changed');
        result.fingerprint = hash(JSON.stringify({ version: 1, rootId, files: result.files }));
        result.complete = true;
    }
    catch (error) {
        result.reasons.push(reason(error));
    }
    return result;
}
export function compareSkillInventories(before, after) {
    if (!before.complete || !after.complete || !before.fingerprint || !after.fingerprint || before.rootId !== after.rootId)
        return { state: 'unverified', added: [], removed: [], changed: [] };
    const old = new Map(before.files.map(f => [f.path, f])), next = new Map(after.files.map(f => [f.path, f]));
    return { state: before.fingerprint === after.fingerprint ? 'unchanged' : 'changed', added: [...next.keys()].filter(p => !old.has(p)), removed: [...old.keys()].filter(p => !next.has(p)),
        changed: [...next].filter(([p, f]) => old.has(p) && (old.get(p).sha256 !== f.sha256 || old.get(p).bytes !== f.bytes)).map(([p]) => p) };
}
export async function listSkillReviewTargets(rootInput) {
    if (typeof rootInput !== 'string' || !isAbsolute(rootInput))
        fail('absolute_source_root_required');
    const root = resolve(rootInput), result = { complete: false, fingerprint: null, targets: [], reasons: [] };
    try {
        if (!binding(root).isDirectory())
            fail('root_unavailable');
        const first = names(root, 20000);
        for (const name of first) {
            const path = join(root, name), stat = lstatSync(path);
            if (!stat.isDirectory() && !stat.isSymbolicLink())
                continue;
            const canonicalSkillId = /^[a-z0-9][a-z0-9-]{0,99}$/.test(name) ? name : null;
            result.targets.push({ name, targetId: hash(name), canonicalSkillId, requiresReview: !canonicalSkillId || stat.isSymbolicLink() });
        }
        binding(root);
        if (JSON.stringify(first) !== JSON.stringify(names(root, 20000)))
            fail('directory_changed');
        result.complete = true;
        result.fingerprint = hash(JSON.stringify(result.targets));
    }
    catch (error) {
        result.reasons.push(reason(error));
    }
    return result;
}
