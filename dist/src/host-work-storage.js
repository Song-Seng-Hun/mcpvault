import { createHash, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { readFederationFile, removeFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const missing = (error) => error?.code === 'ENOENT';
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameSnapshot = (left, right) => left === undefined || right === undefined ? left === right
    : sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs
        && left.ctimeNs === right.ctimeNs && left.birthtimeNs === right.birthtimeNs
        && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid && left.nlink === right.nlink;
const namespaceName = (namespace) => {
    if (namespace === 'maintenance')
        return 'Maintenance';
    if (namespace === 'compilation')
        return 'Compilation';
    throw new Error('Host work storage namespace must be maintenance or compilation');
};
export async function loadHostWorkStorage(path, expectedVault, options) {
    const { namespace, maxStateBytes, validate } = options;
    const label = namespaceName(namespace);
    if (!Number.isSafeInteger(maxStateBytes) || maxStateBytes < 1)
        throw new Error('Host work storage state size limit is invalid');
    if (typeof validate !== 'function')
        throw new Error('Host work storage validator is invalid');
    const canonical = await canonicalRoleplayPath(path, true, true);
    const { vaultPath, hostPath } = await validateRoleplayStorage({ vaultPath: expectedVault, hostPath: dirname(canonical) });
    const identity = hash(vaultPath.toLowerCase());
    const managed = (name) => join(hostPath, `${name}-${identity}`);
    const statePath = managed(namespace) + '.json';
    const lockPath = managed(namespace) + '.writer.lock';
    const other = namespace === 'maintenance' ? 'compilation' : 'maintenance';
    const otherStatePath = managed(other) + '.json';
    const otherLockPath = managed(other) + '.writer.lock';
    if ([statePath, lockPath, otherStatePath, otherLockPath].some(target => target.toLowerCase() === canonical.toLowerCase()))
        throw new Error(`${label} configuration overlaps managed host storage`);
    let active;
    let stateRevision;
    const privateFile = async (target, optional = false) => {
        try {
            await canonicalRoleplayPath(target, true, true);
            if ((await lstat(target)).nlink !== 1)
                throw new Error(`${label} host files cannot be shared hard links`);
            await assertHostPrivateStorage([hostPath, target]);
        }
        catch (error) {
            if (!optional || !missing(error))
                throw error;
        }
    };
    const refresh = async () => {
        if (await canonicalRoleplayPath(hostPath, true) !== hostPath)
            throw new Error(`${label} host binding changed`);
        await privateFile(canonical);
        const raw = JSON.parse(await readFederationFile(hostPath, canonical, { maxBytes: 128 * 1024 }));
        await privateFile(canonical);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.vaultPath !== 'string'
            || await canonicalRoleplayPath(raw.vaultPath, false) !== vaultPath)
            throw new Error(`${label} configuration belongs to another Vault`);
        const { vaultPath: _vault, ...definition } = raw;
        return validate(definition);
    };
    const fileIdentity = (target, optional = false) => {
        try {
            const info = lstatSync(target, { bigint: true });
            if (info.isSymbolicLink() || !info.isFile())
                throw new Error(`${label} host symbolic-link or file binding changed`);
            if (info.nlink !== 1n)
                throw new Error(`${label} host files cannot be shared hard links`);
            return info;
        }
        catch (error) {
            if (optional && missing(error))
                return undefined;
            throw error;
        }
    };
    const readPrivateSnapshot = async (target, maxBytes, optional = false) => {
        await privateFile(target, optional);
        const before = fileIdentity(target, optional);
        let raw;
        if (before !== undefined)
            raw = await readFederationFile(hostPath, target, { maxBytes });
        await privateFile(target, optional);
        const after = fileIdentity(target, optional);
        if (!sameSnapshot(before, after))
            throw new Error(`${label} host file binding or contents changed while reading`);
        return { raw, revision: raw === undefined ? 'missing' : hash(raw), identity: after };
    };
    const readRawState = () => readPrivateSnapshot(statePath, maxStateBytes, true);
    await refresh();
    return Object.freeze({
        refresh,
        readState: async () => {
            await refresh();
            const snapshot = await readRawState();
            const result = snapshot.raw === undefined ? undefined : JSON.parse(snapshot.raw);
            stateRevision = snapshot;
            return result;
        },
        writeState: async (value) => {
            if (!active || stateRevision === undefined)
                throw new Error(`Read ${label.toLowerCase()} state and hold its writer before saving`);
            const writer = active, expected = stateRevision;
            const content = JSON.stringify(value);
            if (typeof content !== 'string' || Buffer.byteLength(content) > maxStateBytes)
                throw new Error(`${label} receipt storage is full; preserve existing history for host review`);
            await writeFederationFileAtomic(hostPath, statePath, content, { maxBytes: maxStateBytes, beforeCommit: async () => {
                    await writer.assertHeld();
                    const current = await readRawState();
                    if (current.revision !== expected.revision || !sameSnapshot(current.identity, expected.identity))
                        throw new Error(`${label} host history changed; preserve it for review`);
                    await writer.assertHeld();
                    if (active !== writer || !sameSnapshot(fileIdentity(statePath, true), current.identity))
                        throw new Error(`${label} host history changed; preserve it for review`);
                } });
            const saved = await readRawState();
            if (saved.revision !== hash(content))
                throw new Error(`${label} host history changed after saving; preserve it for review`);
            stateRevision = saved;
        },
        acquire: async () => {
            if (active || !(await refresh()).enabled)
                throw new Error(`${label} writer already held or disabled`);
            const nonce = randomUUID();
            let handle;
            try {
                handle = await open(lockPath, 'wx', 0o600);
            }
            catch {
                throw new Error(`${label} writer unavailable; existing markers require host review, never automatic stealing`);
            }
            const marker = { version: 1, vault: identity, pid: process.pid, nonce };
            let held;
            try {
                await handle.writeFile(JSON.stringify(marker));
                await handle.sync();
                held = await handle.stat({ bigint: true });
            }
            catch (error) {
                await handle.close();
                throw error;
            }
            const ownership = async () => {
                const snapshot = await readPrivateSnapshot(lockPath, 2048);
                const current = snapshot.identity, raw = JSON.parse(snapshot.raw);
                if (!current || !sameIdentity(held, current) || raw.version !== 1 || raw.vault !== identity || raw.pid !== process.pid || raw.nonce !== nonce)
                    throw new Error(`${label} writer ownership changed`);
            };
            let closed = false, closing;
            const writer = {
                assertHeld: async () => {
                    if (closed || closing || !(await refresh()).enabled)
                        throw new Error(`${label} writer closed or approval revoked`);
                    await ownership();
                },
                close: () => closing ??= (async () => {
                    try {
                        await ownership();
                        await handle.close();
                        closed = true;
                        await removeFederationFile(hostPath, lockPath, ownership);
                    }
                    finally {
                        if (!closed) {
                            await handle.close();
                            closed = true;
                        }
                        if (active === writer)
                            active = undefined;
                    }
                })(),
            };
            active = writer;
            return writer;
        },
    });
}
