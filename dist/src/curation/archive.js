import { hash } from '../evolution/policy.js';
import { posix } from 'node:path';
// Titles can carry names or conditions absent from the body. They require an
// explicit mapping just like aliases; only bookkeeping timestamps are ignored.
const PRESENTATION = new Set(['created', 'updated', 'created_at', 'updated_at']);
const DUTIES = ['active_task', 'required_rule', 'mandatory', 'critical_warning'];
/** Narrow automatic duplicate proof, not a semantic-equivalence classifier.
 * Unknown properties, provenance, aliases, conditions and raw body are retained.
 * Broader replacement proposals require reviewed passage mappings. */
export function archiveCoverage(source, replacement) {
    // Equal link spelling need not mean equal targets in a different directory.
    // Cross-directory retirement needs a resolved reference mapping first.
    if (source.path && replacement.path && posix.dirname(source.path) !== posix.dirname(replacement.path))
        return false;
    if (!source.content.trim() || source.content !== replacement.content)
        return false;
    if (DUTIES.some(key => source.frontmatter[key] !== undefined)
        || ['task', 'moc', 'rule'].includes(String(source.frontmatter.note_kind ?? '')))
        return false;
    for (const item of [source, replacement]) {
        if (item.frontmatter.llm_wiki_type !== 'knowledge'
            || !['active', 'evergreen', 'review', ''].includes(String(item.frontmatter.lifecycle ?? ''))
            || ['superseded', 'deprecated'].includes(String(item.frontmatter.knowledge_status ?? '')))
            return false;
    }
    const semantic = (fm) => Object.fromEntries(Object.entries(fm)
        .filter(([key]) => !PRESENTATION.has(key)).sort(([a], [b]) => a.localeCompare(b)));
    return hash(semantic(source.frontmatter)) === hash(semantic(replacement.frontmatter));
}
