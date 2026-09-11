import { guidanceError } from './guidance-runtime.js';
import { isModerationHidden } from './moderation-policy.js';
import { contextRuleState } from './context-rules.js';
import { buildMarkdownLiteralMask } from './backlinks.js';
import { selectContextPassages } from './context-passages.js';
import { isFictionDomain } from './fiction-domain.js';
export function isSituationMemory(fm) {
    return Boolean(fm.memory_entries) || ['core', 'episodic'].includes(fm.memory_role)
        || ['diary', 'log', 'reflection'].includes(fm.note_kind)
        || ['diary', 'log', 'reflection', 'journal_entry'].includes(fm.mcpvault_type);
}
/** Metadata discovery reuses existing indexes. No prompt execution, body hydration,
 * cross-request cache, or private-memory aggregation. Eligibility precedes top-k. */
export async function selectSituationCandidates(fs, access, retrieval, query, options, principal, semantic = false) {
    const allowed = new Set();
    const revisions = new Map();
    const activated = [];
    const diagnostics = [];
    const canAccess = (p) => access.canAccessPhysicalPath(p, principal) && retrieval.skillDiscoveryAllowed(p);
    let after;
    let examined = 0;
    do {
        const batch = await fs.queryNotes({ limit: 500, includeContent: false, includeTotal: false, sortBy: 'path', ...(after && { after }) }, canAccess, n => !isModerationHidden(n.frontmatter) && !isFictionDomain(n.frontmatter, n.path) && !n.frontmatter.mcpvault_type && !isSituationMemory(n.frontmatter));
        for (const n of batch.notes) {
            if (++examined > 10000)
                throw guidanceError(new Error('Situation metadata window exhausted'), 'guid-cb08ef637cea601e');
            const state = contextRuleState(n.frontmatter.context_rules, `${query}\n${options.context}`, options.intent);
            if (state === 'invalid' || state === 'conditions_unmatched') {
                if (options.explain && diagnostics.length < 8)
                    diagnostics.push({ physicalPath: n.path, revision: n.revision, reason: state === 'invalid' ? 'invalid_context_rules' : 'conditions_unmatched' });
                continue;
            }
            allowed.add(n.path);
            if (n.revision)
                revisions.set(n.path, n.revision);
            const rules = n.frontmatter.context_rules;
            if (state === 'conditions_matched' && (rules.any?.length || rules.all?.length) && activated.length < 12)
                activated.push({ p: n.path, physicalPath: n.path, t: '', ex: '', mc: 0, ...(n.revision && { rv: n.revision }), why: ['retrieval_cue_match'] });
        }
        after = batch.truncated ? batch.nextCursor : undefined;
        if (batch.truncated && !after)
            throw guidanceError(new Error('Situation metadata changed'), 'guid-cb0beec6f8a0e1c5');
    } while (after);
    // Reserve eight candidate slots for explicit safety/evidence relations.
    const outcome = await retrieval.memoryCandidates({ query, limit: 12, ...(principal && { principal }), semantic, canAccessPath: p => allowed.has(p) && canAccess(p), candidateRevisions: revisions });
    // Put up to two explicit activations inside the existing retrieval budget and
    // early enough for downstream bounded hydration. Keep richer retrieved hits
    // when available; all unused reserved slots return to ordinary ranking.
    const pathOf = (hit) => retrieval.physical(hit, principal);
    const reserved = activated.slice(0, 2).map(hit => outcome.results.find(h => pathOf(h) === pathOf(hit)) ?? hit);
    const reservedPaths = new Set(reserved.map(pathOf));
    const hits = [...reserved, ...outcome.results.filter(hit => !reservedPaths.has(pathOf(hit)))].slice(0, 12);
    return { ...outcome, results: hits, diagnostics, activatedPaths: [...reservedPaths] };
}
/** Keep source units intact. A clipped unit becomes an exact continuation rather
 * than a sentence fragment that could hide a qualification. */
export function situationPassages(content, startLine, selected) {
    const lines = content.split('\n');
    const mask = buildMarkdownLiteralMask(content);
    let offset = 0;
    const warnings = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!mask[offset] && /^#{1,6}\s+(?:.*\b(?:warning|caution|condition|exception|prerequisite)\b|.*(?:주의|조건|예외|전제))/i.test(line))
            warnings.push(startLine + i);
        offset += line.length + 1;
    }
    const anchor = selected.passages[0]?.startLine ?? startLine;
    warnings.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor));
    const base = selected.passages.filter(p => !p.truncated);
    if (warnings.length && !base.some(p => p.startLine <= warnings[0] && p.endLine >= warnings[0])) {
        const extra = selectContextPassages({ content, query: '', startLine, preferredLine: warnings[0], maxChars: 1200, maxPassages: 1 });
        const warning = extra.passages.find(p => !p.truncated);
        if (warning && !base.some(p => p.startLine <= warning.endLine && p.endLine >= warning.startLine)) {
            if (base.length > 1)
                base.pop();
            if (base.reduce((n, p) => n + p.text.length, 0) + warning.text.length <= 1200)
                base.push(warning);
            else
                selected.truncated = true;
        }
        else if (extra.truncated)
            selected.truncated = true;
    }
    return { passages: base, truncated: selected.truncated || base.length < selected.passages.length };
}
