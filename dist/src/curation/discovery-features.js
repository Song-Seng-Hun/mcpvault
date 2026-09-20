import { createHash } from 'node:crypto';
import { ordinaryCompilationDocument, wikiKnowledgeOutput } from '../compilation-policy.js';
import { isModerationHidden } from '../moderation-policy.js';
import { isFictionDomain } from '../fiction-domain.js';
import { relationCleanup } from './relation-cleanup.js';
/** Advisory deterministic cues only. Not managed ownership, permission, semantic
 * equivalence, historical use, or absence of protected references. */
export function curationFeatures(row) {
    const none = { version: 1, relations: false, body: null };
    const fm = row.frontmatter;
    const flag = (v) => v !== undefined && v !== false && String(v).trim().toLowerCase() !== 'false';
    try {
        if (!ordinaryCompilationDocument(row.path) && !wikiKnowledgeOutput(row.path))
            return none;
    }
    catch {
        return none;
    }
    if (fm.llm_wiki_type !== 'knowledge' || isModerationHidden(fm) || isFictionDomain(fm, row.path)
        || flag(fm.immutable) || flag(fm.source_only) || flag(fm.legal_hold) || fm.processing_mode === 'source_only'
        || String(fm.retention_policy ?? '').trim().toLowerCase() === 'preserve'
        || fm.preserve_until !== undefined || ['archived', 'superseded'].includes(String(fm.lifecycle)))
        return none;
    const cleanup = relationCleanup({ frontmatter: fm, revision: row.revision ?? '' }, row.path);
    return { version: 1, relations: cleanup.status === 'ready' && cleanup.removed > 0,
        body: row.text.trim() ? createHash('sha256').update(row.text).digest('hex') : null };
}
