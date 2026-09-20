import { compilationPath, ordinaryCompilationDocument } from '../compilation-policy.js';
import { id, object, unavailable } from '../evolution/policy.js';
export const CURATION_OPERATIONS = ['deduplicate_relations'];
export function curationPath(value) {
    const path = compilationPath(value);
    if (!ordinaryCompilationDocument(path))
        return unavailable();
    return path;
}
/** Host-owned exact-path automation grant. Metadata cannot grant managed ownership. */
export function curationGrants(value) {
    if (!Array.isArray(value) || value.length > 32)
        return unavailable();
    return value.map(item => {
        const r = object(item, ['accountId', 'paths', 'operations']);
        if (!Array.isArray(r.paths) || !r.paths.length || r.paths.length > 64
            || !Array.isArray(r.operations) || !r.operations.length || r.operations.some(v => !CURATION_OPERATIONS.includes(v)))
            return unavailable();
        const paths = r.paths.map(curationPath);
        if (new Set(paths.map(p => p.toLowerCase())).size !== paths.length || new Set(r.operations).size !== r.operations.length)
            return unavailable();
        return { accountId: id(r.accountId), paths, operations: [...r.operations] };
    });
}
