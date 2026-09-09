import { guidanceError } from './guidance-runtime.js';
import { createHash, randomUUID } from 'node:crypto';
import { hostname, platform } from 'node:os';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readFederationFile, ensureFederationDirectory } from './public-federation-storage.js';
import { canonicalRoleplayPath, roleplayInside, validateRoleplayStorage } from './roleplay-storage-host.js';
const missing = (e) => Boolean(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bindingName = 'storage-binding.json';
const fail = () => { throw guidanceError(new Error('Economy storage binding unavailable or changed; explicit host recovery required'), 'guid-fceb85c8e6f99945'); };
export async function assertLegacyEconomyStorage(options) {
    for (const path of [join(options.vaultPath, '.mcpvault-economy', bindingName), join(options.hostPath, 'economy-storage-binding.json')]) {
        try {
            await lstat(path);
            fail();
        }
        catch (e) {
            if (!missing(e))
                throw e;
        }
    }
}
/** Reuse the established no-junction, canonical NAS/local-host path checks.
 * The journal and checkpoint are disjoint local directories; neither is a Wiki
 * replica. NAS contains only an admission marker, never a local-storage attestation. */
export async function validateEconomyStoragePaths(options) {
    const { vaultPath, hostPath } = await validateRoleplayStorage(options);
    const ledgerPath = await canonicalRoleplayPath(options.ledgerPath, true);
    await validateRoleplayStorage({ vaultPath, hostPath: ledgerPath });
    if (roleplayInside(hostPath, ledgerPath) || roleplayInside(ledgerPath, hostPath))
        throw guidanceError(new Error('Economy journal and checkpoint require separate non-overlapping directories'), 'guid-6d8642c6b0efb148');
    return { vaultPath, hostPath, ledgerPath };
}
async function readOptional(root, path) {
    try {
        if ((await lstat(path)).isSymbolicLink())
            fail();
        return await readFederationFile(root, path, { maxBytes: 8192 });
    }
    catch (e) {
        if (missing(e))
            return;
        throw e;
    }
}
async function createExclusive(path, text) {
    const handle = await open(path, 'wx', 0o600);
    try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
/** Private binding precedes the immutable NAS admission marker. A torn or
 * half-published initialization fails closed, never silently recreated. */
export async function bindEconomyStorage(options, initialize = false) {
    const paths = await validateEconomyStoragePaths(options);
    const privatePath = join(paths.hostPath, 'economy-storage-binding.json');
    const markerRoot = join(paths.vaultPath, '.mcpvault-economy');
    const markerPath = join(markerRoot, bindingName);
    const physicalMarkerRoot = join(paths.ledgerPath, '.mcpvault-economy');
    const physicalMarkerPath = join(physicalMarkerRoot, bindingName);
    const machine = hash({ hostname: hostname().toLowerCase(), platform: platform() });
    let privateText = await readOptional(paths.hostPath, privatePath);
    let markerText = await readOptional(paths.vaultPath, markerPath);
    let physicalMarker = await readOptional(paths.ledgerPath, physicalMarkerPath);
    if (!privateText && initialize) {
        if (markerText !== undefined)
            fail();
        try {
            if ((await readdir(markerRoot)).length)
                throw guidanceError(new Error('Existing economy requires explicit storage migration'), 'guid-9aa544766a680b4b');
        }
        catch (e) {
            if (!missing(e))
                throw e;
        }
        try {
            await lstat(join(paths.ledgerPath, '.mcpvault-economy'));
            fail();
        }
        catch (e) {
            if (!missing(e))
                throw e;
        }
        const existing = await readdir(paths.hostPath);
        if (existing.some(name => /^economy-.*\.(checkpoint\.json|prepared\.md)$/.test(name)))
            fail();
        const binding = { version: 1, id: randomUUID(), vault: paths.vaultPath, ledger: paths.ledgerPath, host: paths.hostPath, machine };
        // Block unconfigured Work before any private binding can become durable.
        // Even an interrupted initialization now requires explicit recovery.
        await ensureFederationDirectory(paths.vaultPath, markerRoot);
        privateText = JSON.stringify(binding);
        await createExclusive(privatePath, privateText);
        if ((await readdir(markerRoot)).length)
            fail();
        markerText = JSON.stringify({ version: 1, binding: hash(binding) });
        await ensureFederationDirectory(paths.ledgerPath, physicalMarkerRoot);
        await createExclusive(physicalMarkerPath, markerText);
        physicalMarker = markerText;
        await createExclusive(markerPath, markerText);
    }
    if (!privateText || !markerText || physicalMarker !== markerText)
        fail();
    let binding;
    try {
        binding = JSON.parse(privateText);
    }
    catch {
        return fail();
    }
    if (binding.version !== 1 || typeof binding.id !== 'string' || !/^[a-f0-9-]{36}$/.test(binding.id)
        || binding.vault !== paths.vaultPath || binding.ledger !== paths.ledgerPath || binding.host !== paths.hostPath || binding.machine !== machine
        || markerText !== JSON.stringify({ version: 1, binding: hash(binding) }))
        fail();
    const expectedPrivate = privateText, expectedMarker = markerText;
    const assertBinding = async () => {
        try {
            const fresh = await validateEconomyStoragePaths(options);
            if (JSON.stringify(fresh) !== JSON.stringify(paths)
                || await readOptional(paths.hostPath, privatePath) !== expectedPrivate
                || await readOptional(paths.vaultPath, markerPath) !== expectedMarker
                || await readOptional(paths.ledgerPath, physicalMarkerPath) !== expectedMarker)
                fail();
        }
        catch {
            fail();
        }
    };
    await assertBinding();
    return { ...paths, assertBinding };
}
