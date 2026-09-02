/**
 * Lightweight knowledge-organization vocabulary.
 *
 * Scope and publication type remain authoritative security/workflow fields.
 * These fields describe how an agent should work with a note inside an
 * already-authorized scope; they never grant access or replace Git history.
 */
export const NOTE_KINDS = ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'decision', 'project', 'area', 'resource', 'journal', 'task'];
export const LIFECYCLES = ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'];
const noteKindSet = new Set(NOTE_KINDS);
const lifecycleSet = new Set(LIFECYCLES);
export function normalizeNoteKind(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!noteKindSet.has(normalized))
        throw new Error(`noteKind must be one of: ${NOTE_KINDS.join(', ')}`);
    return normalized;
}
export function normalizeLifecycle(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!lifecycleSet.has(normalized))
        throw new Error(`lifecycle must be one of: ${LIFECYCLES.join(', ')}`);
    return normalized;
}
export function lifecycleForKnowledgeStatus(status) {
    switch (status.trim().toLowerCase()) {
        case 'verified': return 'evergreen';
        case 'superseded': return 'superseded';
        case 'disputed': return 'review';
        default: return 'review';
    }
}
function optionalText(value, field, maximum) {
    if (value === undefined || value === null || String(value).trim() === '')
        return undefined;
    const text = String(value).trim();
    if (Array.from(text).length > maximum)
        throw new Error(`${field} must be ${maximum} Unicode characters or fewer`);
    return text;
}
export function normalizeReviewAt(value) {
    const date = optionalText(value, 'reviewAt', 40);
    if (!date)
        return undefined;
    if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(date) || Number.isNaN(Date.parse(date))) {
        throw new Error('reviewAt must be an ISO date or date-time');
    }
    return date;
}
export function knowledgeOrganization(input) {
    const existing = input.existing || {};
    const existingKind = normalizeNoteKind(existing.note_kind);
    const existingLifecycle = normalizeLifecycle(existing.lifecycle);
    const kind = normalizeNoteKind(input.noteKind, existingKind || 'knowledge') || 'knowledge';
    const lifecycle = normalizeLifecycle(input.lifecycle, existingLifecycle || lifecycleForKnowledgeStatus(input.status)) || lifecycleForKnowledgeStatus(input.status);
    const moc = input.moc === undefined ? optionalText(existing.moc, 'moc', 500) : optionalText(input.moc, 'moc', 500);
    const project = input.project === undefined ? optionalText(existing.project, 'project', 500) : optionalText(input.project, 'project', 500);
    const reviewAt = input.reviewAt === undefined ? normalizeReviewAt(existing.review_at) : normalizeReviewAt(input.reviewAt);
    return {
        note_kind: kind,
        lifecycle,
        ...(moc && { moc }),
        ...(project && { project }),
        ...(reviewAt && { review_at: reviewAt }),
    };
}
export function organizationLintIssues(path, frontmatter, content, nowMs = Date.now()) {
    const issues = [];
    const type = String(frontmatter.llm_wiki_type || '').trim().toLowerCase();
    const kindValue = frontmatter.note_kind;
    const lifecycleValue = frontmatter.lifecycle;
    const kind = kindValue === undefined ? undefined : String(kindValue).trim().toLowerCase();
    const lifecycle = lifecycleValue === undefined ? undefined : String(lifecycleValue).trim().toLowerCase();
    if (kindValue !== undefined && !noteKindSet.has(kind || '')) {
        issues.push({ code: 'invalid_note_kind', detail: `note_kind must be one of: ${NOTE_KINDS.join(', ')}` });
    }
    if (lifecycleValue !== undefined && !lifecycleSet.has(lifecycle || '')) {
        issues.push({ code: 'invalid_lifecycle', detail: `lifecycle must be one of: ${LIFECYCLES.join(', ')}` });
    }
    if (kind === 'project' && lifecycle === 'active' && !frontmatter.next_action && !frontmatter.waiting_for) {
        issues.push({ code: 'active_project_without_next_action', detail: 'An active project should declare next_action or waiting_for so another agent can move it forward.' });
    }
    if (type !== 'knowledge')
        return issues;
    if (!kind)
        issues.push({ code: 'knowledge_note_kind_missing', detail: 'Knowledge notes should declare note_kind so agents can distinguish atomic claims, MOCs, decisions, and other work.' });
    if (!lifecycle)
        issues.push({ code: 'knowledge_lifecycle_missing', detail: 'Knowledge notes should declare lifecycle: inbox, active, review, evergreen, superseded, or archived.' });
    const reviewAt = frontmatter.review_at;
    if (reviewAt !== undefined) {
        const reviewText = String(reviewAt).trim();
        if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(reviewText) || Number.isNaN(Date.parse(reviewText))) {
            issues.push({ code: 'invalid_review_at', detail: 'review_at should be an ISO date or date-time.' });
        }
        else if (Date.parse(reviewText) <= nowMs && lifecycle !== 'archived' && lifecycle !== 'superseded') {
            issues.push({ code: 'knowledge_review_due', detail: `Knowledge review is due (${reviewText}). Re-check evidence and either update, dispute, or reschedule it.` });
        }
    }
    else if (lifecycle === 'review') {
        issues.push({ code: 'review_date_missing', detail: 'Notes in review should set review_at so the next agent can find them again.' });
    }
    if (kind === 'moc' && !/\[\[[^\]]+\]\]/.test(content)) {
        issues.push({ code: 'moc_without_links', detail: 'A MOC should link to at least one related note with Obsidian [[wikilinks]].' });
    }
    const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
    if (/(^|\/)inbox\//.test(normalizedPath) && lifecycle !== 'inbox') {
        issues.push({ code: 'inbox_lifecycle_mismatch', detail: 'Notes under Inbox should remain lifecycle: inbox until clarified and moved or reclassified.' });
    }
    return issues;
}
