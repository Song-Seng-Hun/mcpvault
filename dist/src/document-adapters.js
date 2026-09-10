import { guidanceError } from './guidance-runtime.js';
import { pdfRangeProvenance } from './document-pdf.js';
/** Call only on a currently authorized DocumentIndex result. No fetching, model
 * calls or framework constructors occur here; consumers own their scoped store.
 * Explicit publicPath avoids exporting physical private-scope paths by accident. */
export function documentRecords(doc, publicPath, options = {}) {
    if (!publicPath || publicPath.length > 500 || /[\x00-\x1f]/.test(publicPath) || publicPath.startsWith('_scopes/'))
        throw guidanceError(new Error('An explicit public path is required'), 'guid-ef125b6691cbb06c');
    return doc.fragments.filter(f => options.includeContainers || !f.children.length).map(f => ({
        id: f.id, text: doc.raw.slice(f.startOffset, f.endOffset),
        metadata: { path: publicPath, revision: doc.revision, profile: doc.profile, kind: f.kind,
            headingPath: [...f.headingPath], description: f.description },
        locator: { unit: doc.locator ?? 'source UTF-16 half-open offsets; one-based lines', startOffset: f.startOffset, endOffset: f.endOffset,
            startLine: f.startLine, endLine: f.endLine },
        relationships: { ...(f.parent && { parent: f.parent }), ...(f.previous && { previous: f.previous }),
            ...(f.next && { next: f.next }), children: [...f.children], references: [...f.references] },
        ...(doc.pdfPages && { pdfProvenance: pdfRangeProvenance(doc, f.startOffset, f.endOffset) }),
    }));
}
/** Structural data accepted by LangChain Document constructors (no dependency). */
export function toLangChainDocument(record) {
    return { id: record.id, pageContent: record.text, metadata: {
            ...record.metadata, locator: { ...record.locator }, relationships: structuredClone(record.relationships),
            ...(record.pdfProvenance && { pdfProvenance: structuredClone(record.pdfProvenance) }),
        } };
}
/** TextNode constructor data; relationships remain neutral metadata rather than
 * pretending strings are a version-specific LlamaIndex RelatedNodeInfo API. */
export function toLlamaIndexNode(record) {
    return { id_: record.id, text: record.text, metadata: {
            ...record.metadata, locator: { ...record.locator }, sourceRelationships: structuredClone(record.relationships),
            ...(record.pdfProvenance && { pdfProvenance: structuredClone(record.pdfProvenance) }),
        } };
}
