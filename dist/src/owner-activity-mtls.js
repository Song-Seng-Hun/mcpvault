import { dirname } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { getEnterpriseRequestContext } from './enterprise-request-context.js';
import { canonicalRoleplayPath, validateRoleplayStorage } from './roleplay-storage-host.js';
import { assertHostPrivateStorage } from './skill-evolution-host.js';
import { readFederationFile } from './public-federation-storage.js';
const unavailable = () => Error('Owner mTLS binding unavailable');
const stamp = (s) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.nlink].join(':');
const id = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(v);
function record(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k)))
        throw unavailable();
    return value;
}
/** Optional host-only bridge for existing authenticated accounts. It reuses the
 * HTTP layer's CA-verified peer context, never headers, JSON or localhost labels.
 * Mapping a certificate grants NO activity/document permission and does not attest
 * local inference. Existing owner policy and current account/document checks apply.
 * Call execution only with a current principal produced by ScopeAuthService. */
export async function loadOwnerMtlsBindings(path, expectedVault) {
    try {
        const canonical = await canonicalRoleplayPath(path, true, true);
        const { hostPath, vaultPath } = await validateRoleplayStorage({ hostPath: dirname(canonical), vaultPath: expectedVault });
        let current = [];
        let currentStamp;
        const fileStamp = () => {
            const stat = lstatSync(canonical);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32768 || realpathSync(canonical) !== canonical)
                throw unavailable();
            return stamp(stat);
        };
        let queue = Promise.resolve();
        const refresh = () => {
            const read = async () => {
                try {
                    await canonicalRoleplayPath(canonical, true, true);
                    await assertHostPrivateStorage([hostPath, canonical]);
                    const before = fileStamp();
                    const raw = record(JSON.parse(await readFederationFile(hostPath, canonical, { maxBytes: 32768 })), ['version', 'vaultPath', 'bindings']);
                    if (raw.version !== 1 || typeof raw.vaultPath !== 'string' || await canonicalRoleplayPath(raw.vaultPath, false) !== vaultPath
                        || !Array.isArray(raw.bindings) || raw.bindings.length > 64)
                        throw unavailable();
                    const keys = new Set(), targets = new Map();
                    const next = raw.bindings.map((value) => {
                        const r = record(value, ['accountId', 'executionTarget', 'certFingerprint', 'expiresAt']);
                        if (!id(r.accountId) || !id(r.executionTarget) || typeof r.certFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(r.certFingerprint)
                            || typeof r.expiresAt !== 'string' || !Number.isFinite(Date.parse(r.expiresAt)) || new Date(r.expiresAt).toISOString() !== r.expiresAt)
                            throw unavailable();
                        const key = `${r.accountId}:${r.certFingerprint}`;
                        if (keys.has(key) || targets.has(r.certFingerprint) && targets.get(r.certFingerprint) !== r.executionTarget)
                            throw unavailable();
                        keys.add(key);
                        targets.set(r.certFingerprint, r.executionTarget);
                        return Object.freeze({ accountId: r.accountId, executionTarget: r.executionTarget, certFingerprint: r.certFingerprint, expiresAt: Date.parse(r.expiresAt) });
                    });
                    await canonicalRoleplayPath(canonical, true, true);
                    await assertHostPrivateStorage([hostPath, canonical]);
                    if (fileStamp() !== before)
                        throw unavailable();
                    currentStamp = before;
                    current = Object.freeze(next);
                }
                catch {
                    current = [];
                    currentStamp = undefined;
                    throw unavailable();
                }
            };
            const pending = queue.then(read, read);
            queue = pending.catch(() => undefined);
            return pending;
        };
        await refresh();
        return Object.freeze({ refresh, execution: (principal) => {
                const context = getEnterpriseRequestContext();
                if (!principal || context?.transport !== 'http' || !context.certFingerprint)
                    return undefined;
                try {
                    if (!currentStamp || fileStamp() !== currentStamp) {
                        current = [];
                        currentStamp = undefined;
                        return undefined;
                    }
                }
                catch {
                    current = [];
                    currentStamp = undefined;
                    return undefined;
                }
                const found = current.find(b => b.accountId === principal.accountId && b.certFingerprint === context.certFingerprint && Date.now() < b.expiresAt);
                return found ? { accountId: found.accountId, executionTarget: found.executionTarget } : undefined;
            } });
    }
    catch {
        throw unavailable();
    }
}
