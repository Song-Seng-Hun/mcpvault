import { guidanceError } from './guidance-runtime.js';
import { dirname, isAbsolute } from 'node:path';
import { canonicalRoleplayPath, roleplayInside, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { readFederationFile } from './public-federation-storage.js';
import { fingerprint, textField } from './work-model.js';
import { normalizeScopeId } from './scopes.js';
import { validateExplanationSources } from './explanation-service.js';
export function validateExplanationHostConfig(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw guidanceError(Error('Invalid explanation host configuration'), 'guid-7297de355e2fd271');
    const v = input;
    if (v.version !== 1 || typeof v.enabled !== 'boolean' || Object.keys(v).some(k => !['version', 'enabled', 'sources', 'profiles'].includes(k)))
        throw guidanceError(Error('Invalid explanation host configuration'), 'guid-7297de355e2fd271');
    const sources = validateExplanationSources(v.sources);
    if (!Array.isArray(v.profiles) || v.profiles.length > 100)
        throw guidanceError(Error('Bounded verified host profiles required'), 'guid-3d2c2b2879299b0d');
    const profiles = v.profiles.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw guidanceError(Error('Invalid host execution profile'), 'guid-577a3438bd997d6a');
        const p = structuredClone(raw);
        if (Object.keys(p).some(k => !['accountId', 'provider', 'family', 'version', 'reasoning', 'tier', 'tools', 'capabilities', 'hostVerified', 'availableBudget', 'cost', 'executionLocality', 'bookkeepingSuitable'].includes(k))
            || p.hostVerified !== true || !['economical', 'standard', 'frontier', 'unknown'].includes(p.tier)
            || normalizeScopeId(p.accountId, 'accountId') !== p.accountId)
            throw guidanceError(Error('Invalid host execution profile'), 'guid-577a3438bd997d6a');
        if (p.executionLocality !== undefined && !['local', 'remote', 'unknown'].includes(p.executionLocality)
            || p.bookkeepingSuitable !== undefined && typeof p.bookkeepingSuitable !== 'boolean')
            throw new Error('Invalid host execution profile');
        for (const key of ['family', 'version']) {
            const label = textField(p[key], key, 80, true);
            if (!label || label.toLowerCase() === 'unknown')
                throw guidanceError(Error('Verified family and exact version required'), 'guid-08d2263d8fe2a125');
            p[key] = key === 'family' ? label.toLowerCase() : label;
        }
        for (const key of ['provider', 'reasoning'])
            if (p[key] !== undefined)
                textField(p[key], key, 80, true);
        for (const list of [p.tools, p.capabilities])
            if (!Array.isArray(list) || list.length > 40 || list.some(s => typeof s !== 'string' || !s || s.length > 100))
                throw guidanceError(Error('Invalid profile labels'), 'guid-e4109887f3d3d34d');
        for (const value of [p.availableBudget, p.cost])
            if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9))
                throw guidanceError(Error('Invalid profile budget'), 'guid-2e846485b9267816');
        return structuredClone(p);
    });
    if (new Set(profiles.map(p => p.accountId)).size !== profiles.length)
        throw guidanceError(Error('Duplicate host profile account'), 'guid-bb620058782fe622');
    return { version: 1, enabled: v.enabled, sources, profiles };
}
/** Configuration is trusted only from an explicitly selected owner-private host
 * file. A change invalidates the running binding rather than silently expanding it.
 * Loading and checking never initializes state, creates accounts or calls models.
 */
export async function loadExplanationHostConfig(configPath, expectedVault) {
    if (!isAbsolute(configPath) || !isAbsolute(expectedVault))
        throw guidanceError(Error('Absolute explanation host configuration and Vault required'), 'guid-466884b8e4e321ff');
    const path = await canonicalRoleplayPath(configPath, true, true);
    const { vaultPath, hostPath } = await validateRoleplayStorage({ vaultPath: expectedVault, hostPath: dirname(path) });
    if (!roleplayInside(hostPath, path))
        throw guidanceError(Error('Explanation configuration must be host private'), 'guid-325f3e23cf6f8966');
    const read = async () => {
        await assertHostPrivateStorage([hostPath, path]);
        let raw;
        try {
            raw = JSON.parse(await readFederationFile(hostPath, path, { maxBytes: 128_000 }));
        }
        catch {
            throw guidanceError(Error('Explanation configuration unavailable or malformed'), 'guid-53d091ebd2bc4991');
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.vaultPath !== 'string'
            || await canonicalRoleplayPath(raw.vaultPath, false) !== vaultPath)
            throw guidanceError(Error('Explanation configuration belongs to another Vault'), 'guid-c833e7c3baa6f4e5');
        const { vaultPath: _vault, ...definition } = raw;
        return validateExplanationHostConfig(definition);
    };
    const initial = await read(), revision = fingerprint(initial);
    return { enabled: initial.enabled, sources: initial.sources, executionProfiles: async () => {
            const current = await read();
            if (fingerprint(current) !== revision)
                throw guidanceError(Error('Explanation host configuration changed; verified restart required'), 'guid-b393042fa17c3a86');
            return current.enabled ? current.profiles : [];
        } };
}
