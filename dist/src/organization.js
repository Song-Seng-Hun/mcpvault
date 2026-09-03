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
export const TASK_STATUSES = ['open', 'next_action', 'waiting', 'blocked', 'someday', 'completed', 'cancelled'];
/** Optional Kanban-style class of service for executable work. */
export const SERVICE_CLASSES = ['expedite', 'fixed_date', 'standard', 'research'];
export const REVIEW_POLICIES = ['manual', 'periodic', 'on_source_change', 'on_link_change', 'on_any_edit', 'on_upstream_change'];
export const REVIEW_OUTCOMES = ['confirmed', 'revised', 'disputed', 'superseded', 'rescheduled'];
/** Small, repeatable quality checklist for an evidence review. */
export const REVIEW_CHECKS = ['evidence', 'links', 'summary', 'moc', 'counterexamples', 'scope', 'freshness'];
export const INTERPRETATION_STATUSES = ['unprocessed', 'interpreted', 'synthesized'];
export const QUESTION_STATUSES = ['open', 'answered', 'blocked', 'abandoned'];
export const HYPOTHESIS_STATUSES = ['proposed', 'supported', 'refuted', 'inconclusive'];
export const ASSUMPTION_STATUSES = ['active', 'verified', 'invalidated', 'replaced'];
/** Optional controlled-vocabulary state for a note title/alias. */
export const TERM_STATUSES = ['preferred', 'deprecated', 'redirect'];
/** A small Zettelkasten-style role vocabulary for durable knowledge notes. */
export const KNOWLEDGE_ROLES = ['concept', 'argument', 'model', 'observation', 'counterargument'];
/** Optional recall result for high-value knowledge; separate from evidence review. */
export const RECALL_QUALITIES = ['unseen', 'failed', 'partial', 'good'];
/** Error Book state is split into resolution and learning so a closed issue
 * can still leave an explicit retrospective trail. */
export const ISSUE_RESOLUTION_STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix', 'duplicate'];
export const ISSUE_RETROSPECTIVE_STATUSES = ['not_started', 'captured', 'synthesized'];
export const KNOWLEDGE_POLARITIES = ['positive', 'negative'];
export const NEGATIVE_KINDS = ['failure', 'rejected', 'counterexample', 'non_reproducible', 'superseded'];
/** Retention is a preservation hint, not an automatic deletion command. */
export const RETENTION_POLICIES = ['preserve', 'review', 'archive', 'tombstone'];
/** Optional event that starts or explains a retention window. */
export const RETENTION_EVENTS = ['manual', 'created', 'last_modified', 'review_completed', 'superseded', 'project_completed'];
/** GTD horizons from concrete action up to purpose; these are optional focus metadata. */
export const FOCUS_HORIZONS = ['ground', 'project', 'area', 'goal', 'vision', 'purpose'];
/** GTD clarification outcomes. These are workflow metadata, not deletion commands. */
export const CLARIFY_DISPOSITIONS = ['knowledge', 'reference', 'project', 'someday', 'discard', 'delegate'];
/** Titles are an agent-facing API: generic names are hard to rediscover. */
const GENERIC_NOTE_TITLE = /^(?:untitled|new note|new document|note|knowledge|draft|todo|copy)(?:\s*[-_ ]?\d+)?$/i;
/** Typed relationships are navigation metadata, never an access grant. */
export const RELATION_FIELDS = ['supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on', 'implements', 'blocked_by', 'answers_questions', 'related', 'same_as', 'version_of', 'refines'];
/** These relations have a meaning that is incomplete when the reverse edge is absent. */
export const RECIPROCAL_RELATIONS = ['related', 'same_as'];
/** A compact ontology so agents can choose a relation by meaning, not by name. */
export const RELATION_SEMANTICS = [
    { field: 'supports', direction: 'directional', target: 'A claim, decision, or note supported by this note.', reciprocal: false },
    { field: 'contradicts', direction: 'directional', target: 'A claim or conclusion challenged by this note.', reciprocal: false },
    { field: 'supersedes', direction: 'directional', target: 'An older or replaced note.', reciprocal: false },
    { field: 'derived_from', direction: 'directional', target: 'The source or note from which this note was derived.', reciprocal: false },
    { field: 'depends_on', direction: 'directional', target: 'A prerequisite note, decision, or project.', reciprocal: false },
    { field: 'implements', direction: 'directional', target: 'The design, decision, or requirement implemented here.', reciprocal: false },
    { field: 'blocked_by', direction: 'directional', target: 'The note or dependency currently blocking this note.', reciprocal: false },
    { field: 'answers_questions', direction: 'directional', target: 'A question note answered by this note.', reciprocal: false },
    { field: 'related', direction: 'mutual', target: 'A materially related note without a stronger claim.', reciprocal: true },
    { field: 'same_as', direction: 'mutual', target: 'The same concept represented by another note or alias.', reciprocal: true },
    { field: 'version_of', direction: 'directional', target: 'The conceptual note this version belongs to.', reciprocal: false },
    { field: 'refines', direction: 'directional', target: 'A note made more precise or useful by this note.', reciprocal: false },
];
export function getOrganizationRelationContract() {
    return RELATION_SEMANTICS.map(entry => ({ ...entry }));
}
export const ORGANIZATION_LIST_FIELDS = ['aliases', 'tags', 'mocs', 'key_points', 'open_questions', 'next_actions', 'project_support', 'subject_terms', 'methods', 'audience', 'see_also', ...RELATION_FIELDS];
export const ORGANIZATION_PROPERTY_CONTRACT = [
    { name: 'note_kind', type: 'text', description: 'What the note is for', allowed: NOTE_KINDS },
    { name: 'lifecycle', type: 'text', description: 'What should happen to the knowledge next', allowed: LIFECYCLES },
    { name: 'captured_from', type: 'text', description: 'Bounded origin label for a fleeting Inbox capture', allowed: ['manual', 'chat', 'community', 'issue', 'experiment', 'external_source', 'other'], appliesTo: ['fleeting'] },
    { name: 'capture_reason', type: 'text', description: 'Why a fleeting observation was preserved; never a secret or raw prompt', appliesTo: ['fleeting'] },
    { name: 'capture_context', type: 'text', description: 'Short interpretation context for a fleeting observation', appliesTo: ['fleeting'] },
    { name: 'related_task', type: 'text', description: 'Scope-safe task or project reference associated with a fleeting capture', appliesTo: ['fleeting'] },
    { name: 'primary_moc', type: 'text', description: 'Preferred Obsidian MOC entry point for this note; navigation metadata only' },
    { name: 'mocs', type: 'list', description: 'Additional Obsidian MOC entry points for multi-context discovery; navigation metadata only' },
    { name: 'aliases', type: 'list', description: 'Alternate Obsidian names' },
    { name: 'tags', type: 'list', description: 'Native Obsidian tags used for lightweight faceted discovery' },
    { name: 'nav_order', type: 'number', description: 'Optional sibling order inside an MOC tree; lower numbers appear first, unnumbered items follow', appliesTo: ['moc'] },
    { name: 'stable_id', type: 'text', description: 'Durable identity for a note; not an access boundary' },
    { name: 'term_status', type: 'text', description: 'Optional authority-vocabulary state for this note title', allowed: TERM_STATUSES },
    { name: 'term_replaced_by', type: 'text', description: 'Preferred term or Obsidian link that replaces a deprecated term' },
    { name: 'term_scope_note', type: 'text', description: 'Short definition or scope note for this term' },
    { name: 'preferred_term', type: 'text', description: 'Preferred display term for an authority record; defaults to the note title' },
    { name: 'term_language', type: 'text', description: 'Optional language or script tag for authority labels, such as ko or en-US' },
    { name: 'authority_scheme', type: 'text', description: 'Optional vocabulary or authority source name' },
    { name: 'authority_id', type: 'text', description: 'Optional stable identifier in the declared authority scheme' },
    { name: 'disambiguation', type: 'text', description: 'Short qualifier distinguishing this term from homonyms' },
    { name: 'canonical_path', type: 'text', description: 'Visible canonical note path when this note is a redirect or duplicate' },
    { name: 'broader_terms', type: 'list', description: 'Optional broader concepts for library-style hierarchy' },
    { name: 'related_terms', type: 'list', description: 'Optional related concepts for authority discovery' },
    { name: 'subject_terms', type: 'list', description: 'Controlled or local subject access terms for faceted discovery' },
    { name: 'domain', type: 'text', description: 'Primary knowledge domain for faceted discovery' },
    { name: 'methods', type: 'list', description: 'Methods, techniques, or frameworks discussed by the note' },
    { name: 'audience', type: 'list', description: 'Intended readers or consumers of the note' },
    { name: 'retrieval_cues', type: 'list', description: 'Situations or problem signals that should surface this note' },
    { name: 'use_when', type: 'text', description: 'Compact description of when this note is useful' },
    { name: 'valid_from', type: 'text', description: 'Inclusive ISO date/time from which the claim or observation is applicable' },
    { name: 'valid_until', type: 'text', description: 'Exclusive ISO date/time after which the claim or observation must be reviewed before reuse' },
    { name: 'observed_at', type: 'text', description: 'ISO date/time when the represented condition was observed; distinct from file modification and source publication time' },
    { name: 'temporal_scope', type: 'text', description: 'Short human-readable condition or period in which the knowledge applies' },
    { name: 'knowledge_role', type: 'text', description: 'Atomic-note role in the knowledge graph', allowed: KNOWLEDGE_ROLES },
    { name: 'see_also', type: 'list', description: 'Additional Obsidian links for adjacent knowledge' },
    { name: 'summary', type: 'text', description: 'Compact progressive-read projection' },
    { name: 'key_points', type: 'list', description: 'Compact key points for progressive reads' },
    { name: 'open_questions', type: 'list', description: 'Questions that remain open' },
    { name: 'summary_layer', type: 'number', description: 'Progressive Summarization layer from 0 to 4' },
    { name: 'summary_highlights', type: 'list', description: 'Bounded highlighted passages; nested objects are MCP-managed' },
    { name: 'summary_of_content_sha256', type: 'text', description: 'Body digest for projection freshness' },
    { name: 'next_action', type: 'text', description: 'One concrete GTD action', appliesTo: ['project', 'task'] },
    { name: 'next_actions', type: 'list', description: 'Bounded GTD action list', appliesTo: ['project', 'task'] },
    { name: 'time_estimate_minutes', type: 'number', description: 'Optional rough effort estimate for one execution step', appliesTo: ['project', 'task'] },
    { name: 'energy', type: 'text', description: 'Optional energy needed for execution: low, medium, or high', allowed: ['low', 'medium', 'high'], appliesTo: ['project', 'task'] },
    { name: 'effort', type: 'text', description: 'Optional coarse effort class: low, medium, or high', allowed: ['low', 'medium', 'high'], appliesTo: ['project', 'task'] },
    { name: 'waiting_for', type: 'text', description: 'External dependency or owner', appliesTo: ['project', 'task'] },
    { name: 'desired_outcome', type: 'text', description: 'Observable project outcome', appliesTo: ['project'] },
    { name: 'project_purpose', type: 'text', description: 'Why the project exists', appliesTo: ['project'] },
    { name: 'project_support', type: 'list', description: 'Project reference material, not another task list', appliesTo: ['project'] },
    { name: 'task_context', type: 'text', description: 'Execution context such as @research or @computer', appliesTo: ['project', 'task'] },
    { name: 'task_status', type: 'text', description: 'Operational task state, separate from lifecycle', allowed: TASK_STATUSES, appliesTo: ['project', 'task'] },
    { name: 'service_class', type: 'text', description: 'Optional Kanban priority class; does not bypass evidence or scope rules', allowed: SERVICE_CLASSES, appliesTo: ['project', 'task'] },
    { name: 'completion_criteria', type: 'list', description: 'Bounded observable conditions for considering project/task work complete', appliesTo: ['project', 'task'] },
    { name: 'started_at', type: 'text', description: 'Optional ISO time when executable work entered progress', appliesTo: ['project', 'task'] },
    { name: 'blocked_since', type: 'text', description: 'Optional ISO time when work became blocked', appliesTo: ['project', 'task'] },
    { name: 'waiting_since', type: 'text', description: 'Optional ISO time when work began waiting on an external dependency', appliesTo: ['project', 'task'] },
    { name: 'completed_at', type: 'text', description: 'Optional ISO time when work reached completion', appliesTo: ['project', 'task'] },
    { name: 'due_at', type: 'text', description: 'Latest acceptable completion time', appliesTo: ['project', 'task'] },
    { name: 'scheduled_at', type: 'text', description: 'Intended execution/calendar time', appliesTo: ['project', 'task'] },
    { name: 'defer_until', type: 'text', description: 'Do not reconsider before this time', appliesTo: ['project', 'task'] },
    { name: 'review_at', type: 'text', description: 'Next evidence review time' },
    { name: 'review_interval_days', type: 'number', description: 'Days after a completed review before the next review' },
    { name: 'review_snoozed_until', type: 'text', description: 'Do not surface in review queues before this ISO date/time' },
    { name: 'review_snooze_reason', type: 'text', description: 'Why this review was deferred' },
    { name: 'recall_prompt', type: 'text', description: 'Optional active-recall question for high-value knowledge' },
    { name: 'recall_interval_days', type: 'number', description: 'Optional days between active-recall prompts' },
    { name: 'last_recalled_at', type: 'text', description: 'Last time this note was actively recalled' },
    { name: 'recall_quality', type: 'text', description: 'Result of the latest active-recall attempt', allowed: RECALL_QUALITIES },
    { name: 'recall_confusion', type: 'text', description: 'Bounded description of what was not recalled or was confused; private for agent recall state' },
    { name: 'recall_repair_status', type: 'text', description: 'Whether a failed or partial recall needs a repair note', allowed: ['none', 'needed', 'in_progress', 'resolved'] },
    { name: 'recall_repair_path', type: 'text', description: 'Scope-safe note or task linked to repairing a recall failure' },
    { name: 'issue_resolution_status', type: 'text', description: 'Error Book resolution state, separate from retrospective learning', allowed: ISSUE_RESOLUTION_STATUSES },
    { name: 'issue_retrospective_status', type: 'text', description: 'Error Book retrospective state after resolution', allowed: ISSUE_RETROSPECTIVE_STATUSES },
    { name: 'issue_retrospective', type: 'text', description: 'Bounded reusable lesson from an exception review' },
    { name: 'issue_follow_up_paths', type: 'list', description: 'Bounded notes or tasks created to prevent recurrence' },
    { name: 'retention_policy', type: 'text', description: 'Preservation hint; never an automatic delete instruction', allowed: RETENTION_POLICIES },
    { name: 'retention_event', type: 'text', description: 'Event from which a retention window is interpreted', allowed: RETENTION_EVENTS },
    { name: 'retention_at', type: 'text', description: 'Optional date for preservation review or archival consideration' },
    { name: 'preserve_until', type: 'text', description: 'Do not propose archival or tombstoning before this date' },
    { name: 'legal_hold', type: 'boolean', description: 'Preserve this note and its history until an authorized human releases the hold' },
    { name: 'retention_reason', type: 'text', description: 'Why the note should be preserved, reviewed, archived, or tombstoned' },
    { name: 'replaced_by', type: 'text', description: 'Visible replacement note for a superseded or tombstoned note' },
    { name: 'review_policy', type: 'text', description: 'Event that re-enters review', allowed: REVIEW_POLICIES },
    { name: 'review_basis_upstream', type: 'object', description: 'Bounded typed-upstream revision/state baseline captured by publish or review' },
    { name: 'review_note', type: 'text', description: 'Short record of the latest review' },
    { name: 'review_checks', type: 'list', description: 'Quality dimensions checked during the latest evidence review', allowed: REVIEW_CHECKS },
    { name: 'review_open_items', type: 'list', description: 'Bounded follow-up items left by the latest review' },
    { name: 'last_review_outcome', type: 'text', description: 'Outcome of the latest evidence review', allowed: REVIEW_OUTCOMES },
    { name: 'last_reviewed_by', type: 'text', description: 'Reviewer identity' },
    { name: 'last_reviewed_at', type: 'text', description: 'Review completion time' },
    { name: 'last_reviewed_revision', type: 'text', description: 'Revision inspected by the reviewer' },
    { name: 'review_count', type: 'number', description: 'Number of completed reviews' },
    { name: 'review_reopen_count', type: 'number', description: 'Number of reviews reopened' },
    { name: 'interpretation_status', type: 'text', description: 'Source-to-knowledge processing stage', allowed: INTERPRETATION_STATUSES },
    { name: 'epistemic_status', type: 'text', description: 'Question, hypothesis, or assumption state' },
    { name: 'moc_questions', type: 'list', description: 'Questions a MOC should help answer', appliesTo: ['moc'] },
    { name: 'moc_parent', type: 'text', description: 'Parent MOC link', appliesTo: ['moc'] },
    { name: 'focus_horizon', type: 'text', description: 'GTD horizon from ground to purpose', allowed: FOCUS_HORIZONS },
    { name: 'focus_parent', type: 'text', description: 'Higher-level outcome link' },
    { name: 'focus_supports', type: 'list', description: 'Outcomes supported by this note' },
    { name: 'claims', type: 'list', description: 'Claim-level provenance objects' },
    { name: 'evidence', type: 'list', description: 'Evidence locator objects' },
    ...RELATION_FIELDS.map(name => ({ name, type: 'list', description: `Typed Obsidian links: ${name}` })),
    { name: 'relation_notes', type: 'object', description: 'Short rationale for typed relation fields; navigation metadata only' },
    { name: 'relation_evidence', type: 'object', description: 'Scope-safe evidence paths keyed by typed relation field' },
];
export function getOrganizationPropertyContract() {
    return ORGANIZATION_PROPERTY_CONTRACT.map(entry => ({ ...entry, ...(entry.allowed && { allowed: [...entry.allowed] }), ...(entry.appliesTo && { appliesTo: [...entry.appliesTo] }) }));
}
/**
 * Small, optional scaffolds for the common note roles.  Templates are
 * intentionally suggestions: ordinary Markdown remains valid and no
 * template is required for publication.
 */
