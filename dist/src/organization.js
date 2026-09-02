import { createHash } from 'node:crypto';
/**
 * Lightweight knowledge-organization vocabulary.
 *
 * Scope and publication type remain authoritative security/workflow fields.
 * These fields describe how an agent should work with a note inside an
 * already-authorized scope; they never grant access or replace Git history.
 */
export const NOTE_KINDS = ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'question', 'hypothesis', 'assumption', 'decision', 'project', 'area', 'resource', 'journal', 'task'];
export const LIFECYCLES = ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'];
export const TASK_STATUSES = ['open', 'next_action', 'waiting', 'blocked', 'completed', 'cancelled'];
export const REVIEW_POLICIES = ['manual', 'periodic', 'on_source_change', 'on_link_change', 'on_any_edit'];
export const KNOWLEDGE_POLARITIES = ['positive', 'negative'];
export const NEGATIVE_KINDS = ['failure', 'rejected', 'counterexample', 'non_reproducible', 'superseded'];
/** Typed relationships are navigation metadata, never an access grant. */
export const RELATION_FIELDS = ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'related'];
export const ORGANIZATION_LIST_FIELDS = ['aliases', 'key_points', 'open_questions', 'next_actions', ...RELATION_FIELDS];
const noteKindSet = new Set(NOTE_KINDS);
const lifecycleSet = new Set(LIFECYCLES);
const taskStatusSet = new Set(TASK_STATUSES);
const reviewPolicySet = new Set(REVIEW_POLICIES);
const knowledgePolaritySet = new Set(KNOWLEDGE_POLARITIES);
const negativeKindSet = new Set(NEGATIVE_KINDS);
const relationFieldSet = new Set(RELATION_FIELDS);
function normalizedList(value, field, maximumItems, maximumChars) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (!Array.isArray(value))
        throw new Error(`${field} must be an array of strings`);
    const result = value.map((item, index) => {
        if (typeof item !== 'string' || !item.trim())
            throw new Error(`${field}[${index}] must be a non-empty string`);
        const text = item.trim();
        if (Array.from(text).length > maximumChars)
            throw new Error(`${field}[${index}] must be ${maximumChars} Unicode characters or fewer`);
        return text;
    });
    return Array.from(new Set(result)).slice(0, maximumItems);
}
function normalizedRelationMap(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('relations must be an object of typed link arrays');
    const result = {};
    for (const [field, raw] of Object.entries(value)) {
        if (!relationFieldSet.has(field))
            throw new Error(`Unsupported relation field: ${field}`);
        const normalized = normalizedList(raw, field, 30, 500);
        if (normalized?.length)
            result[field] = normalized;
    }
    return result;
}
export function normalizeTaskStatus(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!taskStatusSet.has(normalized))
        throw new Error(`taskStatus must be one of: ${TASK_STATUSES.join(', ')}`);
    return normalized;
}
export function normalizeReviewPolicy(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!reviewPolicySet.has(normalized))
        throw new Error(`reviewPolicy must be one of: ${REVIEW_POLICIES.join(', ')}`);
    return normalized;
}
export function normalizeKnowledgePolarity(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!knowledgePolaritySet.has(normalized))
        throw new Error(`polarity must be one of: ${KNOWLEDGE_POLARITIES.join(', ')}`);
    return normalized;
}
export function normalizeNegativeKind(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!negativeKindSet.has(normalized))
        throw new Error(`negativeType must be one of: ${NEGATIVE_KINDS.join(', ')}`);
    return normalized;
}
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
    const aliases = input.aliases === undefined ? normalizedList(existing.aliases, 'aliases', 30, 200) : normalizedList(input.aliases, 'aliases', 30, 200);
    const summary = input.summary === undefined ? optionalText(existing.summary, 'summary', 2000) : optionalText(input.summary, 'summary', 2000);
    const keyPoints = input.keyPoints === undefined ? normalizedList(existing.key_points, 'key_points', 20, 600) : normalizedList(input.keyPoints, 'key_points', 20, 600);
    const openQuestions = input.openQuestions === undefined ? normalizedList(existing.open_questions, 'open_questions', 20, 600) : normalizedList(input.openQuestions, 'open_questions', 20, 600);
    const nextActions = input.nextActions === undefined ? normalizedList(existing.next_actions, 'next_actions', 20, 600) : normalizedList(input.nextActions, 'next_actions', 20, 600);
    const waitingFor = input.waitingFor === undefined ? optionalText(existing.waiting_for, 'waiting_for', 500) : optionalText(input.waitingFor, 'waiting_for', 500);
    const stableId = input.stableId === undefined ? optionalText(existing.stable_id, 'stable_id', 80) : optionalText(input.stableId, 'stable_id', 80);
    if (stableId && !/^[a-z0-9][a-z0-9._-]*$/i.test(stableId))
        throw new Error('stableId may contain only letters, numbers, dots, underscores, and hyphens');
    const relationsInput = input.relations === undefined
        ? Object.fromEntries(RELATION_FIELDS.map(field => [field, existing[field]]).filter(([, value]) => value !== undefined))
        : input.relations;
    const relations = normalizedRelationMap(relationsInput);
    const taskStatus = input.taskStatus === undefined
        ? normalizeTaskStatus(existing.task_status)
        : normalizeTaskStatus(input.taskStatus);
    const reviewPolicy = input.reviewPolicy === undefined
        ? normalizeReviewPolicy(existing.review_policy)
        : normalizeReviewPolicy(input.reviewPolicy);
    const polarity = input.polarity === undefined
        ? normalizeKnowledgePolarity(existing.knowledge_polarity)
        : normalizeKnowledgePolarity(input.polarity);
    const negativeType = input.negativeType === undefined
        ? normalizeNegativeKind(existing.negative_type)
        : normalizeNegativeKind(input.negativeType);
    if (negativeType && polarity !== 'negative')
        throw new Error('negativeType requires polarity=negative');
    if (polarity === 'negative' && !negativeType)
        throw new Error('polarity=negative requires negativeType');
    const summaryFieldsPresent = Boolean(summary || keyPoints?.length || openQuestions?.length);
    const summaryDigest = summaryFieldsPresent && input.contentDigest !== undefined
        ? optionalText(input.contentDigest, 'summary_of_content_sha256', 128)
        : optionalText(existing.summary_of_content_sha256, 'summary_of_content_sha256', 128);
    return {
        note_kind: kind,
        lifecycle,
        ...(moc && { moc }),
        ...(project && { project }),
        ...(reviewAt && { review_at: reviewAt }),
        ...(aliases && { aliases }),
        ...(summary && { summary }),
        ...(keyPoints && { key_points: keyPoints }),
        ...(openQuestions && { open_questions: openQuestions }),
        ...(nextActions && { next_actions: nextActions }),
        ...(waitingFor && { waiting_for: waitingFor }),
        ...(stableId && { stable_id: stableId }),
        ...(taskStatus && { task_status: taskStatus }),
        ...(reviewPolicy && { review_policy: reviewPolicy }),
        ...(polarity && { knowledge_polarity: polarity }),
        ...(negativeType && { negative_type: negativeType }),
        ...(summaryDigest && { summary_of_content_sha256: summaryDigest }),
        ...(relations || {}),
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
    for (const field of ORGANIZATION_LIST_FIELDS) {
        const value = frontmatter[field];
        if (value === undefined)
            continue;
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
            issues.push({ code: `invalid_${field}`, detail: `${field} must be a non-empty string array.` });
            continue;
        }
        const duplicates = value.length !== new Set(value.map(item => item.trim())).size;
        if (duplicates)
            issues.push({ code: `duplicate_${field}`, detail: `${field} contains duplicate values; keep each property value once.` });
        if (RELATION_FIELDS.includes(field)) {
            for (const item of value) {
                if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(item) || item.includes('..')) {
                    issues.push({ code: `unsafe_${field}`, detail: `${field} contains an absolute or traversal-like path; references must remain scope-safe.` });
                    break;
                }
            }
        }
    }
    if (frontmatter.summary !== undefined && (typeof frontmatter.summary !== 'string' || Array.from(frontmatter.summary).length > 2000)) {
        issues.push({ code: 'invalid_summary', detail: 'summary must be a text property of 2000 Unicode characters or fewer.' });
    }
    if (frontmatter.stable_id !== undefined && (typeof frontmatter.stable_id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(frontmatter.stable_id))) {
        issues.push({ code: 'invalid_stable_id', detail: 'stable_id must contain only letters, numbers, dots, underscores, and hyphens.' });
    }
    if (frontmatter.task_status !== undefined && !taskStatusSet.has(String(frontmatter.task_status).trim().toLowerCase())) {
        issues.push({ code: 'invalid_task_status', detail: `task_status must be one of: ${TASK_STATUSES.join(', ')}` });
    }
    if (frontmatter.review_policy !== undefined && !reviewPolicySet.has(String(frontmatter.review_policy).trim().toLowerCase())) {
        issues.push({ code: 'invalid_review_policy', detail: `review_policy must be one of: ${REVIEW_POLICIES.join(', ')}` });
    }
    const polarity = frontmatter.knowledge_polarity === undefined ? undefined : String(frontmatter.knowledge_polarity).trim().toLowerCase();
    const negativeType = frontmatter.negative_type === undefined ? undefined : String(frontmatter.negative_type).trim().toLowerCase();
    if (polarity !== undefined && !knowledgePolaritySet.has(polarity)) {
        issues.push({ code: 'invalid_knowledge_polarity', detail: `knowledge_polarity must be one of: ${KNOWLEDGE_POLARITIES.join(', ')}` });
    }
    if (negativeType !== undefined && !negativeKindSet.has(negativeType)) {
        issues.push({ code: 'invalid_negative_type', detail: `negative_type must be one of: ${NEGATIVE_KINDS.join(', ')}` });
    }
    if (negativeType && polarity !== 'negative')
        issues.push({ code: 'negative_type_without_negative_polarity', detail: 'negative_type requires knowledge_polarity: negative.' });
    if (polarity === 'negative' && !negativeType)
        issues.push({ code: 'negative_polarity_without_type', detail: 'Negative knowledge should state whether it is a failure, rejection, counterexample, or non-reproducible result.' });
    const summaryPresent = typeof frontmatter.summary === 'string' || Array.isArray(frontmatter.key_points) || Array.isArray(frontmatter.open_questions);
    if (summaryPresent && frontmatter.summary_of_content_sha256 === undefined) {
        issues.push({ code: 'summary_fingerprint_missing', detail: 'Progressive summary fields should record summary_of_content_sha256 so stale summaries can be detected after body edits.' });
    }
    else if (summaryPresent && typeof frontmatter.summary_of_content_sha256 === 'string') {
        if (!/^[a-f0-9]{64}$/i.test(frontmatter.summary_of_content_sha256)) {
            issues.push({ code: 'invalid_summary_fingerprint', detail: 'summary_of_content_sha256 must be a SHA-256 hexadecimal digest of the current Markdown body.' });
        }
        else {
            const digest = createHash('sha256').update(content, 'utf8').digest('hex');
            if (frontmatter.summary_of_content_sha256 !== digest)
                issues.push({ code: 'stale_summary', detail: 'The note body changed after its stored progressive summary; regenerate the summary before relying on it.' });
        }
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
    if (kind === 'atomic' && content.split(/\n\s*\n/).filter(block => block.trim() && !block.trim().startsWith('#')).length > 8) {
        issues.push({ code: 'atomic_note_may_be_too_broad', detail: 'An atomic note contains many paragraphs; consider splitting durable claims and linking the resulting notes.' });
    }
    const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
    if (/(^|\/)inbox\//.test(normalizedPath) && lifecycle !== 'inbox') {
        issues.push({ code: 'inbox_lifecycle_mismatch', detail: 'Notes under Inbox should remain lifecycle: inbox until clarified and moved or reclassified.' });
    }
    return issues;
}
