import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync } from 'node:fs';
import { opendir } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { verifySkillReleaseEvidence } from './skill-release-evidence.js';
const fail = () => { throw Error('Reviewed skill store unavailable'); };
const digest = (b) => createHash('sha256').update(b).digest('hex');
const id = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(s);
const sha = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const identity = (s) => `${s.dev}:${s.ino}`;
const stamp = (s) => `${identity(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.mode}:${s.nlink}`;
const missing = (e) => !!e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT';
export function parseReviewedSkillRegistration(bytes, skillId) {
    const r = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const keys = ['version', 'skillId', 'sourceName', 'state', 'releaseHash', 'scenarioSetHash', 'policyRevision', 'reviewer'];
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(r, k))
        || r.version !== 1 || r.skillId !== skillId || !id(r.sourceName) || !['admitted', 'revoked'].includes(r.state)
        || !sha(r.releaseHash) || !sha(r.scenarioSetHash) || !id(r.policyRevision) || !id(r.reviewer))
        return fail();
    return r;
}
/** Read-only host adapter. Provisioning/admission is a separate host operation.
 * Does not create files, recover corrupt records, install scripts or grant access.
 * sourceFingerprint MUST use a bounded source worker, not a foreground full scan. */
export async function openReviewedSkillStore(options) {
    try {
        const { hostPath } = await validateRoleplayStorage(options);
        const directories = [hostPath, join(hostPath, 'entries'), join(hostPath, 'blobs')];
        for (const p of directories)
            await canonicalRoleplayPath(p, true);
        await assertHostPrivateStorage(directories);
        const bindings = new Map(directories.map(p => [p, identity(lstatSync(p, { bigint: true }))]));
        const leases = new WeakMap();
        const assertDirectories = () => {
            // Repeat lexical ancestor checks so realpath cannot hide a replaced junction.
            const root = parse(hostPath).root;
            let p = root;
            for (const part of ['', ...hostPath.slice(root.length).split(/[\\/]+/).filter(Boolean)]) {
                if (part)
                    p = join(p, part);
                const s = lstatSync(p, { bigint: true });
                if (s.isSymbolicLink() || !s.isDirectory())
                    return fail();
            }
            for (const directory of directories) {
                const s = lstatSync(directory, { bigint: true });
                if (s.isSymbolicLink() || !s.isDirectory() || identity(s) !== bindings.get(directory) || realpathSync(directory) !== directory)
                    return fail();
                if (process.platform !== 'win32' && ((s.mode & 63n) !== 0n || (process.getuid && s.uid !== BigInt(process.getuid()))))
                    return fail();
            }
        };
        const read = (path, max) => {
            assertDirectories();
            const before = lstatSync(path, { bigint: true });
            if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(max) || realpathSync(path) !== path)
                return fail();
            if (process.platform !== 'win32' && ((before.mode & 63n) !== 0n || (process.getuid && before.uid !== BigInt(process.getuid()))))
                return fail();
            const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            try {
                if (stamp(fstatSync(fd, { bigint: true })) !== stamp(before))
                    return fail();
                const bytes = Buffer.alloc(Number(before.size));
                let offset = 0;
                while (offset < bytes.length) {
                    const n = readSync(fd, bytes, offset, bytes.length - offset, offset);
                    if (!n)
                        return fail();
                    offset += n;
                }
                if (stamp(fstatSync(fd, { bigint: true })) !== stamp(before) || stamp(lstatSync(path, { bigint: true })) !== stamp(before))
                    return fail();
                assertDirectories();
                return { bytes, stamp: stamp(before) };
            }
            finally {
                closeSync(fd);
            }
        };
        const checked = async (path, max) => {
            assertDirectories();
            await canonicalRoleplayPath(path, true, true);
            await assertHostPrivateStorage([...directories, path]);
            return read(path, max);
        };
        const load = async (skillId) => {
            if (!id(skillId))
                return fail();
            assertDirectories();
            await assertHostPrivateStorage(directories);
            const path = join(hostPath, 'entries', `${digest(skillId)}.json`);
            // Only a missing final registration means not admitted. Never conceal a bad directory.
            try {
                lstatSync(path);
            }
            catch (e) {
                if (missing(e))
                    return undefined;
                throw e;
            }
            const result = await checked(path, 8192), data = parseReviewedSkillRegistration(result.bytes, skillId);
            return { path, ...result, data };
        };
        const host = {
            async candidates() {
                try {
                    assertDirectories();
                    await assertHostPrivateStorage(directories);
                    // Read at most eight directory entries, including rejected/revoked
                    // entries. Never readdir() the whole registry or scan Vault originals.
                    // Deliberately no completeness/count claim escapes this private window.
                    const dir = await opendir(join(hostPath, 'entries'), { bufferSize: 1 }), ids = [];
                    try {
                        for (let n = 0; n < 8; n++) {
                            const entry = await dir.read();
                            if (!entry)
                                break;
                            if (!/^[a-f0-9]{64}\.json$/.test(entry.name))
                                continue;
                            const result = await checked(join(hostPath, 'entries', entry.name), 8192);
                            const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes));
                            if (!id(raw?.skillId) || `${digest(raw.skillId)}.json` !== entry.name)
                                return fail();
                            const data = parseReviewedSkillRegistration(result.bytes, raw.skillId);
                            if (data.state === 'admitted')
                                ids.push(data.skillId);
                        }
                    }
                    finally {
                        await dir.close();
                    }
                    assertDirectories();
                    return ids;
                }
                catch {
                    return fail();
                }
            },
            async entry(skillId) {
                try {
                    const r = await load(skillId);
                    if (!r || r.data.state === 'revoked')
                        return undefined;
                    const entry = Object.freeze({ releaseHash: r.data.releaseHash, generation: digest(r.bytes), sourceName: r.data.sourceName });
                    leases.set(entry, { path: r.path, stamp: r.stamp, generation: entry.generation });
                    return entry;
                }
                catch {
                    return fail();
                }
            },
            assertFresh(entry, blobHashes = []) {
                try {
                    const lease = leases.get(entry);
                    if (!lease)
                        return fail();
                    const current = read(lease.path, 8192);
                    if (current.stamp !== lease.stamp || digest(current.bytes) !== lease.generation)
                        return fail();
                    if (!Array.isArray(blobHashes) || blobHashes.length > 33 || blobHashes.some(h => !sha(h)) || new Set(blobHashes).size !== blobHashes.length)
                        return fail();
                    // Local immutable copies can change while an awaited permission check
                    // runs. Recheck their actual bytes without another async gap or cache.
                    // Bounds match 32 resources / 4 MiB plus the <=64 KiB manifest.
                    let total = 0;
                    for (const hash of blobHashes) {
                        const resource = read(join(hostPath, 'blobs', hash), 1048576);
                        if ((total += resource.bytes.length) > 4 * 1024 * 1024 + 65536 || digest(resource.bytes) !== hash)
                            return fail();
                    }
                }
                catch {
                    return fail();
                }
            },
            async readBlob(hash) {
                try {
                    if (!sha(hash))
                        return fail();
                    const { bytes } = await checked(join(hostPath, 'blobs', hash), 1048576);
                    if (digest(bytes) !== hash)
                        return fail();
                    return bytes;
                }
                catch {
                    return fail();
                }
            },
            async sourceFingerprint(sourceName) {
                try {
                    if (!id(sourceName))
                        return null;
                    const hash = await options.sourceFingerprint(sourceName);
                    return sha(hash) ? hash : null;
                }
                catch {
                    return null;
                }
            },
            async verifyEvidence(manifest) {
                try {
                    const r = await load(manifest.skillId);
                    if (!r || r.data.state !== 'admitted')
                        return false;
                    return await verifySkillReleaseEvidence(manifest, r.data, hash => host.readBlob(hash));
                }
                catch {
                    return false;
                }
            },
        };
        return host;
    }
    catch {
        return fail();
    }
}