export function organizationNoteTemplate(value = 'atomic') {
    const requested = String(value ?? 'atomic').trim().toLowerCase();
    const templateId = requested === 'negative' ? 'negative' : NOTE_KINDS.includes(requested) ? requested : 'atomic';
    const noteKind = templateId === 'negative' ? 'knowledge' : templateId;
    const templates = {
        atomic: {
            purpose: 'One reusable concept or claim written in your own words.',
            properties: { note_kind: 'atomic', lifecycle: 'evergreen', knowledge_role: 'concept', summary: '', related: [] },
            markdown: '# {{title}}\n\n## Claim\n\n## Why it matters\n\n## Links\n- [[ ]]\n',
        },
        literature: {
            purpose: 'A source interpretation that preserves provenance and points to derived knowledge.',
            properties: { note_kind: 'literature', lifecycle: 'active', interpretation_status: 'unprocessed', evidence_paths: [] },
            markdown: '# {{title}}\n\n## Source\n\n## Key points\n- \n\n## Interpretation\n\n## Derived notes\n- [[ ]]\n',
        },
        question: {
            purpose: 'An explicit unresolved question that can later receive a grounded answer.',
            properties: { note_kind: 'question', lifecycle: 'review', epistemic_status: 'open', answers_questions: [] },
            markdown: '# {{title}}\n\n## Question\n\n## Why it is open\n\n## Evidence to seek\n',
        },
        hypothesis: {
            purpose: 'A testable proposition kept separate from established knowledge.',
            properties: { note_kind: 'hypothesis', lifecycle: 'review', epistemic_status: 'proposed', supports: [], contradicts: [] },
            markdown: '# {{title}}\n\n## Hypothesis\n\n## Prediction\n\n## Test\n\n## Result\n',
        },
        decision: {
            purpose: 'A durable decision with alternatives, consequences, and evidence.',
            properties: { note_kind: 'decision', lifecycle: 'active', knowledge_role: 'argument', related: [] },
            markdown: '# {{title}}\n\n## Context\n\n## Decision\n\n## Alternatives\n- \n\n## Consequences\n- \n\n## Evidence\n- [[ ]]\n',
        },
        project: {
            purpose: 'An outcome-oriented project with one immediately actionable next step.',
            properties: { note_kind: 'project', lifecycle: 'active', task_status: 'open', desired_outcome: '', next_action: '', completion_criteria: [] },
            markdown: '# {{title}}\n\n## Desired outcome\n\n## Completion criteria\n- [ ] \n\n## Next action\n\n## Support\n- [[ ]]\n',
        },
        moc: {
            purpose: 'A map of content that answers a bounded set of navigation questions.',
            properties: { note_kind: 'moc', lifecycle: 'active', moc_questions: [] },
            markdown: '# {{title}}\n\n## Purpose\n\n## Questions this map answers\n- \n\n## Map\n- [[ ]]\n',
        },
        negative: {
            purpose: 'A reusable record of a failed, rejected, or non-reproducible path.',
            properties: { note_kind: 'knowledge', lifecycle: 'review', knowledge_polarity: 'negative', negative_type: 'failure' },
            markdown: '# {{title}}\n\n## Attempted\n\n## Observed failure\n\n## Reproduction\n\n## Reusable lesson\n',
        },
    };
    const template = templates[templateId] || templates.atomic;
    return { templateId, noteKind, ...template };
}
/**
 * Obsidian core Properties can display these values, but its native editor is
 * intentionally scalar/list-oriented and does not provide a good editor for
 * nested objects. Keep the structures for MCP provenance, while warning that
 * they are best maintained in Source mode or through MCP.
 */
