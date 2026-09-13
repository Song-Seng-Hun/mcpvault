import { guidanceError } from './guidance-runtime.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { readFederationFile, removeFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';
const HOST_WORK_NAMESPACES = ['maintenance', 'compilation', 'codex-hooks', 'codex-checkpoints'];
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
    if (namespace === 'codex-hooks')
        return 'Codex hook';
    if (namespace === 'codex-checkpoints')
        return 'Codex checkpoint';
    throw guidanceError(new Error('Invalid host work storage namespace'), 'guid-fa304995bd4283e9');
};
export async function loadHostWorkStorage(path, expectedVault, options) {
    const { namespace, maxStateBytes, validate } = options;
    const label = namespaceName(namespace);
    if (!Number.isSafeInteger(maxStateBytes) || maxStateBytes < 1)
        throw guidanceError(new Error('Host work storage state size limit is invalid'), 'guid-1130e7a06f2ced9e');
    if (typeof validate !== 'function')
        throw guidanceError(new Error('Host work storage validator is invalid'), 'guid-2c2345389dd2b683');
    const canonical = await canonicalRoleplayPath(path, true, true);
    const { vaultPath, hostPath } = await validateRoleplayStorage({ vaultPath: expectedVault, hostPath: dirname(canonical) });
    const identity = hash(vaultPath.toLowerCase());
    const managed = (name) => join(hostPath, `${name}-${identity}`);
    const statePath = managed(namespace) + '.json';
    const lockPath = managed(namespace) + '.writer.lock';
    const managedPaths = HOST_WORK_NAMESPACES.flatMap(name => [managed(name) + '.json', managed(name) + '.writer.lock']);
    if (managedPaths.some(target => target.toLowerCase() === canonical.toLowerCase()))
        throw guidanceError(new Error(`${label} configuration overlaps managed host storage`), 'guid-64054a4a6cd30b6b');
    let active;
    let stateRevision;
    const privateFile = async (target, optional = false) => {
        try {
            await canonicalRoleplayPath(target, true, true);
            if ((await lstat(target)).nlink !== 1)
                throw guidanceError(new Error(`${label} host files cannot be shared hard links`), 'guid-e82eb2b4c8829662');
            await assertHostPrivateStorage([hostPath, target]);
        }
        catch (error) {
            if (!optional || !missing(error))
                throw error;
        }
    };
    const refresh = async () => {
        if (await canonicalRoleplayPath(hostPath, true) !== hostPath)
            throw guidanceError(new Error(`${label} host binding changed`), 'guid-d64ef3f4369d464b');
        await privateFile(canonical);
        const raw = JSON.parse(await readFederationFile(hostPath, canonical, { maxBytes: 128 * 1024 }));
        await privateFile(canonical);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.vaultPath !== 'string'
            || await canonicalRoleplayPath(raw.vaultPath, false) !== vaultPath)
            throw guidanceError(new Error(`${label} configuration belongs to another Vault`), 'guid-1b069753c6e35f90');
        const { vaultPath: _vault, ...definition } = raw;
        return validate(definition);
    };
    const fileIdentity = (target, optional = false) => {
        try {
            const info = lstatSync(target, { bigint: true });
            if (info.isSymbolicLink() || !info.isFile())
                throw guidanceError(new Error(`${label} host symbolic-link or file binding changed`), 'guid-8f1759cef393dbe0');
            if (info.nlink !== 1n)
                throw guidanceError(new Error(`${label} host files cannot be shared hard links`), 'guid-e82eb2b4c8829662');
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
            throw guidanceError(new Error(`${label} host file binding or contents changed while reading`), 'guid-65d7d785b2a6c9d7');
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
                throw guidanceError(new Error(`Read ${label.toLowerCase()} state and hold its writer before saving`), 'guid-9cedd52ff866aa37');
            const writer = active, expected = stateRevision;
            const content = JSON.stringify(value);
            if (typeof content !== 'string' || Buffer.byteLength(content) > maxStateBytes)
                throw guidanceError(new Error(`${label} receipt storage is full; preserve existing history for host review`), 'guid-f28baa93fa383279');
            await writeFederationFileAtomic(hostPath, statePath, content, { maxBytes: maxStateBytes, beforeCommit: async () => {
                    await writer.assertHeld();
                    const current = await readRawState();
                    if (current.revision !== expected.revision || !sameSnapshot(current.identity, expected.identity))
                        throw guidanceError(new Error(`${label} host history changed; preserve it for review`), 'guid-07e07f0748a8c792');
                    await writer.assertHeld();
                    if (active !== writer || !sameSnapshot(fileIdentity(statePath, true), current.identity))
                        throw guidanceError(new Error(`${label} host history changed; preserve it for review`), 'guid-07e07f0748a8c792');
                } });
            const saved = await readRawState();
            if (saved.revision !== hash(content))
                throw guidanceError(new Error(`${label} host history changed after saving; preserve it for review`), 'guid-01f6134683d5dff0');
            stateRevision = saved;
        },
        acquire: async () => {
            if (active || !(await refresh()).enabled)
                throw guidanceError(new Error(`${label} writer already held or disabled`), 'guid-7d4a53ff283b3514');
            const nonce = randomUUID();
            let handle;
            try {
                handle = await open(lockPath, 'wx', 0o600);
            }
            catch {
                throw guidanceError(new Error(`${label} writer unavailable; existing markers require host review, never automatic stealing`), 'guid-cf50399fa4fe9fbb');
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
                    throw guidanceError(new Error(`${label} writer ownership changed`), 'guid-aa57b957943e96b7');
            };
            let closed = false, closing;
            const writer = {
                assertHeld: async () => {
                    if (closed || closing || !(await refresh()).enabled)
                        throw guidanceError(new Error(`${label} writer closed or approval revoked`), 'guid-7d7a9060053a6625');
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
