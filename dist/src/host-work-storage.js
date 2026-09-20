import { guidanceError } from './guidance-runtime.js';
import { AsyncResource } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { readFederationFile, removeFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';
const HOST_WORK_NAMESPACES = ['maintenance', 'compilation', 'codex-hooks', 'codex-checkpoints', 'evolution'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const missing = (error) => error?.code === 'ENOENT';
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameSnapshot = (left, right) => left === undefined || right === undefined ? left === right
    : sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs
        && left.ctimeNs === right.ctimeNs && left.birthtimeNs === right.birthtimeNs
        && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid && left.nlink === right.nlink;
const namespaceName = (namespace) => {
    if (namespace === 'evolution')
        return 'Evolution';
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
    const { namespace, maxStateBytes, maxRecordBytes, validate } = options;
    const label = namespaceName(namespace);
    // Only release this storage owner's exact nonce/inode-bound lease in its
    // construction context. Request cancellation must still deny record writes,
    // but must not poison cleanup. An inherited owner boundary remains intact.
    const closeInOwnerContext = AsyncResource.bind((operation) => operation(), 'host-work-lease-cleanup');
    if (!Number.isSafeInteger(maxStateBytes) || maxStateBytes < 1)
        throw guidanceError(new Error('Host work storage state size limit is invalid'), 'guid-1130e7a06f2ced9e');
    if (maxRecordBytes !== undefined && (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > 4 * 1024 * 1024))
        throw guidanceError(new Error('Host record size limit is invalid'), 'guid-4f266ef7757529ad');
    if (typeof validate !== 'function')
        throw guidanceError(new Error('Host work storage validator is invalid'), 'guid-2c2345389dd2b683');
    const canonical = await canonicalRoleplayPath(path, true, true);
    const { vaultPath, hostPath } = await validateRoleplayStorage({ vaultPath: expectedVault, hostPath: dirname(canonical) });
    const identity = hash(vaultPath.toLowerCase());
    const managed = (name) => join(hostPath, `${name}-${identity}`);
    const statePath = managed(namespace) + '.json';
    const lockPath = managed(namespace) + '.writer.lock';
    const managedPaths = HOST_WORK_NAMESPACES.flatMap(name => [managed(name) + '.json', managed(name) + '.writer.lock']);
    const recordCollision = HOST_WORK_NAMESPACES.some(name => {
        const prefix = `${managed(name)}.record-`.toLowerCase();
        return canonical.toLowerCase().startsWith(prefix) && /^[a-f0-9]{64}\.json$/i.test(canonical.slice(prefix.length));
    });
    if (recordCollision || managedPaths.some(target => target.toLowerCase() === canonical.toLowerCase()))
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
    // Keep only CAS identities, never up to128 full record bodies in the cache.
    const recordSnapshots = new Map();
    let recordQueue = Promise.resolve();
    const serialRecord = (operation) => {
        const next = recordQueue.then(operation, operation);
        recordQueue = next.then(() => undefined, () => undefined);
        return next;
    };
    const recordPath = (id) => {
        if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
            throw guidanceError(new Error('Invalid host record ID'), 'guid-a2781a3bc5770ebc');
        return `${managed(namespace)}.record-${id}.json`;
    };
    const rememberRecord = (id, snapshot) => {
        recordSnapshots.delete(id);
        recordSnapshots.set(id, { revision: snapshot.revision, identity: snapshot.identity });
        // Eviction removes a write precondition, never durable history. Reread it.
        if (recordSnapshots.size > 128)
            recordSnapshots.delete(recordSnapshots.keys().next().value);
    };
    const records = maxRecordBytes === undefined ? undefined : Object.freeze({
        read: (id) => serialRecord(async () => {
            const target = recordPath(id);
            recordSnapshots.delete(id);
            await refresh();
            const snapshot = await readPrivateSnapshot(target, maxRecordBytes, true);
            const value = snapshot.raw === undefined ? undefined : JSON.parse(snapshot.raw);
            await refresh();
            rememberRecord(id, snapshot);
            return { revision: snapshot.revision, value };
        }),
        write: (id, value, expectedRevision, assertCurrent) => {
            // Capture caller data before queuing; later mutation cannot change this write.
            const content = JSON.stringify(value);
            return serialRecord(async () => {
                const target = recordPath(id), writer = active, expected = recordSnapshots.get(id);
                if (!writer || !expected)
                    throw guidanceError(new Error('Read the host record and hold its writer before saving'), 'guid-676a4b44848a6abd');
                if (expectedRevision !== expected.revision)
                    throw guidanceError(new Error('Host record revision changed; reread it'), 'guid-42083a96a5852b2e');
                if (typeof content !== 'string' || Buffer.byteLength(content) > maxRecordBytes)
                    throw guidanceError(new Error('Host record size limit exceeded; preserve existing history'), 'guid-0ce2f2a922fd4faa');
                await writer.assertHeld();
                await assertCurrent?.();
                await writeFederationFileAtomic(hostPath, target, content, { maxBytes: maxRecordBytes, beforeCommit: async () => {
                        await writer.assertHeld();
                        const current = await readPrivateSnapshot(target, maxRecordBytes, true);
                        if (current.revision !== expected.revision || !sameSnapshot(current.identity, expected.identity))
                            throw guidanceError(new Error('Host record changed; preserve it for review'), 'guid-150989fe3bbf1009');
                        await assertCurrent?.();
                        await writer.assertHeld();
                        if (active !== writer || !sameSnapshot(fileIdentity(target, true), current.identity))
                            throw guidanceError(new Error('Host record changed; preserve it for review'), 'guid-150989fe3bbf1009');
                    } });
                const saved = await readPrivateSnapshot(target, maxRecordBytes, true);
                if (saved.revision !== hash(content))
                    throw guidanceError(new Error('Host record changed after saving; preserve it for review'), 'guid-c3a04da41ddea7bc');
                await writer.assertHeld();
                await assertCurrent?.();
                rememberRecord(id, saved);
                return { revision: saved.revision };
            });
        },
    });
    await refresh();
    return Object.freeze({
        refresh,
        ...(records && { records }),
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
                close: () => closing ??= closeInOwnerContext(async () => {
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
                }),
            };
            active = writer;
            return writer;
        },
    });
}