const OBSIDIAN_COMPLEX_PROPERTY_FIELDS = ['summary_highlights', 'claims', 'evidence'];
const noteKindSet = new Set(NOTE_KINDS);
const lifecycleSet = new Set(LIFECYCLES);
const taskStatusSet = new Set(TASK_STATUSES);
const serviceClassSet = new Set(SERVICE_CLASSES);
const reviewPolicySet = new Set(REVIEW_POLICIES);
const reviewOutcomeSet = new Set(REVIEW_OUTCOMES);
const reviewCheckSet = new Set(REVIEW_CHECKS);
const interpretationStatusSet = new Set(INTERPRETATION_STATUSES);
const questionStatusSet = new Set(QUESTION_STATUSES);
const hypothesisStatusSet = new Set(HYPOTHESIS_STATUSES);
const assumptionStatusSet = new Set(ASSUMPTION_STATUSES);
const termStatusSet = new Set(TERM_STATUSES);
const knowledgeRoleSet = new Set(KNOWLEDGE_ROLES);
const recallQualitySet = new Set(RECALL_QUALITIES);
const retentionPolicySet = new Set(RETENTION_POLICIES);
const retentionEventSet = new Set(RETENTION_EVENTS);
const knowledgePolaritySet = new Set(KNOWLEDGE_POLARITIES);
const negativeKindSet = new Set(NEGATIVE_KINDS);
const clarifyDispositionSet = new Set(CLARIFY_DISPOSITIONS);
const relationFieldSet = new Set(RELATION_FIELDS);
const focusHorizonSet = new Set(FOCUS_HORIZONS);
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
function normalizedRelationNotes(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('relationNotes must be an object keyed by relation field');
    const result = {};
    for (const [field, raw] of Object.entries(value)) {
        if (!relationFieldSet.has(field))
            throw new Error(`Unsupported relation note field: ${field}`);
        const text = optionalText(raw, `relationNotes.${field}`, 500);
        if (text)
            result[field] = text;
    }
    return Object.keys(result).length ? result : undefined;
}
function normalizedRelationEvidence(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('relationEvidence must be an object keyed by relation field');
    const result = {};
    for (const [field, raw] of Object.entries(value)) {
        if (!relationFieldSet.has(field))
            throw new Error(`Unsupported relation evidence field: ${field}`);
        const paths = normalizedList(raw, `relationEvidence.${field}`, 8, 500);
        if (paths?.length)
            result[field] = paths;
    }
    return Object.keys(result).length ? result : undefined;
}
export function normalizeReviewChecks(value) {
    const checks = normalizedList(value, 'reviewChecks', REVIEW_CHECKS.length, 40);
    if (!checks)
        return undefined;
    for (const check of checks)
        if (!reviewCheckSet.has(check))
            throw new Error(`reviewChecks must contain only: ${REVIEW_CHECKS.join(', ')}`);
    return checks;
}
export function normalizeTaskStatus(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!taskStatusSet.has(normalized))
        throw new Error(`taskStatus must be one of: ${TASK_STATUSES.join(', ')}`);
    return normalized;
}
export function normalizeServiceClass(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!serviceClassSet.has(normalized))
        throw new Error(`serviceClass must be one of: ${SERVICE_CLASSES.join(', ')}`);
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
export function normalizeReviewOutcome(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!reviewOutcomeSet.has(normalized))
        throw new Error(`reviewOutcome must be one of: ${REVIEW_OUTCOMES.join(', ')}`);
    return normalized;
}
export function normalizeInterpretationStatus(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!interpretationStatusSet.has(normalized))
        throw new Error(`interpretationStatus must be one of: ${INTERPRETATION_STATUSES.join(', ')}`);
    return normalized;
}
export function normalizeEpistemicStatus(value, noteKind, fallback) {
    const supplied = value === undefined || value === null || String(value).trim() === '' ? fallback : String(value).trim().toLowerCase();
    if (!supplied)
        return undefined;
    const allowed = noteKind === 'question' ? questionStatusSet : noteKind === 'hypothesis' ? hypothesisStatusSet : noteKind === 'assumption' ? assumptionStatusSet : undefined;
    if (!allowed)
        throw new Error('epistemicStatus is only valid for noteKind question, hypothesis, or assumption');
    if (!allowed.has(supplied)) {
        const choices = noteKind === 'question' ? QUESTION_STATUSES : noteKind === 'hypothesis' ? HYPOTHESIS_STATUSES : ASSUMPTION_STATUSES;
        throw new Error(`epistemicStatus for ${noteKind} must be one of: ${choices.join(', ')}`);
    }
    return supplied;
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
export function normalizeClarifyDisposition(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!clarifyDispositionSet.has(normalized))
        throw new Error(`disposition must be one of: ${CLARIFY_DISPOSITIONS.join(', ')}`);
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
export function normalizeFocusHorizon(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!focusHorizonSet.has(normalized))
        throw new Error(`focusHorizon must be one of: ${FOCUS_HORIZONS.join(', ')}`);
    return normalized;
}
export function normalizeTermStatus(value, fallback = 'preferred') {
    const normalized = String(value ?? fallback).trim().toLowerCase() || fallback;
    if (!termStatusSet.has(normalized))
        throw new Error(`termStatus must be one of: ${TERM_STATUSES.join(', ')}`);
    return normalized;
}
export function normalizeKnowledgeRole(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!knowledgeRoleSet.has(normalized))
        throw new Error(`knowledgeRole must be one of: ${KNOWLEDGE_ROLES.join(', ')}`);
    return normalized;
}
export function normalizeRecallQuality(value, fallback = 'unseen') {
    const normalized = String(value ?? fallback).trim().toLowerCase() || fallback;
    if (!recallQualitySet.has(normalized))
        throw new Error(`recallQuality must be one of: ${RECALL_QUALITIES.join(', ')}`);
    return normalized;
}
export function normalizeRetentionPolicy(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!retentionPolicySet.has(normalized))
        throw new Error(`retentionPolicy must be one of: ${RETENTION_POLICIES.join(', ')}`);
    return normalized;
}
export function normalizeRetentionEvent(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (!retentionEventSet.has(normalized))
        throw new Error(`retentionEvent must be one of: ${RETENTION_EVENTS.join(', ')}`);
    return normalized;
}
export function normalizeBoolean(value, field, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    if (typeof value === 'boolean')
        return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true')
        return true;
    if (normalized === 'false')
        return false;
    throw new Error(`${field} must be a boolean`);
}
function normalizedHighlights(value, field) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (!Array.isArray(value))
        throw new Error(`${field} must be an array of highlight objects`);
    const result = value.slice(0, 12).map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            throw new Error(`${field}[${index}] must be an object`);
        const raw = item;
        const text = optionalText(raw.text, `${field}[${index}].text`, 600);
        if (!text)
            throw new Error(`${field}[${index}].text is required`);
        const startLine = raw.startLine === undefined ? undefined : Number(raw.startLine);
        const endLine = raw.endLine === undefined ? undefined : Number(raw.endLine);
        if (startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1))
            throw new Error(`${field}[${index}].startLine must be a positive integer`);
        if (endLine !== undefined && (!Number.isInteger(endLine) || endLine < 1))
            throw new Error(`${field}[${index}].endLine must be a positive integer`);
        if (startLine !== undefined && endLine !== undefined && endLine < startLine)
            throw new Error(`${field}[${index}].endLine must be greater than or equal to startLine`);
        const quoteHash = raw.quoteHash === undefined ? undefined : optionalText(raw.quoteHash, `${field}[${index}].quoteHash`, 128);
        if (quoteHash && !/^[a-f0-9]{64}$/i.test(quoteHash))
            throw new Error(`${field}[${index}].quoteHash must be a SHA-256 hexadecimal digest`);
        return { text, ...(startLine !== undefined && { startLine }), ...(endLine !== undefined && { endLine }), ...(quoteHash && { quoteHash }) };
    });
    return result.length ? result : undefined;
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
export function normalizeReviewIntervalDays(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1 || days > 3650)
        throw new Error('reviewIntervalDays must be an integer from 1 to 3650');
    return days;
}
export function normalizeNavOrder(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '')
        return fallback;
    if (typeof value !== 'number' && typeof value !== 'string')
        throw new Error('navOrder must be an integer from 0 to 1000000');
    const order = Number(value);
    if (!Number.isInteger(order) || order < 0 || order > 1_000_000)
        throw new Error('navOrder must be an integer from 0 to 1000000');
    return order;
}
export function normalizeIsoDate(value, field) {
    const date = optionalText(value, field, 40);
    if (!date)
        return undefined;
    if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(date) || Number.isNaN(Date.parse(date)))
        throw new Error(`${field} must be an ISO date or date-time`);
    return date;
}
/**
 * Derive a claim-validity card without confusing it with file, source, task,
 * or review dates. valid_from is inclusive and valid_until is exclusive.
 * This is a scheduling/navigation signal, never a truth judgment.
 */
