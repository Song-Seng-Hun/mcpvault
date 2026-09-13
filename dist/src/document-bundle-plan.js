import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { documentChapters } from './document-chapters.js';
import { isDocumentBundleId } from './document-bundle-identities.js';
import { bundleIdentity } from './compilation-bundle-model.js';
import { compilationHash, compilationPath, ordinaryCompilationDocument } from './compilation-policy.js';
import { EXPRESSION_REVISION } from './expression-profile.js';
export const BUNDLE_PLAN_RULE = 'private-chapter-plan-v1';
export function createBundlePlan(source, basis) {
    if (!basis || typeof basis !== 'object' || Object.keys(basis).sort().join(',') !== 'bundleId,chapterRoot,documentId,ruleVersion'
        || !isDocumentBundleId(basis.documentId) || !isDocumentBundleId(basis.bundleId)
        || typeof basis.ruleVersion !== 'string' || !basis.ruleVersion.trim() || basis.ruleVersion.length > 100
        || /[\x00-\x1f\x7f]/.test(basis.ruleVersion) || /[#\[\]^]/.test(basis.chapterRoot)
        || !ordinaryCompilationDocument(compilationPath(`${basis.chapterRoot}/chapter.md`)))
        throw guidanceError(new Error('Chapter plan unavailable'), 'guid-26ea31cd374e1dbf');
    const chapters = documentChapters(source);
    if (chapters.length > 4096)
        throw guidanceError(new Error('Chapter plan exceeds bounded size'), 'guid-849bc800946f2b69');
    const hashes = chapters.map(c => createHash('sha256').update(source.raw.slice(c.startOffset, c.endOffset)).digest('hex'));
    const counts = new Map();
    for (const hash of hashes)
        counts.set(hash, (counts.get(hash) ?? 0) + 1);
    const items = chapters.map((chapter, index) => {
        const sourceHash = hashes[index], ambiguous = counts.get(sourceHash) > 1;
        // Unchanged, unique source units keep identity across insertion and moves.
        // Ambiguity never reuses an older occurrence by its ordinal or label.
        const chapterId = bundleIdentity({ kind: 'document-chapter-id-v1', documentId: basis.documentId, sourceHash,
            ...(ambiguous && { bundleId: basis.bundleId, startOffset: chapter.startOffset }) });
        return { chapterId, path: `${basis.chapterRoot}/${chapterId}.md`, parent: source.path,
            identity: ambiguous ? 'ambiguous' : 'content', sourceHash,
            kind: chapter.kind, title: chapter.title, description: chapter.description,
            startOffset: chapter.startOffset, endOffset: chapter.endOffset, position: index + 1,
            previous: undefined, next: undefined };
    });
    for (let i = 0; i < items.length; i++) {
        items[i].previous = items[i - 1]?.path;
        items[i].next = items[i + 1]?.path;
    }
    const revision = compilationHash({ rule: BUNDLE_PLAN_RULE, expressionRevision: EXPRESSION_REVISION, ...basis, sourcePath: source.path, sourceRevision: source.revision, items });
    return { revision, rule: BUNDLE_PLAN_RULE, documentId: basis.documentId, bundleId: basis.bundleId,
        sourceRevision: source.revision, items };
}
