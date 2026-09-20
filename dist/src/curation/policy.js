import { compilationPath, ordinaryCompilationDocument, wikiKnowledgeOutput } from '../compilation-policy.js';
import { id, object, unavailable } from '../evolution/policy.js';
export const CURATION_OPERATIONS = ['deduplicate_relations', 'archive_duplicate', 'merge_duplicates', 'merge_passages'];
export function curationPath(value) {
    const path = compilationPath(value);
    if (!ordinaryCompilationDocument(path))
        return unavailable();
    return path;
}
/** Structural journal/input validation only. Does not authorize a service path. */
export function curationRecordPath(value) {
    const path = compilationPath(value);
    return wikiKnowledgeOutput(path) ? path : curationPath(path);
}
/** Host-owned exact-path automation grant. Metadata cannot grant managed ownership. */
export function curationGrants(value) {
    if (!Array.isArray(value) || value.length > 32)
        return unavailable();
    return value.map(item => {
        const r = object(item, ['accountId', 'paths', 'operations', 'owner']);
        if (!Array.isArray(r.paths) || !r.paths.length || r.paths.length > 64
            || !Array.isArray(r.operations) || !r.operations.length || r.operations.some(v => !CURATION_OPERATIONS.includes(v)))
            return unavailable();
        if (r.owner !== undefined && (r.owner !== 'wiki_knowledge' || r.operations.some(v => v !== 'deduplicate_relations')))
            return unavailable();
        const paths = r.paths.map((p) => {
            if (r.owner === undefined)
                return curationPath(p);
            const path = compilationPath(p);
            return wikiKnowledgeOutput(path) ? path : unavailable();
        });
        if (new Set(paths.map(p => p.toLowerCase())).size !== paths.length || new Set(r.operations).size !== r.operations.length)
            return unavailable();
        return { accountId: id(r.accountId), paths, operations: [...r.operations], ...(r.owner && { owner: r.owner }) };
    });
}
