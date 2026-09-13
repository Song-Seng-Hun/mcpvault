import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { compilationHash, compilationPath, ordinaryCompilationDocument } from './compilation-policy.js';
import { compilationId, isCompilationRevision } from './compilation-model.js';
import { isDocumentBundleId } from './document-bundle-identities.js';
export const bundleRecordId = (kind, bundleId) => compilationHash({ kind: `document-bundle-${kind}-v1`, bundleId });
export const bundleIdentity = (basis) => {
    const h = compilationHash(basis);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export function parseCompilationBundle(value) {
    const b = value;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).sort().join(',') !==
        'accountId,attempts,authority,bundleId,chapterRoot,documentId,documentPath,mode,projectId,sourceRevision,status,version'
        || b.version !== 1 || !isDocumentBundleId(b.bundleId) || !isDocumentBundleId(b.documentId)
        || !compilationId(b.accountId) || !compilationId(b.projectId) || !isCompilationRevision(b.sourceRevision)
        || !isCompilationRevision(b.authority) || !['source_only', 'synthesis_allowed'].includes(b.mode)
        || !['prepared', 'source_preserved'].includes(b.status) || !Number.isSafeInteger(b.attempts) || b.attempts < 0 || b.attempts > 3
        || !ordinaryCompilationDocument(compilationPath(b.documentPath)) || typeof b.chapterRoot !== 'string'
        || /[#\[\]^]/.test(b.chapterRoot) || !ordinaryCompilationDocument(compilationPath(`${b.chapterRoot}/chapter.md`))) {
        throw guidanceError(new Error('Document bundle history unavailable; preserve it for host review'), 'guid-b05684b66a40d1e8');
    }
    return b;
}
export function parseBundleOriginal(value, b) {
    const o = value;
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join(',') !== 'bundleId,byteLength,path,revision,text,version'
        || o.version !== 1 || o.bundleId !== b.bundleId || o.path !== b.documentPath || o.revision !== b.sourceRevision
        || typeof o.text !== 'string' || !Number.isSafeInteger(o.byteLength) || o.byteLength < 0 || o.byteLength > 512 * 1024
        || Buffer.byteLength(o.text) !== o.byteLength || createHash('sha256').update(o.text).digest('hex') !== o.revision) {
        throw guidanceError(new Error('Document bundle original unavailable; preserve it for host review'), 'guid-118282feabfe32af');
    }
    return o;
}
