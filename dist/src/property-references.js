/**
 * Managed frontmatter fields whose string values are note identities rather
 * than ordinary prose. Keeping this contract in one module prevents graph,
 * move, and delete operations from disagreeing about structural references.
 */
export const PLAIN_REFERENCE_PROPERTIES = new Set([
    'related_task', 'primary_moc', 'mocs', 'moc', 'project', 'term_replaced_by',
    'canonical_path', 'broader_terms', 'related_terms', 'see_also', 'project_support',
    'recall_repair_path', 'issue_follow_up_paths', 'replaced_by', 'replacement_path',
    'superseded_by', 'negative_replacement_path', 'moc_parent', 'focus_parent',
    'focus_supports', 'references', 'evidence_paths', 'knowledge_notes', 'focus_notes',
    'supersedes_source',
    'supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements',
    'blocked_by', 'answers_questions', 'tests', 'related', 'same_as', 'version_of', 'refines',
]);
const NESTED_REFERENCE_PROPERTIES = new Set([
    'path', 'target', 'evidence_paths', 'supports_claims', 'contradicts_claims', 'depends_on_claims',
]);
/**
 * These fields retain path snapshots for concurrency, review, or handoff.
 * Move/delete integrity must maintain them, but exposing them as live graph
 * edges would duplicate authored relations and pollute backlinks.
 */
const NON_NAVIGATIONAL_REFERENCE_ROOTS = new Set([
    'review_basis_links', 'review_basis_upstream', 'pending_edits', 'research_trail',
]);
export function isNavigationalFrontmatterReference(reference) {
    return !NON_NAVIGATIONAL_REFERENCE_ROOTS.has(reference.root);
}
/** Captured file paths are Vault-relative identities, not authored wikilinks. */
export function isReferenceSnapshotPath(segments) {
    if (segments[0] === 'review_basis_upstream') {
        return segments.length === 4 && segments[1] === 'entries' && typeof segments[2] === 'number' && segments[3] === 'path';
    }
    return ['review_basis_links', 'pending_edits', 'research_trail'].includes(String(segments[0]))
        && segments.length === 3 && typeof segments[1] === 'number' && segments[2] === 'path';
}
export function propertyPathText(segments) {
    return segments.map((segment, index) => typeof segment === 'number' ? `[${segment}]` : `${index > 0 ? '.' : ''}${segment}`).join('');
}
export function acceptsPlainReference(segments) {
    const names = segments.filter((segment) => typeof segment === 'string');
    const root = names[0] || '';
    const leaf = names.at(-1) || '';
    if (PLAIN_REFERENCE_PROPERTIES.has(root) && names.length === 1)
        return true;
    if (root === 'relation_evidence')
        return true;
    if (root === 'claims' && NESTED_REFERENCE_PROPERTIES.has(leaf))
        return true;
    if (['evidence', 'review_basis_links', 'review_basis_upstream', 'pending_edits', 'research_trail'].includes(root) && NESTED_REFERENCE_PROPERTIES.has(leaf))
        return true;
    return false;
}
/** Return path-like values; explicit Obsidian links stay handled by the Markdown scanner. */
export function collectPlainFrontmatterReferences(frontmatter) {
    const references = [];
    const visit = (value, segments) => {
        if (typeof value === 'string') {
            if (!acceptsPlainReference(segments) || /!?\[\[[^\]]+\]\]/.test(value) || /\[[^\]]*\]\(\s*<?[^>\s)]+/.test(value))
                return;
            const names = segments.filter((segment) => typeof segment === 'string');
            references.push({ propertyPath: propertyPathText(segments), value, root: names[0] || '', leaf: names.at(-1) || '' });
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, [...segments, index]));
            return;
        }
        if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, item]) => visit(item, [...segments, key]));
        }
    };
    Object.entries(frontmatter).forEach(([key, value]) => visit(value, [key]));
    return references;
}