export function temporalValidity(frontmatter, asOfMs = Date.now()) {
    const validFrom = typeof frontmatter.valid_from === 'string' && frontmatter.valid_from.trim() ? frontmatter.valid_from.trim() : undefined;
    const validUntil = typeof frontmatter.valid_until === 'string' && frontmatter.valid_until.trim() ? frontmatter.valid_until.trim() : undefined;
    const observedAt = typeof frontmatter.observed_at === 'string' && frontmatter.observed_at.trim() ? frontmatter.observed_at.trim() : undefined;
    const temporalScope = typeof frontmatter.temporal_scope === 'string' && frontmatter.temporal_scope.trim() ? frontmatter.temporal_scope.trim() : undefined;
    const card = {
        asOf: new Date(asOfMs).toISOString(),
        ...(validFrom && { validFrom }),
        ...(validUntil && { validUntil }),
        ...(observedAt && { observedAt }),
        ...(temporalScope && { temporalScope }),
    };
    const parse = (value) => value === undefined ? undefined : Date.parse(value);
    const fromMs = parse(validFrom);
    const untilMs = parse(validUntil);
    const observedMs = parse(observedAt);
    if ((validFrom && !Number.isFinite(fromMs)) || (validUntil && !Number.isFinite(untilMs)) || (observedAt && !Number.isFinite(observedMs))) {
        return { state: 'invalid', ...card, reason: 'invalid_temporal_date' };
    }
    if (fromMs !== undefined && untilMs !== undefined && untilMs <= fromMs) {
        return { state: 'invalid', ...card, reason: 'invalid_validity_range' };
    }
    if (fromMs !== undefined && asOfMs < fromMs)
        return { state: 'not_yet_valid', ...card };
    if (untilMs !== undefined && asOfMs >= untilMs)
        return { state: 'expired', ...card };
    if (validFrom || validUntil)
        return { state: 'current', ...card };
    return { state: 'unspecified', ...card };
}
export function knowledgeOrganization(input) {
    const existing = input.existing || {};
    const executionHints = {};
    if (input.tags !== undefined)
        executionHints.tags = normalizedList(input.tags, 'tags', 30, 100) || [];
    if (input.timeEstimateMinutes !== undefined) {
        if (typeof input.timeEstimateMinutes !== 'number' || !Number.isInteger(input.timeEstimateMinutes) || input.timeEstimateMinutes < 1 || input.timeEstimateMinutes > 1440)
            throw new Error('timeEstimateMinutes must be an integer from 1 to 1440');
        executionHints.time_estimate_minutes = input.timeEstimateMinutes;
    }
    for (const field of ['energy', 'effort']) {
        if (input[field] === undefined)
            continue;
        const value = String(input[field]).trim().toLowerCase();
        if (!['low', 'medium', 'high'].includes(value))
            throw new Error(`${field} must be low, medium, or high`);
        executionHints[field] = value;
    }
    const existingKind = normalizeNoteKind(existing.note_kind);
    const existingLifecycle = normalizeLifecycle(existing.lifecycle);
    const kind = normalizeNoteKind(input.noteKind, existingKind || 'knowledge') || 'knowledge';
    const lifecycle = normalizeLifecycle(input.lifecycle, existingLifecycle || lifecycleForKnowledgeStatus(input.status)) || lifecycleForKnowledgeStatus(input.status);
    const primaryMoc = input.primaryMoc === undefined ? optionalText(existing.primary_moc, 'primaryMoc', 500) : optionalText(input.primaryMoc, 'primaryMoc', 500);
    const mocs = input.mocs === undefined ? normalizedList(existing.mocs, 'mocs', 12, 500) : normalizedList(input.mocs, 'mocs', 12, 500);
    const moc = input.moc === undefined ? optionalText(existing.moc, 'moc', 500) : optionalText(input.moc, 'moc', 500);
    const navOrder = input.navOrder === undefined ? normalizeNavOrder(existing.nav_order) : normalizeNavOrder(input.navOrder);
    const project = input.project === undefined ? optionalText(existing.project, 'project', 500) : optionalText(input.project, 'project', 500);
    const reviewAt = input.reviewAt === undefined ? normalizeReviewAt(existing.review_at) : normalizeReviewAt(input.reviewAt);
    const reviewIntervalDays = input.reviewIntervalDays === undefined ? normalizeReviewIntervalDays(existing.review_interval_days) : normalizeReviewIntervalDays(input.reviewIntervalDays);
    const reviewSnoozedUntil = input.reviewSnoozedUntil === undefined ? normalizeIsoDate(existing.review_snoozed_until, 'reviewSnoozedUntil') : normalizeIsoDate(input.reviewSnoozedUntil, 'reviewSnoozedUntil');
    const reviewSnoozeReason = input.reviewSnoozeReason === undefined ? optionalText(existing.review_snooze_reason, 'reviewSnoozeReason', 500) : optionalText(input.reviewSnoozeReason, 'reviewSnoozeReason', 500);
    const recallPrompt = input.recallPrompt === undefined ? optionalText(existing.recall_prompt, 'recallPrompt', 1000) : optionalText(input.recallPrompt, 'recallPrompt', 1000);
    const recallIntervalDays = input.recallIntervalDays === undefined ? normalizeReviewIntervalDays(existing.recall_interval_days) : normalizeReviewIntervalDays(input.recallIntervalDays);
    const lastRecalledAt = input.lastRecalledAt === undefined ? normalizeIsoDate(existing.last_recalled_at, 'lastRecalledAt') : normalizeIsoDate(input.lastRecalledAt, 'lastRecalledAt');
    const recallQuality = input.recallQuality === undefined ? (existing.recall_quality === undefined ? undefined : normalizeRecallQuality(existing.recall_quality)) : normalizeRecallQuality(input.recallQuality);
    const retentionPolicy = input.retentionPolicy === undefined ? normalizeRetentionPolicy(existing.retention_policy) : normalizeRetentionPolicy(input.retentionPolicy);
    const retentionEvent = input.retentionEvent === undefined ? normalizeRetentionEvent(existing.retention_event) : normalizeRetentionEvent(input.retentionEvent);
    const retentionAt = input.retentionAt === undefined ? normalizeIsoDate(existing.retention_at, 'retentionAt') : normalizeIsoDate(input.retentionAt, 'retentionAt');
    const preserveUntil = input.preserveUntil === undefined ? normalizeIsoDate(existing.preserve_until, 'preserveUntil') : normalizeIsoDate(input.preserveUntil, 'preserveUntil');
    const legalHold = input.legalHold === undefined ? normalizeBoolean(existing.legal_hold, 'legalHold') : normalizeBoolean(input.legalHold, 'legalHold');
    const retentionReason = input.retentionReason === undefined ? optionalText(existing.retention_reason, 'retentionReason', 1000) : optionalText(input.retentionReason, 'retentionReason', 1000);
    const replacedBy = input.replacedBy === undefined ? optionalText(existing.replaced_by, 'replacedBy', 500) : optionalText(input.replacedBy, 'replacedBy', 500);
    const aliases = input.aliases === undefined ? normalizedList(existing.aliases, 'aliases', 30, 200) : normalizedList(input.aliases, 'aliases', 30, 200);
    const summary = input.summary === undefined ? optionalText(existing.summary, 'summary', 2000) : optionalText(input.summary, 'summary', 2000);
    const keyPoints = input.keyPoints === undefined ? normalizedList(existing.key_points, 'key_points', 20, 600) : normalizedList(input.keyPoints, 'key_points', 20, 600);
    const openQuestions = input.openQuestions === undefined ? normalizedList(existing.open_questions, 'open_questions', 20, 600) : normalizedList(input.openQuestions, 'open_questions', 20, 600);
    const summaryLayer = input.summaryLayer === undefined
        ? (existing.summary_layer === undefined ? undefined : Number(existing.summary_layer))
        : Number(input.summaryLayer);
    if (summaryLayer !== undefined && (!Number.isInteger(summaryLayer) || summaryLayer < 0 || summaryLayer > 4))
        throw new Error('summaryLayer must be an integer from 0 to 4');
    const summaryHighlights = input.summaryHighlights === undefined ? normalizedHighlights(existing.summary_highlights, 'summaryHighlights') : normalizedHighlights(input.summaryHighlights, 'summaryHighlights');
    const nextActions = input.nextActions === undefined ? normalizedList(existing.next_actions, 'next_actions', 20, 600) : normalizedList(input.nextActions, 'next_actions', 20, 600);
    const nextAction = input.nextAction === undefined ? optionalText(existing.next_action, 'nextAction', 500) : optionalText(input.nextAction, 'nextAction', 500);
    const waitingFor = input.waitingFor === undefined ? optionalText(existing.waiting_for, 'waiting_for', 500) : optionalText(input.waitingFor, 'waiting_for', 500);
    const desiredOutcome = input.desiredOutcome === undefined ? optionalText(existing.desired_outcome, 'desiredOutcome', 1000) : optionalText(input.desiredOutcome, 'desiredOutcome', 1000);
    const projectPurpose = input.projectPurpose === undefined ? optionalText(existing.project_purpose, 'projectPurpose', 1000) : optionalText(input.projectPurpose, 'projectPurpose', 1000);
    const projectSupport = input.projectSupport === undefined ? normalizedList(existing.project_support, 'projectSupport', 30, 500) : normalizedList(input.projectSupport, 'projectSupport', 30, 500);
    const taskContext = input.taskContext === undefined ? optionalText(existing.task_context, 'taskContext', 300) : optionalText(input.taskContext, 'taskContext', 300);
    const dueAt = input.dueAt === undefined ? normalizeIsoDate(existing.due_at, 'dueAt') : normalizeIsoDate(input.dueAt, 'dueAt');
    const scheduledAt = input.scheduledAt === undefined ? normalizeIsoDate(existing.scheduled_at, 'scheduledAt') : normalizeIsoDate(input.scheduledAt, 'scheduledAt');
    const deferUntil = input.deferUntil === undefined ? normalizeIsoDate(existing.defer_until, 'deferUntil') : normalizeIsoDate(input.deferUntil, 'deferUntil');
    const serviceClass = input.serviceClass === undefined ? normalizeServiceClass(existing.service_class) : normalizeServiceClass(input.serviceClass);
    const completionCriteria = input.completionCriteria === undefined ? normalizedList(existing.completion_criteria, 'completionCriteria', 12, 500) : normalizedList(input.completionCriteria, 'completionCriteria', 12, 500);
    const startedAt = input.startedAt === undefined ? normalizeIsoDate(existing.started_at, 'startedAt') : normalizeIsoDate(input.startedAt, 'startedAt');
    const blockedSince = input.blockedSince === undefined ? normalizeIsoDate(existing.blocked_since, 'blockedSince') : normalizeIsoDate(input.blockedSince, 'blockedSince');
    const waitingSince = input.waitingSince === undefined ? normalizeIsoDate(existing.waiting_since, 'waitingSince') : normalizeIsoDate(input.waitingSince, 'waitingSince');
    const completedAt = input.completedAt === undefined ? normalizeIsoDate(existing.completed_at, 'completedAt') : normalizeIsoDate(input.completedAt, 'completedAt');
    const stableId = input.stableId === undefined ? optionalText(existing.stable_id, 'stable_id', 80) : optionalText(input.stableId, 'stable_id', 80);
    if (stableId && !/^[a-z0-9][a-z0-9._-]*$/i.test(stableId))
        throw new Error('stableId may contain only letters, numbers, dots, underscores, and hyphens');
    const canonicalPath = input.canonicalPath === undefined ? optionalText(existing.canonical_path, 'canonicalPath', 500) : optionalText(input.canonicalPath, 'canonicalPath', 500);
    if (canonicalPath && (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(canonicalPath) || canonicalPath.split(/[\\/]/).includes('..')))
        throw new Error('canonicalPath must be a scope-safe vault-relative path');
    const termStatus = input.termStatus === undefined ? normalizeTermStatus(existing.term_status) : normalizeTermStatus(input.termStatus);
    const termReplacedBy = input.termReplacedBy === undefined ? optionalText(existing.term_replaced_by, 'termReplacedBy', 500) : optionalText(input.termReplacedBy, 'termReplacedBy', 500);
    const termScopeNote = input.termScopeNote === undefined ? optionalText(existing.term_scope_note, 'termScopeNote', 1000) : optionalText(input.termScopeNote, 'termScopeNote', 1000);
    const preferredTerm = input.preferredTerm === undefined ? optionalText(existing.preferred_term, 'preferredTerm', 300) : optionalText(input.preferredTerm, 'preferredTerm', 300);
    const termLanguage = input.termLanguage === undefined ? optionalText(existing.term_language, 'termLanguage', 40) : optionalText(input.termLanguage, 'termLanguage', 40);
    const authorityScheme = input.authorityScheme === undefined ? optionalText(existing.authority_scheme, 'authorityScheme', 120) : optionalText(input.authorityScheme, 'authorityScheme', 120);
    const authorityId = input.authorityId === undefined ? optionalText(existing.authority_id, 'authorityId', 200) : optionalText(input.authorityId, 'authorityId', 200);
    const disambiguation = input.disambiguation === undefined ? optionalText(existing.disambiguation, 'disambiguation', 300) : optionalText(input.disambiguation, 'disambiguation', 300);
    const broaderTerms = input.broaderTerms === undefined ? normalizedList(existing.broader_terms, 'broaderTerms', 20, 500) : normalizedList(input.broaderTerms, 'broaderTerms', 20, 500);
    const relatedTerms = input.relatedTerms === undefined ? normalizedList(existing.related_terms, 'relatedTerms', 20, 500) : normalizedList(input.relatedTerms, 'relatedTerms', 20, 500);
    const subjectTerms = input.subjectTerms === undefined ? normalizedList(existing.subject_terms, 'subjectTerms', 20, 200) : normalizedList(input.subjectTerms, 'subjectTerms', 20, 200);
    const domain = input.domain === undefined ? optionalText(existing.domain, 'domain', 200) : optionalText(input.domain, 'domain', 200);
    const methods = input.methods === undefined ? normalizedList(existing.methods, 'methods', 20, 200) : normalizedList(input.methods, 'methods', 20, 200);
    const audience = input.audience === undefined ? normalizedList(existing.audience, 'audience', 12, 200) : normalizedList(input.audience, 'audience', 12, 200);
    const retrievalCues = input.retrievalCues === undefined ? normalizedList(existing.retrieval_cues, 'retrievalCues', 8, 300) : normalizedList(input.retrievalCues, 'retrievalCues', 8, 300);
    const useWhen = input.useWhen === undefined ? optionalText(existing.use_when, 'useWhen', 1000) : optionalText(input.useWhen, 'useWhen', 1000);
    const validFrom = input.validFrom === undefined ? normalizeIsoDate(existing.valid_from, 'validFrom') : normalizeIsoDate(input.validFrom, 'validFrom');
    const validUntil = input.validUntil === undefined ? normalizeIsoDate(existing.valid_until, 'validUntil') : normalizeIsoDate(input.validUntil, 'validUntil');
    const observedAt = input.observedAt === undefined ? normalizeIsoDate(existing.observed_at, 'observedAt') : normalizeIsoDate(input.observedAt, 'observedAt');
    const temporalScope = input.temporalScope === undefined ? optionalText(existing.temporal_scope, 'temporalScope', 1000) : optionalText(input.temporalScope, 'temporalScope', 1000);
    if (validFrom && validUntil && Date.parse(validUntil) <= Date.parse(validFrom))
        throw new Error('validUntil must be later than validFrom; validFrom is inclusive and validUntil is exclusive');
    const knowledgeRole = input.knowledgeRole === undefined ? normalizeKnowledgeRole(existing.knowledge_role) : normalizeKnowledgeRole(input.knowledgeRole);
    const seeAlso = input.seeAlso === undefined ? normalizedList(existing.see_also, 'seeAlso', 20, 500) : normalizedList(input.seeAlso, 'seeAlso', 20, 500);
    const relationsInput = input.relations === undefined
        ? Object.fromEntries(RELATION_FIELDS.map(field => [field, existing[field]]).filter(([, value]) => value !== undefined))
        : input.relations;
    const relations = normalizedRelationMap(relationsInput);
    const relationNotes = input.relationNotes === undefined ? normalizedRelationNotes(existing.relation_notes) : normalizedRelationNotes(input.relationNotes);
    const relationEvidence = input.relationEvidence === undefined ? normalizedRelationEvidence(existing.relation_evidence) : normalizedRelationEvidence(input.relationEvidence);
    const taskStatus = input.taskStatus === undefined
        ? normalizeTaskStatus(existing.task_status)
        : normalizeTaskStatus(input.taskStatus);
    const reviewPolicy = input.reviewPolicy === undefined
        ? normalizeReviewPolicy(existing.review_policy)
        : normalizeReviewPolicy(input.reviewPolicy);
    const reviewOutcome = input.reviewOutcome === undefined ? normalizeReviewOutcome(existing.last_review_outcome) : normalizeReviewOutcome(input.reviewOutcome);
    const reviewedBy = input.reviewedBy === undefined ? optionalText(existing.last_reviewed_by, 'reviewedBy', 200) : optionalText(input.reviewedBy, 'reviewedBy', 200);
    const reviewedAt = input.reviewedAt === undefined ? normalizeIsoDate(existing.last_reviewed_at, 'reviewedAt') : normalizeIsoDate(input.reviewedAt, 'reviewedAt');
    const reviewNote = input.reviewNote === undefined ? optionalText(existing.review_note, 'reviewNote', 1000) : optionalText(input.reviewNote, 'reviewNote', 1000);
    const reviewChecks = input.reviewChecks === undefined ? normalizeReviewChecks(existing.review_checks) : normalizeReviewChecks(input.reviewChecks);
    const reviewOpenItems = input.reviewOpenItems === undefined ? normalizedList(existing.review_open_items, 'reviewOpenItems', 8, 500) : normalizedList(input.reviewOpenItems, 'reviewOpenItems', 8, 500);
    const interpretationStatus = input.interpretationStatus === undefined
        ? normalizeInterpretationStatus(existing.interpretation_status)
        : normalizeInterpretationStatus(input.interpretationStatus);
    const epistemicStatus = normalizeEpistemicStatus(input.epistemicStatus, kind, existing.epistemic_status);
    const polarity = input.polarity === undefined
        ? normalizeKnowledgePolarity(existing.knowledge_polarity)
        : normalizeKnowledgePolarity(input.polarity);
    const negativeType = input.negativeType === undefined
        ? normalizeNegativeKind(existing.negative_type)
        : normalizeNegativeKind(input.negativeType);
    const attempted = input.attempted === undefined ? optionalText(existing.negative_attempted, 'attempted', 1200) : optionalText(input.attempted, 'attempted', 1200);
    const observed = input.observed === undefined ? optionalText(existing.negative_observed, 'observed', 1200) : optionalText(input.observed, 'observed', 1200);
    const failureCondition = input.failureCondition === undefined ? optionalText(existing.negative_failure_condition, 'failureCondition', 1200) : optionalText(input.failureCondition, 'failureCondition', 1200);
    const affectedScope = input.affectedScope === undefined ? optionalText(existing.negative_affected_scope, 'affectedScope', 500) : optionalText(input.affectedScope, 'affectedScope', 500);
    const reproduction = input.reproduction === undefined ? optionalText(existing.negative_reproduction, 'reproduction', 1200) : optionalText(input.reproduction, 'reproduction', 1200);
    const whyRejected = input.whyRejected === undefined ? optionalText(existing.negative_why_rejected, 'whyRejected', 1200) : optionalText(input.whyRejected, 'whyRejected', 1200);
    const reusableLesson = input.reusableLesson === undefined ? optionalText(existing.negative_reusable_lesson, 'reusableLesson', 1200) : optionalText(input.reusableLesson, 'reusableLesson', 1200);
    const replacementPath = input.replacementPath === undefined ? optionalText(existing.negative_replacement_path, 'replacementPath', 500) : optionalText(input.replacementPath, 'replacementPath', 500);
    const clarifyDisposition = input.clarifyDisposition === undefined ? normalizeClarifyDisposition(existing.triage_disposition) : normalizeClarifyDisposition(input.clarifyDisposition);
    const clarifiedBy = input.clarifiedBy === undefined ? optionalText(existing.clarified_by, 'clarifiedBy', 200) : optionalText(input.clarifiedBy, 'clarifiedBy', 200);
    const clarifiedAt = input.clarifiedAt === undefined ? normalizeIsoDate(existing.clarified_at, 'clarifiedAt') : normalizeIsoDate(input.clarifiedAt, 'clarifiedAt');
    const clarifyNote = input.clarifyNote === undefined ? optionalText(existing.clarify_note, 'clarifyNote', 1000) : optionalText(input.clarifyNote, 'clarifyNote', 1000);
    const triageTarget = input.triageTarget === undefined ? optionalText(existing.triage_target, 'triageTarget', 500) : optionalText(input.triageTarget, 'triageTarget', 500);
    const mocPurpose = input.mocPurpose === undefined ? optionalText(existing.moc_purpose, 'mocPurpose', 1000) : optionalText(input.mocPurpose, 'mocPurpose', 1000);
    const mocScope = input.mocScope === undefined ? optionalText(existing.moc_scope, 'mocScope', 500) : optionalText(input.mocScope, 'mocScope', 500);
    const mocQuestions = input.mocQuestions === undefined ? normalizedList(existing.moc_questions, 'mocQuestions', 12, 500) : normalizedList(input.mocQuestions, 'mocQuestions', 12, 500);
    const mocParent = input.mocParent === undefined ? optionalText(existing.moc_parent, 'mocParent', 500) : optionalText(input.mocParent, 'mocParent', 500);
    const focusHorizon = input.focusHorizon === undefined ? normalizeFocusHorizon(existing.focus_horizon) : normalizeFocusHorizon(input.focusHorizon);
    const focusParent = input.focusParent === undefined ? optionalText(existing.focus_parent, 'focusParent', 500) : optionalText(input.focusParent, 'focusParent', 500);
    const focusSupports = input.focusSupports === undefined ? normalizedList(existing.focus_supports, 'focusSupports', 20, 500) : normalizedList(input.focusSupports, 'focusSupports', 20, 500);
    if (negativeType && polarity !== 'negative')
        throw new Error('negativeType requires polarity=negative');
    if (polarity === 'negative' && !negativeType)
        throw new Error('polarity=negative requires negativeType');
    const summaryFieldsPresent = Boolean(summary || keyPoints?.length || openQuestions?.length || summaryLayer !== undefined || summaryHighlights?.length);
    // Filing/review edits must never certify an inherited stale summary.
    const projectionRewritten = [input.summary, input.keyPoints, input.openQuestions, input.summaryHighlights].some(value => value !== undefined);
    const inheritedProjectionChecked = existing.summary_of_content_sha256 === input.contentDigest
        || ['summary', 'key_points', 'open_questions', 'summary_highlights'].every((field, index) => {
            const value = existing[field];
            const present = Array.isArray(value) ? value.length > 0 : typeof value === 'string' && Boolean(value.trim());
            return !present || [input.summary, input.keyPoints, input.openQuestions, input.summaryHighlights][index] !== undefined;
        });
    const summaryDigest = summaryFieldsPresent && projectionRewritten && inheritedProjectionChecked && input.contentDigest !== undefined
        ? optionalText(input.contentDigest, 'summary_of_content_sha256', 128)
        : optionalText(existing.summary_of_content_sha256, 'summary_of_content_sha256', 128);
    return {
        note_kind: kind,
        lifecycle,
        ...executionHints,
        ...(primaryMoc && { primary_moc: primaryMoc }),
        ...(mocs && { mocs }),
        ...(moc && { moc }),
        ...(navOrder !== undefined && { nav_order: navOrder }),
        ...(project && { project }),
        ...(reviewAt && { review_at: reviewAt }),
        ...(reviewIntervalDays !== undefined && { review_interval_days: reviewIntervalDays }),
        ...(reviewSnoozedUntil && { review_snoozed_until: reviewSnoozedUntil }),
        ...(reviewSnoozeReason && { review_snooze_reason: reviewSnoozeReason }),
        ...(recallPrompt && { recall_prompt: recallPrompt }),
        ...(recallIntervalDays !== undefined && { recall_interval_days: recallIntervalDays }),
        ...(lastRecalledAt && { last_recalled_at: lastRecalledAt }),
        ...(recallQuality && { recall_quality: recallQuality }),
        ...(retentionPolicy && { retention_policy: retentionPolicy }),
        ...(retentionEvent && { retention_event: retentionEvent }),
        ...(retentionAt && { retention_at: retentionAt }),
        ...(preserveUntil && { preserve_until: preserveUntil }),
        ...(legalHold !== undefined && { legal_hold: legalHold }),
        ...(retentionReason && { retention_reason: retentionReason }),
        ...(replacedBy && { replaced_by: replacedBy }),
        ...(aliases && { aliases }),
        ...(summary && { summary }),
        ...(keyPoints && { key_points: keyPoints }),
        ...(openQuestions && { open_questions: openQuestions }),
        ...(summaryLayer !== undefined && { summary_layer: summaryLayer }),
        ...(summaryHighlights && { summary_highlights: summaryHighlights }),
        ...(nextActions && { next_actions: nextActions }),
        ...(nextAction && { next_action: nextAction }),
        ...(waitingFor && { waiting_for: waitingFor }),
        ...(desiredOutcome && { desired_outcome: desiredOutcome }),
        ...(projectPurpose && { project_purpose: projectPurpose }),
        ...(projectSupport && { project_support: projectSupport }),
        ...(taskContext && { task_context: taskContext }),
        ...(dueAt && { due_at: dueAt }),
        ...(scheduledAt && { scheduled_at: scheduledAt }),
        ...(deferUntil && { defer_until: deferUntil }),
        ...(serviceClass && { service_class: serviceClass }),
        ...(completionCriteria && { completion_criteria: completionCriteria }),
        ...(startedAt && { started_at: startedAt }),
        ...(blockedSince && { blocked_since: blockedSince }),
        ...(waitingSince && { waiting_since: waitingSince }),
        ...(completedAt && { completed_at: completedAt }),
        ...(stableId && { stable_id: stableId }),
        ...(canonicalPath && { canonical_path: canonicalPath }),
        ...(termStatus !== 'preferred' && { term_status: termStatus }),
        ...(termReplacedBy && { term_replaced_by: termReplacedBy }),
        ...(termScopeNote && { term_scope_note: termScopeNote }),
        ...(preferredTerm && { preferred_term: preferredTerm }),
        ...(termLanguage && { term_language: termLanguage }),
        ...(authorityScheme && { authority_scheme: authorityScheme }),
        ...(authorityId && { authority_id: authorityId }),
        ...(disambiguation && { disambiguation }),
        ...(broaderTerms && { broader_terms: broaderTerms }),
        ...(relatedTerms && { related_terms: relatedTerms }),
        ...(subjectTerms && { subject_terms: subjectTerms }),
        ...(domain && { domain }),
        ...(methods && { methods }),
        ...(audience && { audience }),
        ...(retrievalCues && { retrieval_cues: retrievalCues }),
        ...(useWhen && { use_when: useWhen }),
        ...(validFrom && { valid_from: validFrom }),
        ...(validUntil && { valid_until: validUntil }),
        ...(observedAt && { observed_at: observedAt }),
        ...(temporalScope && { temporal_scope: temporalScope }),
        ...(knowledgeRole && { knowledge_role: knowledgeRole }),
        ...(seeAlso && { see_also: seeAlso }),
        ...(taskStatus && { task_status: taskStatus }),
        ...(reviewPolicy && { review_policy: reviewPolicy }),
        ...(reviewOutcome && { last_review_outcome: reviewOutcome }),
        ...(reviewedBy && { last_reviewed_by: reviewedBy }),
        ...(reviewedAt && { last_reviewed_at: reviewedAt }),
        ...(reviewNote && { review_note: reviewNote }),
        ...(reviewChecks && { review_checks: reviewChecks }),
        ...(reviewOpenItems && { review_open_items: reviewOpenItems }),
        ...(interpretationStatus && { interpretation_status: interpretationStatus }),
        ...(epistemicStatus && { epistemic_status: epistemicStatus }),
        ...(polarity && { knowledge_polarity: polarity }),
        ...(negativeType && { negative_type: negativeType }),
        ...(attempted && { negative_attempted: attempted }),
        ...(observed && { negative_observed: observed }),
        ...(failureCondition && { negative_failure_condition: failureCondition }),
        ...(affectedScope && { negative_affected_scope: affectedScope }),
        ...(reproduction && { negative_reproduction: reproduction }),
        ...(whyRejected && { negative_why_rejected: whyRejected }),
        ...(reusableLesson && { negative_reusable_lesson: reusableLesson }),
        ...(replacementPath && { negative_replacement_path: replacementPath }),
        ...(clarifyDisposition && { triage_disposition: clarifyDisposition }),
        ...(clarifiedBy && { clarified_by: clarifiedBy }),
        ...(clarifiedAt && { clarified_at: clarifiedAt }),
        ...(clarifyNote && { clarify_note: clarifyNote }),
        ...(triageTarget && { triage_target: triageTarget }),
        ...(mocPurpose && { moc_purpose: mocPurpose }),
        ...(mocScope && { moc_scope: mocScope }),
        ...(mocQuestions && { moc_questions: mocQuestions }),
        ...(mocParent && { moc_parent: mocParent }),
        ...(focusHorizon && { focus_horizon: focusHorizon }),
        ...(focusParent && { focus_parent: focusParent }),
        ...(focusSupports && { focus_supports: focusSupports }),
        ...(summaryDigest && { summary_of_content_sha256: summaryDigest }),
        ...(relations || {}),
        ...(relationNotes && { relation_notes: relationNotes }),
        ...(relationEvidence && { relation_evidence: relationEvidence }),
    };
}
export function organizationLintIssues(path, frontmatter, content, nowMs = Date.now()) {
    const issues = [];
    const type = String(frontmatter.llm_wiki_type || '').trim().toLowerCase();
    const kindValue = frontmatter.note_kind;
    const lifecycleValue = frontmatter.lifecycle;
    const kind = kindValue === undefined ? undefined : String(kindValue).trim().toLowerCase();
    const lifecycle = lifecycleValue === undefined ? undefined : String(lifecycleValue).trim().toLowerCase();
    if (type === 'knowledge' && ['atomic', 'knowledge', 'decision'].includes(kind || '')) {
        const title = String(frontmatter.title || path.split(/[\\/]/).at(-1) || '').replace(/\.(?:md|markdown|txt)$/i, '').trim();
        if (GENERIC_NOTE_TITLE.test(title)) {
            issues.push({ code: 'generic_concept_title', detail: 'Durable knowledge should use a concept-oriented title that states the idea, not a generic name such as Note or Draft.' });
        }
    }
    const shape = (value) => {
        if (Array.isArray(value))
            return 'list';
        if (value !== null && typeof value === 'object')
            return 'object';
        if (typeof value === 'number')
            return 'number';
        return 'text';
    };
    for (const contract of ORGANIZATION_PROPERTY_CONTRACT) {
        if (frontmatter[contract.name] === undefined)
            continue;
        const actual = shape(frontmatter[contract.name]);
        if (actual !== contract.type) {
            issues.push({ code: 'property_contract_violation', detail: `${contract.name} must be a ${contract.type} property for the MCPVault organization contract; found ${actual}.` });
            continue;
        }
        if (contract.allowed && actual === 'text' && !contract.allowed.includes(String(frontmatter[contract.name]).trim().toLowerCase())) {
            issues.push({ code: 'property_contract_violation', detail: `${contract.name} must be one of: ${contract.allowed.join(', ')}.` });
        }
    }
    if (frontmatter.review_interval_days !== undefined) {
        try {
            normalizeReviewIntervalDays(frontmatter.review_interval_days);
        }
        catch (error) {
            issues.push({ code: 'invalid_review_interval_days', detail: error instanceof Error ? error.message : 'review_interval_days must be an integer from 1 to 3650.' });
        }
    }
    if (frontmatter.recall_interval_days !== undefined) {
        try {
            normalizeReviewIntervalDays(frontmatter.recall_interval_days);
        }
        catch (error) {
            issues.push({ code: 'invalid_recall_interval_days', detail: error instanceof Error ? error.message : 'recall_interval_days must be an integer from 1 to 3650.' });
        }
    }
    if (kindValue !== undefined && !noteKindSet.has(kind || '')) {
        issues.push({ code: 'invalid_note_kind', detail: `note_kind must be one of: ${NOTE_KINDS.join(', ')}` });
    }
    if (lifecycleValue !== undefined && !lifecycleSet.has(lifecycle || '')) {
        issues.push({ code: 'invalid_lifecycle', detail: `lifecycle must be one of: ${LIFECYCLES.join(', ')}` });
    }
    if (frontmatter.triage_disposition !== undefined && !clarifyDispositionSet.has(String(frontmatter.triage_disposition).trim().toLowerCase())) {
        issues.push({ code: 'invalid_triage_disposition', detail: `triage_disposition must be one of: ${CLARIFY_DISPOSITIONS.join(', ')}` });
    }
    for (const [field, label] of [['clarified_at', 'clarifiedAt']]) {
        if (frontmatter[field] !== undefined) {
            try {
                normalizeIsoDate(frontmatter[field], label);
            }
            catch (error) {
                issues.push({ code: `invalid_${field}`, detail: error instanceof Error ? error.message : `${field} must be an ISO date or date-time` });
            }
        }
    }
    for (const [field, label, maxItems] of [['moc_questions', 'mocQuestions', 12]]) {
        if (frontmatter[field] !== undefined) {
            try {
                normalizedList(frontmatter[field], label, maxItems, 500);
            }
            catch (error) {
                issues.push({ code: `invalid_${field}`, detail: error instanceof Error ? error.message : `${field} must be a string array` });
            }
        }
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
    for (const field of OBSIDIAN_COMPLEX_PROPERTY_FIELDS) {
        const value = frontmatter[field];
        const nested = value !== null && typeof value === 'object'
            && (!Array.isArray(value) || value.some(item => item !== null && typeof item === 'object'));
        if (nested) {
            issues.push({
                code: 'obsidian_complex_property',
                detail: `${field} contains nested objects. Obsidian Properties can display it, but maintain this MCP-managed metadata in Source mode and keep human-readable context in the Markdown body.`,
            });
        }
    }
    if (frontmatter.summary !== undefined && (typeof frontmatter.summary !== 'string' || Array.from(frontmatter.summary).length > 2000)) {
        issues.push({ code: 'invalid_summary', detail: 'summary must be a text property of 2000 Unicode characters or fewer.' });
    }
    if (frontmatter.stable_id !== undefined && (typeof frontmatter.stable_id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(frontmatter.stable_id))) {
        issues.push({ code: 'invalid_stable_id', detail: 'stable_id must contain only letters, numbers, dots, underscores, and hyphens.' });
    }
    if (frontmatter.nav_order !== undefined) {
        try {
            normalizeNavOrder(frontmatter.nav_order);
        }
        catch (error) {
            issues.push({ code: 'invalid_nav_order', detail: error instanceof Error ? error.message : 'nav_order must be an integer from 0 to 1000000.' });
        }
    }
    if (frontmatter.canonical_path !== undefined) {
        const canonicalPath = String(frontmatter.canonical_path).trim();
        if (!canonicalPath || canonicalPath.length > 500 || /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(canonicalPath) || canonicalPath.split(/[\\/]/).includes('..')) {
            issues.push({ code: 'invalid_canonical_path', detail: 'canonical_path must be a non-empty, scope-safe vault-relative path of 500 characters or fewer.' });
        }
        else if (canonicalPath.replace(/\\/g, '/').toLowerCase() === path.replace(/\\/g, '/').toLowerCase()) {
            issues.push({ code: 'canonical_path_self_reference', detail: 'canonical_path points to the note itself; omit it or point to the actual canonical note.' });
        }
    }
    if (frontmatter.term_status !== undefined && !termStatusSet.has(String(frontmatter.term_status).trim().toLowerCase())) {
        issues.push({ code: 'invalid_term_status', detail: `term_status must be one of: ${TERM_STATUSES.join(', ')}` });
    }
    if (frontmatter.knowledge_role !== undefined && !knowledgeRoleSet.has(String(frontmatter.knowledge_role).trim().toLowerCase())) {
        issues.push({ code: 'invalid_knowledge_role', detail: `knowledge_role must be one of: ${KNOWLEDGE_ROLES.join(', ')}` });
    }
    if (frontmatter.term_scope_note !== undefined && (typeof frontmatter.term_scope_note !== 'string' || !String(frontmatter.term_scope_note).trim() || Array.from(String(frontmatter.term_scope_note)).length > 1000)) {
        issues.push({ code: 'invalid_term_scope_note', detail: 'term_scope_note must be non-empty text of 1000 Unicode characters or fewer.' });
    }
    for (const [field, maximum] of [['preferred_term', 300], ['disambiguation', 300]]) {
        if (frontmatter[field] !== undefined && (typeof frontmatter[field] !== 'string' || !String(frontmatter[field]).trim() || Array.from(String(frontmatter[field])).length > maximum)) {
            issues.push({ code: `invalid_${field}`, detail: `${field} must be non-empty text of ${maximum} Unicode characters or fewer.` });
        }
    }
    if (frontmatter.review_checks !== undefined) {
        try {
            normalizeReviewChecks(frontmatter.review_checks);
        }
        catch (error) {
            issues.push({ code: 'invalid_review_checks', detail: error instanceof Error ? error.message : 'review_checks must contain known bounded checklist values.' });
        }
    }
    if (frontmatter.review_open_items !== undefined) {
        try {
            normalizedList(frontmatter.review_open_items, 'reviewOpenItems', 8, 500);
        }
        catch (error) {
            issues.push({ code: 'invalid_review_open_items', detail: error instanceof Error ? error.message : 'review_open_items must be a bounded string array.' });
        }
    }
    for (const [field, normalizer] of [['relation_notes', normalizedRelationNotes], ['relation_evidence', normalizedRelationEvidence]]) {
        if (frontmatter[field] === undefined)
            continue;
        try {
            normalizer(frontmatter[field]);
        }
        catch (error) {
            issues.push({ code: `invalid_${field}`, detail: error instanceof Error ? error.message : `${field} must be keyed by typed relation field.` });
        }
    }
    if (['deprecated', 'redirect'].includes(String(frontmatter.term_status || '').trim().toLowerCase()) && !String(frontmatter.term_replaced_by || '').trim()) {
        issues.push({ code: 'term_replacement_missing', detail: 'Deprecated or redirect terms should point to their preferred replacement with term_replaced_by.' });
    }
    for (const [field, label] of [['broader_terms', 'broaderTerms'], ['related_terms', 'relatedTerms']]) {
        if (frontmatter[field] !== undefined) {
            try {
                normalizedList(frontmatter[field], label, 20, 500);
            }
            catch (error) {
                issues.push({ code: `invalid_${field}`, detail: error instanceof Error ? error.message : `${field} must be a string array.` });
            }
        }
    }
    if (frontmatter.see_also !== undefined) {
        try {
            normalizedList(frontmatter.see_also, 'seeAlso', 20, 500);
        }
        catch (error) {
            issues.push({ code: 'invalid_see_also', detail: error instanceof Error ? error.message : 'see_also must be a bounded string array.' });
        }
    }
    for (const [field, label, maxItems, maxChars] of [['subject_terms', 'subjectTerms', 20, 200], ['methods', 'methods', 20, 200], ['audience', 'audience', 12, 200]]) {
        if (frontmatter[field] !== undefined) {
            try {
                normalizedList(frontmatter[field], label, maxItems, maxChars);
            }
            catch (error) {
                issues.push({ code: `invalid_${field}`, detail: error instanceof Error ? error.message : `${field} must be a bounded string array.` });
            }
        }
    }
    if (frontmatter.retrieval_cues !== undefined) {
        try {
            normalizedList(frontmatter.retrieval_cues, 'retrievalCues', 8, 300);
        }
        catch (error) {
            issues.push({ code: 'invalid_retrieval_cues', detail: error instanceof Error ? error.message : 'retrieval_cues must be a bounded string array.' });
        }
    }
    if (frontmatter.use_when !== undefined && (typeof frontmatter.use_when !== 'string' || Array.from(String(frontmatter.use_when)).length > 1000 || !String(frontmatter.use_when).trim())) {
        issues.push({ code: 'invalid_use_when', detail: 'use_when must be non-empty text of 1000 Unicode characters or fewer.' });
    }
    if (frontmatter.domain !== undefined && (typeof frontmatter.domain !== 'string' || Array.from(String(frontmatter.domain)).length > 200 || !String(frontmatter.domain).trim())) {
        issues.push({ code: 'invalid_domain', detail: 'domain must be non-empty text of 200 Unicode characters or fewer.' });
    }
    if (frontmatter.focus_horizon !== undefined && !focusHorizonSet.has(String(frontmatter.focus_horizon).trim().toLowerCase())) {
        issues.push({ code: 'invalid_focus_horizon', detail: `focus_horizon must be one of: ${FOCUS_HORIZONS.join(', ')}` });
    }
    if (frontmatter.focus_supports !== undefined) {
        try {
            normalizedList(frontmatter.focus_supports, 'focusSupports', 20, 500);
        }
        catch (error) {
            issues.push({ code: 'invalid_focus_supports', detail: error instanceof Error ? error.message : 'focus_supports must be a string array.' });
        }
    }
    if (frontmatter.summary_layer !== undefined) {
        const layer = Number(frontmatter.summary_layer);
        if (!Number.isInteger(layer) || layer < 0 || layer > 4)
            issues.push({ code: 'invalid_summary_layer', detail: 'summary_layer must be an integer from 0 to 4.' });
    }
    if (frontmatter.summary_highlights !== undefined) {
        try {
            const highlights = normalizedHighlights(frontmatter.summary_highlights, 'summaryHighlights') || [];
            const lines = content.split('\n');
            for (const highlight of highlights) {
                if (highlight.startLine === undefined || highlight.endLine === undefined)
                    continue;
                if (highlight.endLine > lines.length) {
                    issues.push({ code: 'summary_highlight_out_of_range', detail: 'A summary highlight line range exceeds the current note body.' });
                    continue;
                }
                if (highlight.quoteHash) {
                    const digest = createHash('sha256').update(lines.slice(highlight.startLine - 1, highlight.endLine).join('\n'), 'utf8').digest('hex');
                    if (digest !== highlight.quoteHash)
                        issues.push({ code: 'stale_summary_highlight', detail: 'A summary highlight quoteHash no longer matches its selected body lines.' });
                }
            }
        }
        catch (error) {
            issues.push({ code: 'invalid_summary_highlights', detail: error instanceof Error ? error.message : 'summary_highlights must be bounded highlight objects.' });
        }
    }
    if (frontmatter.task_status !== undefined && !taskStatusSet.has(String(frontmatter.task_status).trim().toLowerCase())) {
        issues.push({ code: 'invalid_task_status', detail: `task_status must be one of: ${TASK_STATUSES.join(', ')}` });
    }
    if (frontmatter.service_class !== undefined && !serviceClassSet.has(String(frontmatter.service_class).trim().toLowerCase())) {
        issues.push({ code: 'invalid_service_class', detail: `service_class must be one of: ${SERVICE_CLASSES.join(', ')}` });
    }
    if (frontmatter.completion_criteria !== undefined) {
        try {
            normalizedList(frontmatter.completion_criteria, 'completionCriteria', 12, 500);
        }
        catch (error) {
            issues.push({ code: 'invalid_completion_criteria', detail: error instanceof Error ? error.message : 'completion_criteria must be a bounded string array.' });
        }
    }
    if (frontmatter.review_policy !== undefined && !reviewPolicySet.has(String(frontmatter.review_policy).trim().toLowerCase())) {
        issues.push({ code: 'invalid_review_policy', detail: `review_policy must be one of: ${REVIEW_POLICIES.join(', ')}` });
    }
    if (frontmatter.last_review_outcome !== undefined && !reviewOutcomeSet.has(String(frontmatter.last_review_outcome).trim().toLowerCase())) {
        issues.push({ code: 'invalid_review_outcome', detail: `last_review_outcome must be one of: ${REVIEW_OUTCOMES.join(', ')}` });
    }
    if (frontmatter.interpretation_status !== undefined && !interpretationStatusSet.has(String(frontmatter.interpretation_status).trim().toLowerCase())) {
        issues.push({ code: 'invalid_interpretation_status', detail: `interpretation_status must be one of: ${INTERPRETATION_STATUSES.join(', ')}` });
    }
    for (const [field, label] of [['review_count', 'review_count'], ['review_reopen_count', 'review_reopen_count']]) {
        if (frontmatter[field] !== undefined && (!Number.isInteger(Number(frontmatter[field])) || Number(frontmatter[field]) < 0)) {
            issues.push({ code: `invalid_${field}`, detail: `${label} must be a non-negative integer.` });
        }
    }
    if (frontmatter.last_review_trigger !== undefined && (typeof frontmatter.last_review_trigger !== 'string' || Array.from(frontmatter.last_review_trigger).length > 120)) {
        issues.push({ code: 'invalid_last_review_trigger', detail: 'last_review_trigger must be text of 120 Unicode characters or fewer.' });
    }
    for (const [field, value] of [['due_at', frontmatter.due_at], ['scheduled_at', frontmatter.scheduled_at], ['defer_until', frontmatter.defer_until], ['started_at', frontmatter.started_at], ['blocked_since', frontmatter.blocked_since], ['waiting_since', frontmatter.waiting_since], ['completed_at', frontmatter.completed_at], ['last_reviewed_at', frontmatter.last_reviewed_at], ['review_snoozed_until', frontmatter.review_snoozed_until], ['valid_from', frontmatter.valid_from], ['valid_until', frontmatter.valid_until], ['observed_at', frontmatter.observed_at]]) {
        if (value !== undefined && (!/^(?:\d{4}-\d{2}-\d{2})(?:T[^\s]+)?$/.test(String(value).trim()) || Number.isNaN(Date.parse(String(value).trim())))) {
            issues.push({ code: `invalid_${field}`, detail: `${field} should be an ISO date or date-time.` });
        }
    }
    if (frontmatter.review_snooze_reason !== undefined && (typeof frontmatter.review_snooze_reason !== 'string' || Array.from(String(frontmatter.review_snooze_reason)).length > 500)) {
        issues.push({ code: 'invalid_review_snooze_reason', detail: 'review_snooze_reason must be text of 500 Unicode characters or fewer.' });
    }
    if (frontmatter.temporal_scope !== undefined && (typeof frontmatter.temporal_scope !== 'string' || !String(frontmatter.temporal_scope).trim() || Array.from(String(frontmatter.temporal_scope)).length > 1000)) {
        issues.push({ code: 'invalid_temporal_scope', detail: 'temporal_scope must be non-empty text of 1000 Unicode characters or fewer.' });
    }
    const temporal = temporalValidity(frontmatter, nowMs);
    if (temporal.state === 'invalid' && temporal.reason === 'invalid_validity_range') {
        issues.push({ code: 'invalid_temporal_validity_range', detail: 'valid_until must be later than valid_from; valid_from is inclusive and valid_until is exclusive.' });
    }
    if (type === 'knowledge' && temporal.state === 'expired' && !['archived', 'superseded'].includes(lifecycle || '')) {
        issues.push({ code: 'knowledge_validity_expired', detail: `The knowledge validity ended at ${temporal.validUntil}; review it before reuse. File modification and review dates do not extend claim validity.` });
    }
    if (frontmatter.last_recalled_at !== undefined && (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(String(frontmatter.last_recalled_at).trim()) || Number.isNaN(Date.parse(String(frontmatter.last_recalled_at).trim())))) {
        issues.push({ code: 'invalid_last_recalled_at', detail: 'last_recalled_at should be an ISO date or date-time.' });
    }
    if (frontmatter.recall_prompt !== undefined && (typeof frontmatter.recall_prompt !== 'string' || !frontmatter.recall_prompt.trim() || Array.from(String(frontmatter.recall_prompt)).length > 1000)) {
        issues.push({ code: 'invalid_recall_prompt', detail: 'recall_prompt must be non-empty text of 1000 Unicode characters or fewer.' });
    }
    if (frontmatter.recall_interval_days !== undefined && !frontmatter.recall_prompt) {
        issues.push({ code: 'recall_prompt_missing', detail: 'recall_interval_days is only useful when recall_prompt is present.' });
    }
    if (frontmatter.recall_quality !== undefined && !recallQualitySet.has(String(frontmatter.recall_quality).trim().toLowerCase())) {
        issues.push({ code: 'invalid_recall_quality', detail: `recall_quality must be one of: ${RECALL_QUALITIES.join(', ')}` });
    }
    if (frontmatter.retention_policy !== undefined && !retentionPolicySet.has(String(frontmatter.retention_policy).trim().toLowerCase())) {
        issues.push({ code: 'invalid_retention_policy', detail: `retention_policy must be one of: ${RETENTION_POLICIES.join(', ')}` });
    }
    if (frontmatter.retention_event !== undefined && !retentionEventSet.has(String(frontmatter.retention_event).trim().toLowerCase())) {
        issues.push({ code: 'invalid_retention_event', detail: `retention_event must be one of: ${RETENTION_EVENTS.join(', ')}` });
    }
    if (frontmatter.retention_at !== undefined && (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(String(frontmatter.retention_at).trim()) || Number.isNaN(Date.parse(String(frontmatter.retention_at).trim())))) {
        issues.push({ code: 'invalid_retention_at', detail: 'retention_at should be an ISO date or date-time.' });
    }
    if (frontmatter.preserve_until !== undefined && (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(String(frontmatter.preserve_until).trim()) || Number.isNaN(Date.parse(String(frontmatter.preserve_until).trim())))) {
        issues.push({ code: 'invalid_preserve_until', detail: 'preserve_until should be an ISO date or date-time.' });
    }
    if (frontmatter.legal_hold !== undefined) {
        try {
            normalizeBoolean(frontmatter.legal_hold, 'legalHold');
        }
        catch (error) {
            issues.push({ code: 'invalid_legal_hold', detail: error instanceof Error ? error.message : 'legal_hold must be a boolean.' });
        }
    }
    if (['archive', 'tombstone'].includes(String(frontmatter.retention_policy || '').trim().toLowerCase()) && (frontmatter.legal_hold === true || String(frontmatter.legal_hold).trim().toLowerCase() === 'true')) {
        issues.push({ code: 'legal_hold_blocks_disposition', detail: 'A legal hold is active; do not archive or tombstone this note until an authorized human releases the hold.' });
    }
    if (frontmatter.retention_reason !== undefined && (typeof frontmatter.retention_reason !== 'string' || !String(frontmatter.retention_reason).trim() || Array.from(String(frontmatter.retention_reason)).length > 1000)) {
        issues.push({ code: 'invalid_retention_reason', detail: 'retention_reason must be non-empty text of 1000 Unicode characters or fewer.' });
    }
    if (frontmatter.replaced_by !== undefined && (typeof frontmatter.replaced_by !== 'string' || !String(frontmatter.replaced_by).trim() || Array.from(String(frontmatter.replaced_by)).length > 500)) {
        issues.push({ code: 'invalid_replaced_by', detail: 'replaced_by must be non-empty text of 500 Unicode characters or fewer.' });
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
    const epistemicStatus = frontmatter.epistemic_status === undefined ? undefined : String(frontmatter.epistemic_status).trim().toLowerCase();
    if (kind === 'question' || kind === 'hypothesis' || kind === 'assumption') {
        if (epistemicStatus === undefined)
            issues.push({ code: 'epistemic_status_missing', detail: `${kind} notes should declare epistemic_status so their uncertainty state is visible.` });
        try {
            normalizeEpistemicStatus(epistemicStatus, kind, kind === 'question' ? 'open' : kind === 'hypothesis' ? 'proposed' : 'active');
        }
        catch (error) {
            issues.push({ code: 'invalid_epistemic_status', detail: error instanceof Error ? error.message : 'Invalid epistemic status.' });
        }
    }
    else if (epistemicStatus !== undefined) {
        issues.push({ code: 'epistemic_status_wrong_kind', detail: 'epistemic_status is only valid for question, hypothesis, or assumption notes.' });
    }
    if (polarity === 'negative') {
        if (!frontmatter.negative_reusable_lesson)
            issues.push({ code: 'negative_lesson_missing', detail: 'Negative knowledge should preserve a reusable lesson so future agents do not repeat the failed path.' });
        if (negativeType === 'failure' && !frontmatter.negative_reproduction)
            issues.push({ code: 'negative_reproduction_missing', detail: 'A failure note should record a bounded reproduction or observation recipe when possible.' });
    }
    const summaryPresent = typeof frontmatter.summary === 'string' || Array.isArray(frontmatter.key_points) || Array.isArray(frontmatter.open_questions) || frontmatter.summary_layer !== undefined || Array.isArray(frontmatter.summary_highlights);
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
    if (kind === 'project' && lifecycle === 'active' && !frontmatter.project_purpose && !frontmatter.desired_outcome) {
        issues.push({ code: 'active_project_without_outcome', detail: 'An active project should state its purpose or desired_outcome so planning and review can distinguish it from an area.' });
    }
    if (kind === 'project' && lifecycle === 'active' && (frontmatter.desired_outcome || frontmatter.project_purpose)) {
        const criteria = Array.isArray(frontmatter.completion_criteria) ? frontmatter.completion_criteria.filter((item) => typeof item === 'string' && item.trim()) : [];
        const hasCriteriaHeading = /(^|\n) {0,3}#{1,6}\s+(?:outcome|desired outcome|definition of done|completion criteria|완료 조건)\s*#*\s*(?:\n|$)/i.test(content);
        if (criteria.length === 0 && !hasCriteriaHeading)
            issues.push({ code: 'active_project_without_completion_criteria', detail: 'An active project should state bounded observable completion_criteria or a completion-criteria heading so agents know when to stop.' });
    }
    if (kind && ['project', 'task'].includes(kind)) {
        const taskStatus = String(frontmatter.task_status || '').trim().toLowerCase();
        const waiting = taskStatus === 'waiting' || Boolean(String(frontmatter.waiting_for || '').trim());
        if (taskStatus === 'next_action' && !frontmatter.started_at)
            issues.push({ code: 'active_work_without_started_at', detail: 'Executable work should record started_at when it enters the next_action lane; do not infer it from updated_at.' });
        if (taskStatus === 'blocked' && !frontmatter.blocked_since)
            issues.push({ code: 'blocked_work_without_blocked_since', detail: 'Blocked work should record blocked_since so aging and escalation remain explainable.' });
        if (waiting && !frontmatter.waiting_since)
            issues.push({ code: 'waiting_work_without_waiting_since', detail: 'Waiting work should record waiting_since so follow-up aging remains explainable.' });
        if (taskStatus === 'completed' && !frontmatter.completed_at)
            issues.push({ code: 'completed_work_without_completed_at', detail: 'Completed work should record completed_at so cycle-time history is measurable.' });
    }
    if (kind === 'project' && lifecycle === 'active' && String(frontmatter.task_status || '').toLowerCase() === 'waiting' && !frontmatter.waiting_for) {
        issues.push({ code: 'waiting_project_without_owner', detail: 'A waiting project should identify the person, event, or resource it is waiting for.' });
    }
    if (frontmatter.triage_disposition !== undefined && !clarifyDispositionSet.has(String(frontmatter.triage_disposition).trim().toLowerCase())) {
        issues.push({ code: 'invalid_triage_disposition', detail: `triage_disposition must be one of: ${CLARIFY_DISPOSITIONS.join(', ')}` });
    }
    for (const [field, maximum] of [['primary_moc', 500], ['clarified_by', 200], ['clarify_note', 1000], ['triage_target', 500], ['moc_purpose', 1000], ['moc_scope', 500], ['moc_parent', 500], ['project_purpose', 1000]]) {
        const value = frontmatter[field];
        if (value !== undefined && (typeof value !== 'string' || Array.from(value).length > maximum)) {
            issues.push({ code: `invalid_${field}`, detail: `${field} must be text of ${maximum} Unicode characters or fewer.` });
        }
    }
    if (frontmatter.clarified_at !== undefined && (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(String(frontmatter.clarified_at).trim()) || Number.isNaN(Date.parse(String(frontmatter.clarified_at).trim())))) {
        issues.push({ code: 'invalid_clarified_at', detail: 'clarified_at should be an ISO date or date-time.' });
    }
    if (frontmatter.moc_questions !== undefined && (!Array.isArray(frontmatter.moc_questions) || frontmatter.moc_questions.some((item) => typeof item !== 'string' || !item.trim() || Array.from(item).length > 500))) {
        issues.push({ code: 'invalid_moc_questions', detail: 'moc_questions must be a non-empty string array with entries of 500 Unicode characters or fewer.' });
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
    if (kind === 'moc') {
        if (!frontmatter.moc_purpose)
            issues.push({ code: 'moc_purpose_missing', detail: 'A MOC should state what navigation or question it is meant to serve.' });
        if (!Array.isArray(frontmatter.moc_questions) || frontmatter.moc_questions.length === 0)
            issues.push({ code: 'moc_questions_missing', detail: 'A MOC should list representative questions so its coverage stays intentional.' });
    }
    if (lifecycle === 'superseded' && !frontmatter.replacement_path && !frontmatter.replaced_by && !frontmatter.superseded_by) {
        issues.push({ code: 'superseded_without_replacement', detail: 'A superseded knowledge note should point to the replacement note with replacement_path, replaced_by, or superseded_by.' });
    }
    if (lifecycle === 'archived' && !frontmatter.archive_reason) {
        issues.push({ code: 'archived_reason_missing', detail: 'An archived knowledge note should retain a short archive_reason so future agents know why it was retired.' });
    }
    const retentionPolicy = String(frontmatter.retention_policy || '').trim().toLowerCase();
    if (['archive', 'tombstone'].includes(retentionPolicy) && !frontmatter.retention_reason) {
        issues.push({ code: 'retention_reason_missing', detail: 'Archive or tombstone retention should retain a short reason so future agents know why the note is no longer active.' });
    }
    if (retentionPolicy === 'tombstone' && lifecycle !== 'archived' && lifecycle !== 'superseded') {
        issues.push({ code: 'tombstone_lifecycle_mismatch', detail: 'A tombstone retention policy should use lifecycle archived or superseded and preserve a visible replacement or reason.' });
    }
    if (frontmatter.last_review_outcome !== undefined && (!frontmatter.last_reviewed_at || !frontmatter.last_reviewed_by)) {
        issues.push({ code: 'review_record_incomplete', detail: 'A recorded review outcome should include both last_reviewed_at and last_reviewed_by.' });
    }
    if (kind === 'literature' && (!frontmatter.interpretation_status || String(frontmatter.interpretation_status).toLowerCase() === 'unprocessed')) {
        issues.push({ code: 'literature_interpretation_pending', detail: 'A literature note is still unprocessed; add a compact interpretation or derive a reusable atomic/knowledge note.' });
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
