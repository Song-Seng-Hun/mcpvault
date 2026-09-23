import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync } from 'node:fs';
import { join, parse } from 'node:path';
import { canonicalRoleplayPath } from './roleplay-storage-host.js';
import { parseReviewedSkillRegistration } from './skill-release-store.js';
import { verifySkillReleaseEvidence } from './skill-release-evidence.js';
export const VAULT_SKILL_REVIEWS = '.mcpvault-reviewed-skills';
const fail = () => { throw Error('Reviewed NAS skill unavailable'); };
const digest = (b) => createHash('sha256').update(b).digest('hex');
const sha = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const id = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(s);
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const stamp = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.nlink}`;
/** NAS bytes remain untrusted. A private server setting pins the registry hash;
 * neither an active frontmatter flag nor replacing NAS evidence grants approval.
 * Bodies live in Community/Skills, not in the evidence store or a local mirror. */
export async function openVaultReviewedSkills(options) {
    if (!sha(options.registryHash))
        return fail();
    const vault = await canonicalRoleplayPath(options.vaultPath, false);
    const metadata = join(vault, VAULT_SKILL_REVIEWS), registryPath = join(metadata, 'registry.json');
    const read = (path, max) => {
        let current = parse(path).root;
        for (const part of path.slice(current.length).split(/[\\/]+/).filter(Boolean)) {
            current = join(current, part);
            const s = lstatSync(current);
            if (s.isSymbolicLink() || (!same(current, path) && !s.isDirectory()))
                return fail();
        }
        const before = lstatSync(path);
        if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > max || !same(realpathSync(path), path))
            return fail();
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            if (stamp(fstatSync(fd)) !== stamp(before))
                return fail();
            const bytes = Buffer.alloc(before.size);
            let offset = 0;
            while (offset < bytes.length) {
                const n = readSync(fd, bytes, offset, bytes.length - offset, offset);
                if (!n)
                    return fail();
                offset += n;
            }
            if (stamp(fstatSync(fd)) !== stamp(before) || stamp(lstatSync(path)) !== stamp(before) || !same(realpathSync(path), path))
                return fail();
            return bytes;
        }
        finally {
            closeSync(fd);
        }
    };
    const registryBytes = () => { const b = read(registryPath, 2 * 1024 * 1024); if (digest(b) !== options.registryHash)
        return fail(); return b; };
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(registryBytes()));
    if (!raw || Object.keys(raw).sort().join(',') !== 'entries,version' || raw.version !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 10000)
        return fail();
    const entries = new Map(), sources = new Set();
    for (const item of raw.entries) {
        if (!item || Object.keys(item).sort().join(',') !== 'contentFingerprint,registration,resources' || !id(item.registration?.skillId) || !sha(item.contentFingerprint)
            || !Array.isArray(item.resources) || !item.resources.length || item.resources.length > 32)
            return fail();
        const r = parseReviewedSkillRegistration(Buffer.from(JSON.stringify(item.registration)), item.registration.skillId);
        if (entries.has(r.skillId) || sources.has(r.sourceName))
            return fail();
        sources.add(r.sourceName);
        const paths = new Set(), hashes = new Set();
        for (const resource of item.resources) {
            if (!resource || Object.keys(resource).sort().join(',') !== 'blob,path' || !sha(resource.blob) || typeof resource.path !== 'string'
                || resource.path.length > 240 || !resource.path.split('/').every((p) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(p) && !/[. ]$/.test(p))
                || paths.has(resource.path.toLowerCase()) || hashes.has(resource.blob))
                return fail();
            paths.add(resource.path.toLowerCase());
            hashes.add(resource.blob);
        }
        if (!item.resources.some((r) => r.path === 'SKILL.md'))
            return fail();
        entries.set(r.skillId, item);
    }
    const leases = new WeakMap();
    const evidence = (hash) => {
        if (!sha(hash))
            return fail();
        const b = read(join(metadata, 'blobs', hash), 1048576);
        if (digest(b) !== hash)
            return fail();
        return b;
    };
    const body = (item, hash) => {
        const resource = item.resources.find(r => r.blob === hash);
        if (!resource)
            return fail();
        const b = read(join(vault, 'Community', 'Skills', item.registration.sourceName, resource.path), 1048576);
        if (digest(b) !== hash)
            return fail();
        return b;
    };
    const host = {
        async candidatesPage(cursor, scanBudget = 8) {
            registryBytes();
            if (!Number.isSafeInteger(scanBudget) || scanBudget < 1 || scanBudget > 128)
                return fail();
            const offset = cursor === undefined ? 0 : Number(cursor);
            if (cursor !== undefined && (!/^\d+$/.test(cursor) || String(offset) !== cursor) || !Number.isSafeInteger(offset) || offset < 0 || offset > entries.size)
                return fail();
            const slice = [...entries.values()].slice(offset, offset + scanBudget), next = offset + slice.length;
            return { candidates: slice.filter(e => e.registration.state === 'admitted').map(e => e.registration.skillId),
                registryGeneration: options.registryHash, ...(next < entries.size ? { nextCursor: String(next) } : {}) };
        },
        async entry(skillId) {
            registryBytes();
            const item = entries.get(skillId);
            if (!item || item.registration.state !== 'admitted')
                return undefined;
            const entry = Object.freeze({ sourceName: item.registration.sourceName, releaseHash: item.registration.releaseHash,
                contentFingerprint: item.contentFingerprint, generation: options.registryHash });
            leases.set(entry, item);
            return entry;
        },
        async readBlob(hash, entry) {
            registryBytes();
            const item = entry && leases.get(entry);
            if (entry && !item)
                return fail();
            return item?.resources.some(r => r.blob === hash) ? body(item, hash) : evidence(hash);
        },
        assertFresh(entry, hashes = []) {
            registryBytes();
            const item = leases.get(entry);
            if (!item || hashes.length > 33)
                return fail();
            let total = 0;
            for (const h of hashes) {
                const b = h === item.registration.releaseHash ? evidence(h) : body(item, h);
                if ((total += b.length) > 4 * 1024 * 1024 + 65536)
                    return fail();
            }
        },
        sourceFingerprint: options.sourceFingerprint,
        async verifyEvidence(manifest) {
            registryBytes();
            const item = entries.get(manifest.skillId);
            if (!item || item.registration.state !== 'admitted')
                return false;
            if (item.resources.length !== manifest.resources.length || manifest.resources.some(r => !item.resources.some(p => p.blob === r.blob))
                || item.resources.find(r => r.path === 'SKILL.md')?.blob !== manifest.resources.find(r => r.id === manifest.mainResource)?.blob)
                return false;
            const valid = await verifySkillReleaseEvidence(manifest, item.registration, async (h) => item.resources.some(r => r.blob === h) ? body(item, h) : evidence(h));
            registryBytes();
            return valid;
        },
    };
    return host;
}
