const fail = () => { throw Error('Reviewed skill manifest unavailable'); };
function object(value, keys, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return fail();
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
        return fail();
    const out = {};
    for (const k of Reflect.ownKeys(value)) {
        if (typeof k !== 'string' || !keys.includes(k))
            return fail();
        const d = Object.getOwnPropertyDescriptor(value, k);
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable)
            return fail();
        out[k] = d.value;
    }
    if (keys.some(k => !optional.includes(k) && !Object.hasOwn(out, k)))
        return fail();
    return out;
}
function text(value, max = 512) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value))
        return fail();
    if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{20,}|https?:\/\/[^/\s]*@|(?:api[_-]?key|password|access[_-]?token|secret)\s*[=:]\s*[^<$\s{]/i.test(value))
        return fail();
    return value.trim();
}
const id = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(v) ? v : fail();
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail();
function list(v, min, max, fn) {
    if (!Array.isArray(v) || v.length < min || v.length > max)
        return fail();
    return v.map(fn);
}
function hashes(v, min) { const a = list(v, min, 32, sha); if (new Set(a).size !== a.length)
    return fail(); return a; }
export function parseSkillReleaseManifest(input) {
    try {
        const row = object(input, ['version', 'skillId', 'sourceFingerprint', 'metadataEvidenceHash', 'policyRevision', 'mode', 'mainResource', 'resources', 'retainedFunctions', 'limitations', 'useWhen', 'avoidWhen', 'review', 'descriptorResource'], ['descriptorResource']);
        if (row.version !== 1 || row.mode !== 'procedural_reference')
            return fail();
        const resources = list(row.resources, 1, 32, v => {
            const r = object(v, ['id', 'blob', 'bytes', 'title', 'kind']);
            if (typeof r.bytes !== 'number' || !Number.isSafeInteger(r.bytes) || r.bytes < 1 || r.bytes > 1048576)
                return fail();
            if (r.kind !== 'procedure' && r.kind !== 'reference' && r.kind !== 'license' && r.kind !== 'descriptor')
                return fail();
            if (r.kind === 'descriptor' && r.bytes > 32768)
                return fail();
            return { id: id(r.id), blob: sha(r.blob), bytes: r.bytes, title: text(r.title, 128), kind: r.kind };
        });
        const mainResource = id(row.mainResource);
        const descriptorResource = Object.hasOwn(row, 'descriptorResource') ? id(row.descriptorResource) : undefined;
        const descriptors = resources.filter(r => r.kind === 'descriptor');
        if (descriptorResource ? descriptors.length !== 1 || descriptors[0].id !== descriptorResource : descriptors.length !== 0)
            return fail();
        if (new Set(resources.map(r => r.id)).size !== resources.length || !resources.some(r => r.id === mainResource && r.kind === 'procedure') || resources.reduce((n, r) => n + r.bytes, 0) > 4 * 1024 * 1024)
            return fail();
        const review = object(row.review, ['reviewer', 'evidenceHashes', 'normalCaseHashes', 'adversarialCaseHashes']);
        const result = { version: 1, skillId: id(row.skillId), sourceFingerprint: sha(row.sourceFingerprint), metadataEvidenceHash: sha(row.metadataEvidenceHash),
            policyRevision: id(row.policyRevision), mode: 'procedural_reference', mainResource, resources, ...(descriptorResource ? { descriptorResource } : {}),
            retainedFunctions: list(row.retainedFunctions, 1, 12, v => text(v)), limitations: list(row.limitations, 1, 12, v => text(v)),
            useWhen: list(row.useWhen, 1, 8, v => text(v)), avoidWhen: list(row.avoidWhen, 1, 8, v => text(v)),
            review: { reviewer: id(review.reviewer), evidenceHashes: hashes(review.evidenceHashes, 1), normalCaseHashes: hashes(review.normalCaseHashes, 3), adversarialCaseHashes: hashes(review.adversarialCaseHashes, 4) } };
        if (JSON.stringify(result).length > 32768)
            return fail();
        return result;
    }
    catch {
        return fail();
    }
}
