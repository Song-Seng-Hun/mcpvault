import type { Tool } from '@modelcontextprotocol/server';
import {
  ANSWER_PACKET_INTENTS, BASES_VIEW_IDS, CATALOG_ORDERS, CLAIM_ROLES,
  CLAIM_STATUSES, CONFIDENCE_LEVELS, ISSUE_KINDS, NOTE_TEMPLATE_IDS,
  RECIPROCAL_RELATIONS, RELATION_FIELDS, TEMPORAL_VALIDITY_STATES, WIKI_PROJECTION_VIEWS,
  getOrganizationPropertyContract,
} from './organization.js';
import { WIKI_POLICY_TOPICS } from './wiki-policy.js';

type ToolPropertySchema = Record<string, any>;

const organizationPropertyContracts = new Map(
  getOrganizationPropertyContract().map(contract => [contract.name, contract]),
);

/** Adapt the public Obsidian Properties contract into MCP JSON Schema. Endpoint
 * details may narrow lengths/defaults, but the type, base meaning, and allowed
 * vocabulary always originate from the same contract used by lint. */
function organizationPropertySchema(
  propertyName: string,
  overrides: ToolPropertySchema = {},
): ToolPropertySchema {
  const contract = organizationPropertyContracts.get(propertyName);
  if (!contract) throw new Error(`Unknown organization property contract: ${propertyName}`);
  const type = contract.type === 'text' ? 'string' : contract.type === 'list' ? 'array' : contract.type;
  const base: ToolPropertySchema = { type, description: contract.description };
  if (contract.allowed?.length) {
    if (contract.type === 'list') base.items = { type: 'string', enum: [...contract.allowed] };
    else base.enum = [...contract.allowed];
  } else if (contract.type === 'list') {
    base.items = { type: 'string' };
  }
  const { description, items, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    ...(items && { items: { ...(base.items || {}), ...items } }),
    ...(description && { description: `${contract.description}. ${description}` }),
  };
}

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope. Omit for public global scope only.' } as const;
const scopeUri = { type: 'string', description: 'Target scope root; defaults to scope://global/. Private scopes require an authorized accessToken.', default: 'scope://global/' } as const;
const ACTIVE_LIFECYCLES = ['inbox', 'active', 'review', 'evergreen'] as const;
const executionProperties = {
  tags: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 30, description: 'Native Obsidian tag list; [] clears tags without changing the body' },
  timeEstimateMinutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Estimated minutes for one next action; used by wiki.next_actions maxMinutes' },
  energy: organizationPropertySchema('energy', { description: 'Used by wiki.next_actions to match the current execution capacity' }),
  effort: organizationPropertySchema('effort', { description: 'Used by wiki.next_actions to match the current execution capacity' }),
};
const temporalProperties = {
  validFrom: { type: 'string', description: 'Inclusive ISO date/time from which this knowledge applies; distinct from file/source/task dates' },
  validUntil: { type: 'string', description: 'Exclusive ISO date/time after which this knowledge must be reviewed before reuse' },
  observedAt: { type: 'string', description: 'ISO date/time when the represented condition was observed' },
  temporalScope: { type: 'string', maxLength: 1000, description: 'Short condition or period in which this knowledge applies' },
} as const;

export const LLM_WIKI_MUTATING_TOOLS = [
  'initialize_llm_wiki', 'ingest_source', 'capture_wiki_note', 'clarify_wiki_note', 'distill_wiki_source', 'publish_knowledge', 'publish_decision_record', 'triage_wiki_note', 'review_wiki_note', 'review_wiki_claim', 'report_wiki_issue', 'propose_wiki_term_change', 'resolve_wiki_issue', 'export_wiki_base', 'export_wiki_canvas',
] as const;

export function getLlmWikiTools(): Tool[] {
  return [
    {
      name: 'orient_wiki',
      description: 'Call this first after connecting. It returns visible scope, safety context, and exactly one primary action without scanning catalog or lint state. Execute only that action, then stop tool use and answer unless the current user explicitly requested another step. Welcome, schema, policy, community, and dashboards are progressive resources, never a preload checklist.',
      inputSchema: { type: 'object', properties: { accessToken, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 3000, description: 'Hard response budget; orientation remains compact even when a larger budget is allowed' }, prettyPrint } },
    },
    {
      name: 'initialize_llm_wiki',
      description: 'Initialize the minimal schema contract for one scope. This gives future agents a shared constitution for evidence, disagreement, references, and Git history. Creates missing files only and never overwrites an existing schema.',
      inputSchema: { type: 'object', properties: { scopeUri, actor: { type: 'string' }, accessToken, prettyPrint } },
    },
    {
      name: 'ingest_source',
      description: 'Capture one immutable raw source snapshot. Re-ingesting identical content is idempotent; changed content requires a new sourceId.',
      inputSchema: { type: 'object', properties: {
        scopeUri, sourceId: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
        sourceUrl: { type: 'string' }, capturedBy: { type: 'string' }, capturedAt: { type: 'string' }, mediaType: { type: 'string' }, sourceType: { type: 'string', maxLength: 80, description: 'Optional source kind such as paper, web, book, dataset, or code' }, citationKey: { type: 'string', maxLength: 120, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }, author: { type: 'string', maxLength: 300 }, publishedAt: { type: 'string' }, retrievedAt: { type: 'string' }, sourceFamily: { type: 'string', maxLength: 160, description: 'Legacy-compatible stable family key connecting immutable versions of the same source' }, sourceVersion: { type: 'string', maxLength: 120, description: 'Legacy-compatible version, edition, or retrieval label' }, sourceWorkId: { type: 'string', maxLength: 160, description: 'Stable work identifier; defaults to sourceFamily' }, sourceEditionId: { type: 'string', maxLength: 160, description: 'Stable edition identifier; defaults to sourceVersion' }, supersedesSource: { type: 'string', maxLength: 500, description: 'Previous source ID or scope-safe source path' },
        archiveCollectionId: { type: 'string', maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$', description: 'Stable provenance-group identifier for an archival source collection' }, archiveSeries: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 160 }, description: 'Broad-to-narrow archival series path; does not replace folders or MOCs' }, archiveSequence: { type: 'integer', minimum: 0, maximum: 1000000000, description: 'Original-order position within one exact archival series' }, accessionId: { type: 'string', maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$', description: 'Optional ingestion or transfer batch identifier' }, custodialHistory: { type: 'string', maxLength: 1000, description: 'Bounded custody/provenance note' }, originalOrderNote: { type: 'string', maxLength: 1000, description: 'How original order was preserved or reconstructed' },
        trustLevel: organizationPropertySchema('trust_level', { default: 'unrated' }), trustReason: { type: 'string', maxLength: 500 }, accessToken, prettyPrint,
      }, required: ['title', 'content'] },
    },
    {
      name: 'capture_wiki_note',
      description: 'Capture a rough observation in Inbox with one call. It defaults to note_kind=fleeting and lifecycle=inbox and returns its revision plus an executable wiki.clarify next action. Optionally preserve bounded origin, reason, context, and one related task so a later agent can understand why the capture exists; never put raw prompts, credentials, or secrets in these fields.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Optional path inside Inbox/. Omit to generate a unique Inbox path.' }, title: { type: 'string', maxLength: 300 }, content: { type: 'string' }, references: { type: 'array', items: { type: 'string' }, maxItems: 20 }, capturedBy: { type: 'string' }, capturedFrom: organizationPropertySchema('captured_from'), captureReason: { type: 'string', maxLength: 500, description: 'Why this observation was captured; do not include secrets or raw prompt text' }, captureContext: { type: 'string', maxLength: 1000, description: 'Short surrounding context another agent needs to interpret the capture' }, relatedTask: { type: 'string', maxLength: 500, description: 'One existing task/project path or Obsidian wikilink related to this capture' }, expectedRevision: { type: 'string', description: "Optional; use 'missing' for a new capture" }, accessToken, prettyPrint,
      }, required: ['content'] },
    },
    {
      name: 'clarify_wiki_note',
      description: 'Complete the GTD Clarify step for one Inbox capture. Applies the disposition lifecycle, detects an existing proposed destination, and returns a revision-safe move-preview or merge-preview action without deleting, overwriting, or silently moving the note.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, disposition: organizationPropertySchema('triage_disposition'), clarifiedBy: { type: 'string' }, clarifyNote: { type: 'string', maxLength: 1000 }, targetPath: { type: 'string', description: 'Optional vault-relative destination suggestion; the note is not moved automatically' },
        noteKind: organizationPropertySchema('note_kind'), lifecycle: organizationPropertySchema('lifecycle'), epistemicStatus: { type: 'string', description: 'Required when clarifying as question, hypothesis, experiment, or assumption; experiment uses planned/running/completed/failed/inconclusive/reproduced' }, taskStatus: organizationPropertySchema('task_status'), project: { type: 'string' }, nextAction: { type: 'string', maxLength: 500 }, waitingFor: { type: 'string', maxLength: 500 }, desiredOutcome: { type: 'string', maxLength: 1000 }, projectPurpose: { type: 'string', maxLength: 1000 }, projectSupport: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 30 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'disposition', 'expectedRevision'] },
    },
    {
      name: 'distill_wiki_source',
      description: 'Create an attributed literature or atomic Wiki note from one immutable source snapshot. This makes source interpretation explicit while preserving the source path and revision as provenance.',
      inputSchema: { type: 'object', properties: {
        sourcePath: { type: 'string' }, path: { type: 'string' }, title: { type: 'string', maxLength: 300 }, content: { type: 'string' }, author: { type: 'string' }, noteKind: { type: 'string', enum: ['literature', 'atomic', 'knowledge'], default: 'literature' }, references: { type: 'array', items: { type: 'string' }, maxItems: 20 }, summary: { type: 'string', maxLength: 2000 }, keyPoints: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 }, openQuestions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['sourcePath', 'path', 'title', 'content', 'expectedRevision'] },
    },
    {
      name: 'publish_decision_record',
      description: 'Create or update a structured Decision Record as an evidence-grounded knowledge note. Record context, the decision, alternatives, consequences, status, and evidence so later agents can audit or supersede it without duplicating Git history.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, title: { type: 'string' }, context: { type: 'string', maxLength: 4000 }, decision: { type: 'string', maxLength: 4000 },
        alternatives: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 12 }, consequences: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 12 },
        status: organizationPropertySchema('decision_status', { default: 'proposed' }), supersedes: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 30, description: 'Older Decision Records replaced by this one; direction is new -> old.' }, replacedBy: { type: 'string', maxLength: 500, description: 'Successor path when explicitly retiring this record.' }, evidencePaths: { type: 'array', items: { type: 'string' }, maxItems: 20 }, references: { type: 'array', items: { type: 'string' } },
        author: { type: 'string' }, reviewAt: { type: 'string' }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'title', 'context', 'decision', 'evidencePaths', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_decision_register',
      description: 'Return a bounded live register of visible Decision Records with structured state, revisions, predecessor/successor lineage, legacy migration warnings, active-target conflicts, ambiguous links, and supersession cycles. It derives from Markdown, never auto-rewrites records, and treats decision_status as authoritative.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 8000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'publish_knowledge',
      description: 'Create or update active evidence-grounded knowledge while preserving ordinary Markdown/Obsidian/Git behavior. Use wiki.lifecycle_transition instead of this endpoint for retirement or reactivation. Every evidence path must be an immutable source snapshot.',
      inputSchema: { type: 'object', properties: {
        ...executionProperties,
        ...temporalProperties,
        path: { type: 'string' }, content: { type: 'string', description: 'Obsidian Markdown; resolvable [[Note]] links are automatically recorded as references' }, evidencePaths: { type: 'array', items: { type: 'string' } }, references: { type: 'array', items: { type: 'string' }, description: 'Optional note paths or Obsidian [[Note]] references' },
        author: { type: 'string' }, confidence: organizationPropertySchema('confidence', { default: 'medium' }),
        status: organizationPropertySchema('knowledge_status', { default: 'draft' }),
        noteKind: organizationPropertySchema('note_kind', { default: 'knowledge' }),
        lifecycle: organizationPropertySchema('lifecycle', { enum: [...ACTIVE_LIFECYCLES], description: 'Retired states are managed only by wiki.lifecycle_transition' }),
        decisionStatus: organizationPropertySchema('decision_status', { description: 'For noteKind=decision, prefer wiki.decision_record for creation and state transitions' }),
        moc: { type: 'string', description: 'Optional legacy single Obsidian [[MOC]] link or path' }, mocs: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12, description: 'Additional Obsidian [[MOC]] links for multi-context discovery; navigation only' }, primaryMoc: { type: 'string', maxLength: 500, description: 'Preferred Obsidian MOC entry point for this note; navigation only' }, navOrder: { type: 'integer', minimum: 0, maximum: 1000000, description: 'Optional order among sibling MOCs; lower numbers appear first' }, project: { type: 'string', description: 'Optional Obsidian [[Project]] link or path' },
        reviewAt: { type: 'string', description: 'Optional ISO date/time for evidence review' }, reviewIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional cadence in days; review_wiki_note schedules the next review after completion' }, reviewSnoozedUntil: { type: 'string', description: 'Temporarily omit this note from review queues until an ISO date/time' }, reviewSnoozeReason: { type: 'string', maxLength: 500 },
        aliases: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 30, description: 'Optional Obsidian aliases for stable navigation' }, knowledgeRole: organizationPropertySchema('knowledge_role', { description: 'Use counterargument for an explicit rebuttal or limitation' }), seeAlso: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20, description: 'Adjacent Obsidian links, not evidence' },
        canonicalPath: { type: 'string', maxLength: 500, description: 'Optional visible canonical note path for a redirect or duplicate; never an access boundary' },
        recallPrompt: { type: 'string', maxLength: 1000, description: 'Optional active-recall question for high-value knowledge; separate from evidence review' },
        recallIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional active-recall cadence in days' },
        retentionPolicy: organizationPropertySchema('retention_policy'), retentionEvent: organizationPropertySchema('retention_event'), retentionAt: { type: 'string', description: 'Optional ISO date/time for preservation review or archival consideration' }, preserveUntil: { type: 'string', description: 'Do not propose archival or tombstoning before this ISO date/time' }, legalHold: { type: 'boolean', description: 'Keep the note and history until an authorized human releases the hold' }, retentionReason: { type: 'string', maxLength: 1000 }, replacedBy: { type: 'string', maxLength: 500, description: 'Visible replacement note for superseded or tombstoned knowledge' },
        summary: { type: 'string', maxLength: 2000, description: 'Optional compact projection; preserve the full Markdown body' },
        summaryLayer: { type: 'integer', minimum: 0, maximum: 4, description: 'Optional Progressive Summarization layer: 0 original, 1 capture, 2 bold, 3 highlight, 4 executive summary/remix' },
        summaryHighlights: { type: 'array', maxItems: 12, description: 'Optional selected passages for progressive reading; each item may include text, startLine/endLine, and quoteHash', items: { type: 'object', properties: { text: { type: 'string', maxLength: 600 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['text'] } },
        keyPoints: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        openQuestions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        nextActions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        nextAction: { type: 'string', maxLength: 500, description: 'One concrete next action; adding it makes any knowledge note actionable without changing noteKind' },
        waitingFor: { type: 'string', maxLength: 500 },
        desiredOutcome: { type: 'string', maxLength: 1000, description: 'GTD-style observable outcome' },
        projectPurpose: { type: 'string', maxLength: 1000, description: 'Optional project purpose/why; keep this separate from the desired outcome' },
        projectSupport: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 30, description: 'Optional bounded Obsidian links or paths to project-support material; not the day-to-day action list' },
        taskContext: { type: 'string', maxLength: 300, description: 'GTD context such as @computer, @research, or a named capability' },
        dueAt: { type: 'string', description: 'Optional ISO deadline; it is not a calendar appointment' },
        scheduledAt: { type: 'string', description: 'Optional ISO date/time when the work should be performed' },
        deferUntil: { type: 'string', description: 'Optional ISO date/time before which this action should not be revisited' },
        serviceClass: organizationPropertySchema('service_class'),
        completionCriteria: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12, description: 'Observable conditions that define done for the actionable work' },
        startedAt: { type: 'string', description: 'Optional ISO time when work entered progress' }, blockedSince: { type: 'string', description: 'Optional ISO time when work became blocked' }, waitingSince: { type: 'string', description: 'Optional ISO time when work began waiting' }, completedAt: { type: 'string', description: 'Optional ISO time when work completed' },
        taskStatus: organizationPropertySchema('task_status', { description: 'Separate from knowledge lifecycle' }),
        reviewPolicy: organizationPropertySchema('review_policy', { description: 'Upstream compares typed dependency/support revisions and states with the last publish/review baseline, not nearby links' }),
        reviewOutcome: organizationPropertySchema('last_review_outcome', { description: 'Records completion without duplicating Git history' }),
        interpretationStatus: organizationPropertySchema('interpretation_status'),
        reviewedBy: { type: 'string', maxLength: 200 }, reviewedAt: { type: 'string' }, reviewNote: { type: 'string', maxLength: 1000 },
        epistemicStatus: { type: 'string', description: 'Question: open/answered/blocked/abandoned; hypothesis: proposed/supported/refuted/inconclusive; experiment: planned/running/completed/failed/inconclusive/reproduced; assumption: active/verified/invalidated/replaced' },
        polarity: organizationPropertySchema('knowledge_polarity', { description: 'Use negative for failures, rejected approaches, counterexamples, or non-reproducible results that should remain searchable' }),
        negativeType: organizationPropertySchema('negative_type'),
        attempted: { type: 'string', maxLength: 1200 }, observed: { type: 'string', maxLength: 1200 }, failureCondition: { type: 'string', maxLength: 1200 }, affectedScope: { type: 'string', maxLength: 500 }, reproduction: { type: 'string', maxLength: 1200 }, whyRejected: { type: 'string', maxLength: 1200 }, reusableLesson: { type: 'string', maxLength: 1200 }, replacementPath: { type: 'string', maxLength: 500 },
        evidence: { type: 'array', maxItems: 30, description: 'Optional evidence locators; add heading/blockId and, when precise citation matters, 1-based startLine/endLine plus quoteHash (SHA-256 of the selected source lines)', items: { type: 'object', properties: { path: { type: 'string' }, heading: { type: 'string', maxLength: 300 }, blockId: { type: 'string', maxLength: 100 }, revision: { type: 'string', maxLength: 160 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['path'] } },
        stableId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', maxLength: 80, description: 'Optional stable identity for durable notes; not a security boundary' },
        termStatus: organizationPropertySchema('term_status'), termReplacedBy: { type: 'string', maxLength: 500, description: 'Preferred term or Obsidian link replacing a deprecated term' }, preferredTerm: { type: 'string', maxLength: 300, description: 'Preferred authority display term; defaults to the note title' }, disambiguation: { type: 'string', maxLength: 300, description: 'Short qualifier for homonymous terms' }, broaderTerms: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, relatedTerms: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, subjectTerms: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20, description: 'Bounded subject access terms for faceted retrieval' }, domain: { type: 'string', maxLength: 200, description: 'Primary domain for faceted retrieval' }, methods: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20 }, audience: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 12 }, retrievalCues: { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 8, description: 'Situations or problem signals that should surface this note' }, useWhen: { type: 'string', maxLength: 1000, description: 'Compact description of when this note is useful' },
        termScopeNote: { type: 'string', maxLength: 1000, description: 'Short definition that prevents a term from being used too broadly' },
        termLanguage: { type: 'string', maxLength: 40, description: 'Optional language/script tag such as ko or en-US' }, authorityScheme: { type: 'string', maxLength: 120, description: 'Optional vocabulary or authority source name' }, authorityId: { type: 'string', maxLength: 200, description: 'Optional stable identifier in that authority scheme' },
        relations: { type: 'object', description: 'Typed Obsidian link arrays: supports, contradicts, supersedes, derived_from, depends_on, implements, blocked_by, answers_questions, tests, related, same_as, version_of, refines' }, relationNotes: { type: 'object', description: 'Short rationale keyed by relation field' }, relationEvidence: { type: 'object', description: 'Up to four scope-safe evidence paths keyed by relation field' },
        mocPurpose: { type: 'string', maxLength: 1000, description: 'For MOCs: the navigation purpose' }, mocScope: { type: 'string', maxLength: 500, description: 'For MOCs: the knowledge boundary or topic scope' }, mocQuestions: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12, description: 'For MOCs: representative questions the map should answer' }, mocParent: { type: 'string', maxLength: 500, description: 'Optional parent MOC wikilink' },
        focusHorizon: organizationPropertySchema('focus_horizon', { description: 'Optional GTD horizon for connecting concrete action to purpose/principles' }), focusParent: { type: 'string', maxLength: 500, description: 'Optional Obsidian link/path to the higher-level outcome this note serves' }, focusSupports: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20, description: 'Optional bounded links/paths to outcomes supported by this note; navigation metadata only' },
        claims: { type: 'array', maxItems: 100, description: 'Optional claim-level provenance and argument structure. Every claim needs text and at least one intact immutable evidence path. Put ^claim-id on the corresponding Markdown block; claim relations use [[Note#^claim-id]] or local [[#^claim-id]] links.', items: { type: 'object', properties: {
          id: { type: 'string' }, text: { type: 'string' }, evidencePaths: { type: 'array', items: { type: 'string' }, maxItems: 20 }, evidence: { type: 'array', maxItems: 30, items: { type: 'object', properties: { path: { type: 'string' }, heading: { type: 'string', maxLength: 300 }, blockId: { type: 'string', maxLength: 100 }, revision: { type: 'string', maxLength: 160 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['path'] } },
          confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] }, status: { type: 'string', enum: [...CLAIM_STATUSES] },
          claimRole: { type: 'string', enum: [...CLAIM_ROLES], description: 'Optional argumentative job of this claim' },
          supportsClaims: { type: 'array', items: { type: 'string', pattern: '^\\[\\[.*#\\^[A-Za-z0-9_-]+(?:\\|[^\\]]+)?\\]\\]$' }, maxItems: 20, description: 'Claims supported by this claim, as Obsidian block links' },
          contradictsClaims: { type: 'array', items: { type: 'string', pattern: '^\\[\\[.*#\\^[A-Za-z0-9_-]+(?:\\|[^\\]]+)?\\]\\]$' }, maxItems: 20, description: 'Claims challenged by this claim, as Obsidian block links' },
          dependsOnClaims: { type: 'array', items: { type: 'string', pattern: '^\\[\\[.*#\\^[A-Za-z0-9_-]+(?:\\|[^\\]]+)?\\]\\]$' }, maxItems: 20, description: 'Claims required by this claim, as Obsidian block links' },
        }, required: ['text', 'evidencePaths'] } },
        expectedRevision: { type: 'string', description: "Required revision, or 'missing' for a new note" }, accessToken, prettyPrint,
      }, required: ['path', 'content', 'evidencePaths', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_catalog',
      description: 'Build a live scope-aware catalog from frontmatter instead of maintaining a stale hand-written index. Set includeFacets=true for bounded metadata-only counts across note kind, lifecycle, knowledge role, epistemic/task state, review policy, source type, polarity, MOC, project, domain, subject terms, tags, and temporal validity. Optional facet filters narrow the same metadata pass without loading note bodies; validity can be evaluated at validAt. Use orderBy for LATCH-style location, alphabet, time, category, or hierarchy browsing without duplicating notes.',
      inputSchema: { type: 'object', properties: {
        noteKind: organizationPropertySchema('note_kind'),
        lifecycle: organizationPropertySchema('lifecycle'),
        epistemicStatus: { type: 'string', maxLength: 80, description: 'Optional exact epistemic state filter for question/hypothesis/experiment/assumption notes' },
        taskStatus: organizationPropertySchema('task_status'),
        reviewPolicy: organizationPropertySchema('review_policy'),
        sourceType: { type: 'string', maxLength: 80, description: 'Optional source kind filter such as paper, web, book, dataset, or code' },
        polarity: organizationPropertySchema('knowledge_polarity', { description: 'Filter preserved knowledge by positive or negative/failed-path polarity' }),
        knowledgeRole: organizationPropertySchema('knowledge_role', { description: 'Optional exact durable-knowledge role filter' }),
        moc: { type: 'string', maxLength: 500, description: 'Case-insensitive exact match against primary_moc, moc, or one mocs value' },
        project: { type: 'string', maxLength: 500, description: 'Case-insensitive exact project match' },
        domain: { type: 'string', maxLength: 200 },
        subjectTerm: { type: 'string', maxLength: 200, description: 'Case-insensitive exact match against one subject_terms value' },
        method: { type: 'string', maxLength: 200, description: 'Case-insensitive exact match against one methods value' },
        audience: { type: 'string', maxLength: 200, description: 'Case-insensitive exact match against one audience value' },
        tag: { type: 'string', maxLength: 200, description: 'Case-insensitive exact match against one native Obsidian tag' },
        validity: { type: 'string', enum: [...TEMPORAL_VALIDITY_STATES], description: 'Filter by claim-validity state at validAt (or the current server time)' },
        validAt: { type: 'string', description: 'ISO date/time used to evaluate valid_from/valid_until; defaults to now' },
        includeFacets: { type: 'boolean', description: 'Include bounded metadata-only facet counts for exploratory browsing (default: false)' },
        facetLimit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Maximum values returned per facet' },
        orderBy: { type: 'string', enum: [...CATALOG_ORDERS], default: 'location', description: 'LATCH-style browse order: path, title/alias, recent time, category, or MOC/project hierarchy' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 12000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_neighborhood',
      description: 'Return a bounded, explainable knowledge neighborhood around one visible note. Direct Obsidian links and typed backlinks come first, then shared MOC/project metadata and optional semantic matches. It returns metadata, reasons, locators, and revisions—not full neighbor bodies—so read selected notes explicitly.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Existing visible Markdown note path' },
        limit: { type: 'integer', minimum: 1, maximum: 40, default: 12 },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 },
        includeSemantic: { type: 'boolean', description: 'Add optional bounded vector candidates; failures remain isolated (default: false)' },
        accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'get_wiki_trail',
      description: 'Find up to a few short, scope-safe Obsidian link paths between two visible notes. Returns link lines, relations, and context without loading neighbor bodies; use it to traverse a knowledge chain rather than treating semantic similarity as proof.',
      inputSchema: { type: 'object', properties: {
        fromPath: { type: 'string', description: 'Starting visible Markdown note path' }, toPath: { type: 'string', description: 'Destination visible Markdown note path' },
        maxDepth: { type: 'integer', minimum: 1, maximum: 4, default: 3 }, limit: { type: 'integer', minimum: 1, maximum: 8, default: 3 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint,
      }, required: ['fromPath', 'toPath'] },
    },
    {
      name: 'get_wiki_placement_candidates',
      description: 'Return a bounded advisory report of notes whose PARA filing folder disagrees with lifecycle or note_kind Properties. It does not move, rename, delete, or expose private notes; review the current revision before triage_wiki_note or move_note.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_knowledge_gaps',
      description: 'Return a bounded active-recall and research queue for open questions, proposed or inconclusive hypotheses, active assumptions, disputed claims, and negative knowledge. It only projects metadata and never decides truth or rewrites notes.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_answer_packet',
      description: 'Build one bounded intent-aware context packet for a selected Wiki note. It combines the current progressive projection, temporal applicability, explainable neighbors, source-work diversity, a question-to-claim-to-evidence-to-counterexample-to-decision reasoning trail, and bounded next guidance. Diversity is advisory: snapshots of one work are not independent corroboration and several works do not prove truth. Choose capture, explore, decide, execute, or review; revisions remain freshness guards and selected bodies stay compact.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Existing visible Markdown note path' },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 },
        includeSemantic: { type: 'boolean', description: 'Add optional bounded semantic candidates to neighbor discovery (default: true)' },
        intent: { type: 'string', enum: [...ANSWER_PACKET_INTENTS], default: 'decide', description: 'Order and interpret the compact packet for the current job: capture rough input, explore connections, decide with evidence, execute a next action, or review freshness/quality.' },
        accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'get_wiki_claim_matrix',
      description: 'Return a bounded claim-by-evidence review matrix for one knowledge note. It preserves authored claim order, groups cited snapshots by source work, flags missing/unavailable/altered/stale/single-work evidence, and separately prioritizes claims needing attention. It never treats source count as truth or changes a claim; inspect current revisions before review_wiki_claim.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Existing visible LLM Wiki knowledge-note path' },
        limit: { type: 'integer', minimum: 1, maximum: 40, default: 20, description: 'Maximum authored claims to scan in this bounded pass' },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'get_wiki_argument_map',
      description: 'Return a bounded, scope-aware claim-to-claim argument map rooted at one knowledge note or claim. It follows supportsClaims, contradictsClaims, and dependsOnClaims authored as Obsidian [[Note#^claim-id]] block links; the document may be a uniquely visible path, title, alias, preferred term, stable ID, or relative path. It verifies structured target ids and Markdown block anchors and reports ambiguity, missing targets, role mismatches, self-links, and support/dependency cycles. It is a navigation and consistency projection, never a truth judgment or an automatic rewrite.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Existing visible LLM Wiki knowledge-note path' },
        claimId: { type: 'string', maxLength: 80, description: 'Optional claim id within path; omit to start from every structured claim in the note' },
        maxDepth: { type: 'integer', minimum: 0, maximum: 4, default: 2, description: 'Maximum incoming/outgoing relation hops from the selected claim(s)' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 40, description: 'Maximum claim nodes returned' },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'get_wiki_context_pack',
      description: 'Build a reusable bounded shelf around one visible Wiki note, project, MOC, question, or decision. It provides a stable root, ordered entrypoints, supporting context, counterpoints, gaps, and revisions in one response. Entry links resolve visible paths, titles, aliases, preferred terms, stable IDs, and explicit relative paths without creating a second authoritative index. Re-read returned notes before editing or relying on them; this is navigation, not a truth score.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Visible Markdown note to use as the context root' },
        intent: { type: 'string', enum: [...ANSWER_PACKET_INTENTS], default: 'decide' },
        includeSemantic: { type: 'boolean', description: 'Include optional bounded semantic discovery candidates (default: false)' },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'get_wiki_learning_path',
      description: 'Analyze one visible MOC as a bounded dependency-aware reading path. It preserves authored Obsidian link order, resolves entries and prerequisites by visible path/title/alias/preferred term/stable ID/relative path, expands nested MOCs to a limited depth, and returns a separate stable recommended order plus unresolved, ambiguous, external, late-prerequisite, and cycle findings. It never guesses an ambiguous target, rewrites, or reorders Markdown; every readable item carries its current revision.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Existing visible MOC Markdown note path' },
        maxDepth: { type: 'integer', minimum: 0, maximum: 6, default: 2, description: 'Maximum nested-MOC expansion depth; 0 reads only the root MOC body' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 30, description: 'Maximum unique authored entries returned' },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'get_wiki_authority_map',
      description: 'Return a bounded library-style authority view derived from note titles, Obsidian aliases, and stable IDs. It helps normalize terminology and exposes title/alias collisions without renaming notes or creating a parallel taxonomy.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Optional term or alias prefix to browse' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_term_change_preview',
      description: 'Preview the bounded impact of changing a preferred term. It finds visible title, alias, property, body, and wikilink uses plus proposed-term collisions and revisions; it never renames notes or rewrites links.',
      inputSchema: { type: 'object', properties: {
        currentTerm: { type: 'string', maxLength: 300 }, proposedTerm: { type: 'string', maxLength: 300 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 }, scopeUri, accessToken, prettyPrint,
      }, required: ['currentTerm', 'proposedTerm'] },
    },
    {
      name: 'get_wiki_vocabulary_health',
      description: 'Return a bounded library-style vocabulary, Obsidian tag, and facet health report. It finds tag spelling/case variants, subject terms without a local authority note, terms used by multiple notes, sufficiently sampled facets dominated by one-off values, and values attached to most visible notes. Hidden or quarantined notes do not contribute. Findings are advisory; it never renames, retags, merges, or redirects notes.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 60, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'resolve_wiki_term',
      description: 'Resolve one title, alias, stable ID, or deprecated term to a bounded canonical Wiki destination. This is a navigation hint only: it never renames, redirects, merges, or grants access.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Term, alias, or stable ID to resolve' },
        limit: { type: 'integer', minimum: 1, maximum: 40, default: 12 },
        maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000 },
        accessToken, prettyPrint,
      }, required: ['query'] },
    },
    {
      name: 'preview_wiki_merge',
      description: 'Compare two visible Wiki notes before deliberate consolidation. Returns revision-safe identity, metadata, link, evidence, conflict, and bounded body previews; it never writes, merges, renames, or deletes notes.',
      inputSchema: { type: 'object', properties: {
        sourcePath: { type: 'string', description: 'Note whose knowledge may be consolidated' },
        targetPath: { type: 'string', description: 'Candidate canonical note' },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 8000 },
        accessToken, prettyPrint,
      }, required: ['sourcePath', 'targetPath'] },
    },
    {
      name: 'get_wiki_maintenance_debt',
      description: 'Return a bounded derived 5S maintenance ledger for Inbox captures, stale summaries, due or never-reviewed knowledge, missing primary MOCs, unfinished literature, incomplete projects, and empty MOCs. It never moves, archives, deletes, or rewrites notes.',
      inputSchema: { type: 'object', properties: {
        olderThanDays: { type: 'integer', minimum: 1, maximum: 3650, default: 30, description: 'Age threshold for aging and never-reviewed signals' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_exception_board',
      description: 'Combine existing organization, graph, quarantine, freshness, vocabulary, and execution findings into one bounded 5S-style exception board. It makes repair work visible and prioritized without creating another task database or changing notes.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 60, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_quality_check',
      description: 'Check one visible note against a small role-specific rubric for titles, projections, evidence, navigation, project execution, MOC purpose, literature interpretation, or epistemic status. Results are advisory and never block publishing or rewrite the note.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000 }, accessToken, prettyPrint }, required: ['path'] },
    },
    {
      name: 'get_wiki_review_queue',
      description: 'Return a bounded review queue of knowledge notes that are disputed, in review, due for evidence review, or past their explicit valid_until. Read the selected note before revising it; temporal expiry is advisory and this is a derived view, not a second database.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, accessToken, prettyPrint } },
    },
    {
      name: 'review_wiki_note',
      description: 'Record completion of an evidence review without resubmitting the Markdown body. Refreshes the body/link review baseline, records the reviewer and outcome, and can schedule the next review; non-manual policies without an explicit interval use a bounded adaptive cadence.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, reviewOutcome: organizationPropertySchema('last_review_outcome'), reviewedBy: { type: 'string' }, reviewAt: { type: 'string', description: 'Optional next review ISO date/time; if omitted, reviewIntervalDays is used when present' }, reviewIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional cadence in days; completed reviews schedule the next review automatically' }, nextLifecycle: organizationPropertySchema('lifecycle', { enum: [...ACTIVE_LIFECYCLES], description: 'Optional active lifecycle after review; retirement or reactivation uses wiki.lifecycle_transition' }), reviewReason: { type: 'string', maxLength: 120, description: 'Why this review was entered, such as source_changed, link_changed, note_edited, or manual_review' }, reviewChecks: organizationPropertySchema('review_checks', { maxItems: 7, description: 'Quality dimensions actually checked during this review' }), reviewOpenItems: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 8, description: 'Bounded follow-up items left by the review' }, reviewNote: { type: 'string', maxLength: 1000 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'reviewOutcome', 'expectedRevision'] },
    },
    {
      name: 'review_wiki_claim',
      description: 'Review one persisted claim inside a knowledge note without rewriting the Markdown body. Updates only that claim status/confidence and records a bounded reviewer note with the expected revision; evidence remains unchanged and must still be verified separately. Disputed or superseded claims return bounded downstream notes found through claim dependencies/support/contradiction so their conclusions can be re-read rather than silently changed.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, claimId: { type: 'string', maxLength: 80 }, status: { type: 'string', enum: [...CLAIM_STATUSES] }, confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] }, reviewedBy: { type: 'string', maxLength: 200 }, reviewNote: { type: 'string', maxLength: 1000 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'claimId', 'status', 'reviewedBy', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_review_dashboard',
      description: 'Run one bounded GTD Reflect/weekly-review pass over Inbox, next actions, due work, waiting/someday/dependency-blocked items, open questions/hypotheses, due or stale knowledge, and graph/MOC/focus health. Work dependency diagnostics carry current revisions; the view is advisory and never mutates notes.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 18000, default: 9000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_flow_health',
      description: 'Return a bounded Kanban-style flow view and request-local dependency plan for any note carrying work Properties, including actionable questions or experiments as well as project/task notes. It reports stage-0 executable WIP, future dependency stages, immediate unlock points, one deepest chain, actual cycles versus downstream blockage, incomplete/workflow-held prerequisites, a configurable WIP limit, aging, overdue work, service classes, and revisions without assigning or mutating anything. Use it before starting another task.',
      inputSchema: { type: 'object', properties: {
        wipLimit: { type: 'integer', minimum: 1, maximum: 50, default: 3, description: 'Advisory maximum of task_status=next_action items' },
        blockedAfterDays: { type: 'integer', minimum: 1, maximum: 3650, default: 7 },
        waitingAfterDays: { type: 'integer', minimum: 1, maximum: 3650, default: 14 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_policy',
      description: 'Return a bounded machine-readable organization constitution. Omit topic for the compact overview and available topic index; select exactly one topic only when the current job needs detailed guidance. Policy is guidance, not an access grant or mutation.',
      inputSchema: { type: 'object', properties: {
        topic: { type: 'string', enum: [...WIKI_POLICY_TOPICS], default: 'overview', description: 'Load one relevant policy slice instead of the whole handbook' },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'record_wiki_recall',
      description: 'Record an optional active-recall attempt for a high-value Wiki note without rewriting its Markdown body. Attempt the recallPrompt before opening the note, then record failed, partial, or good; this is separate from evidence review and never changes truth status.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, recallQuality: organizationPropertySchema('recall_quality'), recallPrompt: { type: 'string', maxLength: 1000, description: 'Optional replacement prompt; otherwise use the note property' }, recallIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional next-recall cadence; otherwise a bounded quality-based cadence is chosen' }, confusion: { type: 'string', maxLength: 600, description: 'What was forgotten or confused; do not include secrets' }, repairPath: { type: 'string', maxLength: 500, description: 'Optional note/task created to repair the recall failure' }, repairStatus: organizationPropertySchema('recall_repair_status'), expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'recallQuality', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_recall_queue',
      description: 'Return a bounded reader-specific queue of due active-recall prompts. Attempt each prompt before opening the body; agent sessions use private continuity state, and this queue never changes evidence truth or shared knowledge. When contrastWith is present, compare those explicitly related notes before accepting the recalled statement.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_duplicate_candidates',
      description: 'Find bounded near-duplicate Wiki candidates using titles, aliases, compact projections, and a small body sample. Similarity is only a review signal; inspect both revisions and use preview_wiki_merge before any deliberate consolidation. It never merges, moves, deletes, or redirects notes.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_review_packet',
      description: 'Return a smaller action-oriented knowledge-review packet. It coalesces all findings for one path into one bounded slot and covers due evidence, Inbox, recall, blocked work, MOC sequence/hierarchy, focus hierarchy, epistemic consistency, source-to-knowledge flow, graph connectivity, typed relations, and vocabulary hygiene. It returns one revision-safe issue-specific inspect/repair plan and never mutates notes, auto-reorders a MOC, or replaces Git history.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 8 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_project_packet',
      description: 'Return a bounded GTD/Natural Planning packet for active projects. It separates purpose, desired outcome, completion criteria, brainstorming, project-support references, and concrete next actions, then reports the same revision-stamped dependency readiness used by flow and next-action views without rewriting the note.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 40, default: 12 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 8000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_next_actions',
      description: 'Return a bounded GTD action list organized by task context (for example @research or @computer), while keeping project-support material separate. Waiting, blocked, future-deferred, unresolved, ambiguous, inactive, and cyclic work prerequisites are excluded and reported with current revisions. Optional maxMinutes, energy, and effort filters select work that fits the current execution capacity; unknown metadata is excluded and reported. Deadline, active status, service class, immediate unlock impact, and path provide stable ordering; it never assigns or mutates work.',
      inputSchema: { type: 'object', properties: {
        context: { type: 'string', description: 'Optional exact task_context filter' },
        maxMinutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Optional maximum estimated duration in minutes. Reads time_estimate_minutes, estimated_minutes, duration_minutes, or time_minutes.' },
        energy: organizationPropertySchema('energy', { description: 'Optional exact filter; reads energy or energy_level' }),
        effort: organizationPropertySchema('effort', { description: 'Optional exact filter; reads effort or effort_level' }),
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_composition_candidates',
      description: 'Find bounded knowledge notes where atomicity may be a useful next outcome because the note is long, heavily sectioned, or paragraph-dense. This is advisory: inspect the note and use preview_wiki_split before any revision-checked edit; it never splits or rewrites files.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 }, accessToken, prettyPrint } },
    },
    {
      name: 'preview_wiki_split',
      description: 'Preview splitting one Markdown heading section into a separate note. Returns the exact source revision, bounded extracted content, links, and target collision status; it never mutates files. Use this before a revision-checked write_note and patch_note sequence.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Existing accessible Markdown note' },
        heading: { type: 'string', description: 'Exact or partial heading text to extract' },
        targetPath: { type: 'string', description: 'Optional proposed destination path for the new note' },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 },
        accessToken, prettyPrint,
      }, required: ['path', 'heading'] },
    },
    {
      name: 'get_wiki_inbox',
      description: 'Return a bounded oldest-first Inbox triage queue with capture age, fresh/aging/stale bands, and a suggested next action. Age is advisory; this metadata-only view never moves, deletes, or rewrites files.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 5000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_inbox_plan',
      description: 'Preview bounded GTD Clarify dispositions for Inbox captures using only existing Properties. Suggestions are advisory and include the current revision; inspect the note and then call clarify_wiki_note explicitly. It never moves, deletes, or rewrites files.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'triage_wiki_note',
      description: 'Classify one active ordinary Markdown note with PARA/Zettelkasten-style metadata without changing its body or moving it. Retirement and reactivation use wiki.lifecycle_transition. New managed fields are rejected when they do not apply to the selected note role. Use expectedRevision to avoid overwriting another agent.',
      inputSchema: { type: 'object', properties: {
        ...executionProperties,
        ...temporalProperties,
        path: { type: 'string' }, noteKind: organizationPropertySchema('note_kind'),
        lifecycle: organizationPropertySchema('lifecycle', { enum: [...ACTIVE_LIFECYCLES], description: 'Retired states are managed only by wiki.lifecycle_transition' }),
        decisionStatus: organizationPropertySchema('decision_status', { description: 'Metadata-only migration/repair for an existing Decision Record; use wiki.decision_record for an actual state transition' }),
        moc: { type: 'string' }, mocs: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12, description: 'Additional Obsidian [[MOC]] links for multi-context discovery; navigation only' }, primaryMoc: { type: 'string', maxLength: 500, description: 'Preferred Obsidian MOC entry point for this note; navigation only' }, navOrder: { type: 'integer', minimum: 0, maximum: 1000000, description: 'Optional order among sibling MOCs; lower numbers appear first' }, project: { type: 'string' }, reviewAt: { type: 'string' },
        aliases: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 30 }, reviewIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional review cadence in days; review_wiki_note advances review_at after a completed review' },
        summary: { type: 'string', maxLength: 2000 },
        summaryLayer: { type: 'integer', minimum: 0, maximum: 4, description: 'Progressive Summarization layer 0-4' },
        summaryHighlights: { type: 'array', maxItems: 12, items: { type: 'object', properties: { text: { type: 'string', maxLength: 600 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['text'] } },
        keyPoints: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        openQuestions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        nextActions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        desiredOutcome: { type: 'string', maxLength: 1000, description: 'Observable outcome for any actionable note' }, projectPurpose: { type: 'string', maxLength: 1000, description: 'Project-only purpose; use desiredOutcome for actionable non-project notes' }, projectSupport: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 30, description: 'Project-only planning support' }, taskContext: { type: 'string', maxLength: 300 }, dueAt: { type: 'string', description: 'ISO deadline, distinct from scheduledAt' }, scheduledAt: { type: 'string', description: 'ISO execution/calendar time' }, deferUntil: { type: 'string' }, serviceClass: organizationPropertySchema('service_class'), completionCriteria: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12, description: 'Observable conditions for considering the actionable work complete' }, startedAt: { type: 'string', description: 'Optional ISO time when work entered progress' }, blockedSince: { type: 'string', description: 'Optional ISO time when work became blocked' }, waitingSince: { type: 'string', description: 'Optional ISO time when work began waiting' }, completedAt: { type: 'string', description: 'Optional ISO time when work completed' },
        stableId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', maxLength: 80 }, canonicalPath: { type: 'string', maxLength: 500 }, recallPrompt: { type: 'string', maxLength: 1000 }, recallIntervalDays: { type: 'integer', minimum: 1, maximum: 3650 }, lastRecalledAt: { type: 'string' }, recallQuality: organizationPropertySchema('recall_quality'),
        retentionPolicy: organizationPropertySchema('retention_policy'), retentionEvent: organizationPropertySchema('retention_event'), retentionAt: { type: 'string' }, preserveUntil: { type: 'string' }, legalHold: { type: 'boolean' }, retentionReason: { type: 'string', maxLength: 1000 }, replacedBy: { type: 'string', maxLength: 500 },
        termStatus: organizationPropertySchema('term_status'), termReplacedBy: { type: 'string', maxLength: 500 }, preferredTerm: { type: 'string', maxLength: 300 }, disambiguation: { type: 'string', maxLength: 300 }, broaderTerms: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, relatedTerms: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, subjectTerms: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20 }, domain: { type: 'string', maxLength: 200 }, methods: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20 }, audience: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 12 }, retrievalCues: { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 8 }, useWhen: { type: 'string', maxLength: 1000 },
        reviewSnoozedUntil: { type: 'string', description: 'Temporarily omit this note from review queues until an ISO date/time' }, reviewSnoozeReason: { type: 'string', maxLength: 500 }, knowledgeRole: organizationPropertySchema('knowledge_role'), seeAlso: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, termScopeNote: { type: 'string', maxLength: 1000 }, termLanguage: { type: 'string', maxLength: 40 }, authorityScheme: { type: 'string', maxLength: 120 }, authorityId: { type: 'string', maxLength: 200 },
        taskStatus: organizationPropertySchema('task_status'),
        reviewPolicy: organizationPropertySchema('review_policy'),
        reviewOutcome: organizationPropertySchema('last_review_outcome'), reviewedBy: { type: 'string', maxLength: 200 }, reviewedAt: { type: 'string' }, reviewChecks: organizationPropertySchema('review_checks', { maxItems: 7 }), reviewOpenItems: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 8 }, reviewNote: { type: 'string', maxLength: 1000 }, interpretationStatus: organizationPropertySchema('interpretation_status'), epistemicStatus: { type: 'string', description: 'Kind-specific state, including planned/running/completed/failed/inconclusive/reproduced for experiment notes' },
        polarity: organizationPropertySchema('knowledge_polarity'),
        negativeType: organizationPropertySchema('negative_type'),
        attempted: { type: 'string', maxLength: 1200 }, observed: { type: 'string', maxLength: 1200 }, failureCondition: { type: 'string', maxLength: 1200 }, affectedScope: { type: 'string', maxLength: 500 }, reproduction: { type: 'string', maxLength: 1200 }, whyRejected: { type: 'string', maxLength: 1200 }, reusableLesson: { type: 'string', maxLength: 1200 }, replacementPath: { type: 'string', maxLength: 500 },
        relations: { type: 'object', description: 'Typed Obsidian link arrays, including tests, same_as, version_of, and refines' }, relationNotes: { type: 'object', description: 'Short rationale keyed by relation field' }, relationEvidence: { type: 'object', description: 'Up to four scope-safe evidence paths keyed by relation field' }, disposition: organizationPropertySchema('triage_disposition'), clarifiedBy: { type: 'string' }, clarifiedAt: { type: 'string' }, clarifyNote: { type: 'string', maxLength: 1000 }, targetPath: { type: 'string' },
        mocPurpose: { type: 'string', maxLength: 1000 }, mocScope: { type: 'string', maxLength: 500 }, mocQuestions: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, mocParent: { type: 'string', maxLength: 500 },
        focusHorizon: organizationPropertySchema('focus_horizon'), focusParent: { type: 'string', maxLength: 500 }, focusSupports: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 },
        waitingFor: { type: 'string', description: 'Optional person/event/resource this project is waiting for' },
        clearInapplicable: { type: 'boolean', default: false, description: 'After reviewing the reported list, remove only MCP-managed Properties whose appliesTo contract conflicts with the selected/current noteKind. Custom Properties, body text, evidence, stable identity, and retention metadata are preserved.' },
        expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'expectedRevision'] },
    },
    {
      name: 'read_wiki_projection',
      description: 'Read one Wiki note progressively. Start with summary or key_points, then request outline or one section/block with bounded nearby line context; full content is explicit and bounded. Returns the current revision so edits can use optimistic concurrency.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, view: { type: 'string', enum: [...WIKI_PROJECTION_VIEWS], default: 'summary', description: 'Use progressive for one bounded packet containing summary, selected passages, claims, and open questions.' },
        section: { type: 'string', description: 'Heading text when view=section' }, blockId: { type: 'string', maxLength: 100, description: 'Obsidian block ID (without the leading ^) when view=section' }, contextBefore: { type: 'integer', minimum: 0, maximum: 3, default: 1, description: 'Nearby lines before the selected heading/block' }, contextAfter: { type: 'integer', minimum: 0, maximum: 3, default: 1, description: 'Nearby lines after the selected heading/block' }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'get_wiki_impact_report',
      description: 'Find knowledge notes affected by missing or altered evidence, overdue review, or typed upstream revision/state changes since their publish/review baseline. Aliases and qualified paths are resolved conservatively, and a completed review refreshes the baseline so unchanged retired or disputed inputs do not reopen forever. This bounded report never rewrites or deletes notes.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_graph_health',
      description: 'Report broken links, orphan notes, empty MOCs, GTD focus problems, Zettelkasten connectivity gaps, typed relation meaning, high-degree graph hubs, knowledge usage, and same-title/alias duplicate candidates with bounded samples. Use it to repair navigation without creating a parallel index; never auto-merge or archive from this report.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_link_context_health',
      description: 'Find bounded links in durable Wiki notes whose surrounding line is too terse to explain the relationship. This is an advisory Zettelkasten quality signal; it returns line, heading, relation, and context, never rewrites notes, and does not require prose beside every valid link.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_moc_candidates',
      description: 'Suggest bounded MOC structure notes for knowledge that is not currently covered by a MOC. Suggestions include revision-stamped authored order, an Obsidian Markdown draft, destination collision state, and an optional notes.write plan, but never create or rewrite notes.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_organization_health',
      description: 'Return one bounded report for PARA, Zettelkasten, Properties, typed links, GTD focus alignment, and progressive knowledge organization issues. It reuses the live Wiki lint scan plus derived graph signals, never moves or deletes notes, and treats folders as filing aids rather than security boundaries.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_property_contract',
      description: 'Return the bounded MCPVault frontmatter contract before writing or repairing a note. The unfiltered response is a compact complete overview; pass exact names or one query to page through full descriptions, allowed values, and note-role applicability. Custom Properties remain allowed and this never scans or mutates notes.',
      inputSchema: { type: 'object', properties: {
        names: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 100 }, description: 'Exact managed Property names for a focused full-detail response; do not combine with query' },
        query: { type: 'string', maxLength: 100, description: 'Case-insensitive match over Property name, description, allowed values, and appliesTo roles; do not combine with names' },
        offset: { type: 'integer', minimum: 0, maximum: 500, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 40, default: 12 },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_property_migration_preview',
      description: 'Preview a bounded Obsidian Property rename and/or scalar value mapping across visible notes. Returns exact revision-stamped notes.change_set inputs plus collisions and contract violations, but never writes. Apply in batches by dry-running the returned change set, confirming its plan fingerprint, then requesting the next batch.',
      inputSchema: { type: 'object', properties: {
        fromProperty: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]{0,99}$', description: 'Existing top-level Property name' },
        toProperty: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]{0,99}$', description: 'Destination name; omit for value-only migration' },
        valueMap: { type: 'object', description: 'Optional exact scalar mapping. List values are mapped element by element; unmapped values remain unchanged.' },
        pathPrefix: { type: 'string', description: 'Optional authorized subtree to scan' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 10, description: 'Maximum executable changes and blocked examples returned' },
        scanLimit: { type: 'integer', minimum: 1, maximum: 20000, default: 5000, description: 'Maximum metadata rows inspected in one bounded pass' },
        maxChars: { type: 'integer', minimum: 4096, maximum: 20000, default: 12000 }, accessToken, prettyPrint,
      }, required: ['fromProperty'] },
    },
    {
      name: 'get_wiki_moc_order_preview',
      description: 'Preview one complete root or child-MOC sibling order and return exact revision-stamped notes.change_set inputs for nav_order. It refuses partial sibling lists, broken parent hierarchies, unsafe scopes, and plans needing more than ten atomic edits; links authored inside a MOC body keep their Markdown order.',
      inputSchema: { type: 'object', properties: {
        orderedMocs: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1 }, description: 'Every current sibling MOC path exactly once, in the desired order' },
        parentPath: { type: 'string', description: 'Exact parent MOC path; omit to order all valid root MOCs' },
        startAt: { type: 'integer', minimum: 0, maximum: 1000000, default: 10 },
        step: { type: 'integer', minimum: 1, maximum: 100000, default: 10 },
        maxChars: { type: 'integer', minimum: 4096, maximum: 20000, default: 12000 }, accessToken, prettyPrint,
      }, required: ['orderedMocs'] },
    },
    {
      name: 'get_wiki_hierarchy_change_preview',
      description: 'Preview setting or clearing one explicit MOC or GTD focus parent. It simulates the visible branch, rejects MOC cycles and broken ancestors, requires focus_parent to point strictly upward across focus horizons, and returns one revision-stamped notes.change_set edit.',
      inputSchema: { type: 'object', properties: {
        hierarchy: { type: 'string', enum: ['moc', 'focus'], description: 'moc manages moc_parent; focus manages focus_parent' },
        operation: { type: 'string', enum: ['set', 'clear'] },
        childPath: { type: 'string', description: 'Exact visible note whose parent edge is changing' },
        parentPath: { type: 'string', description: 'Exact visible parent; required for set and omitted for clear' },
        maxChars: { type: 'integer', minimum: 4096, maximum: 20000, default: 9000 }, accessToken, prettyPrint,
      }, required: ['hierarchy', 'operation', 'childPath'] },
    },
    {
      name: 'get_wiki_moc_membership_preview',
      description: 'Preview replacing one ordinary note\'s preferred primary_moc and complete contextual mocs list. Every target must be an exact visible note_kind:moc in a safe scope; canonical Obsidian wikilinks and the source revision are returned as one notes.change_set edit.',
      inputSchema: { type: 'object', properties: {
        notePath: { type: 'string', description: 'Exact visible ordinary note to place in one or more maps' },
        primaryMocPath: { type: 'string', description: 'Exact visible preferred MOC path' },
        additionalMocPaths: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1 }, description: 'Complete ordered contextual MOC set, excluding the primary MOC' },
        maxChars: { type: 'integer', minimum: 4096, maximum: 20000, default: 9000 }, accessToken, prettyPrint,
      }, required: ['notePath', 'primaryMocPath'] },
    },
    {
      name: 'get_wiki_relation_set_preview',
      description: 'Preview replacing one directional typed-relation or focus_supports Property with a complete exact target set. It resolves and canonicalizes every visible target, rejects self/scope/kind/horizon errors, and returns one revision-stamped notes.change_set edit. Use wiki.reciprocal_link for related, same_as, or close_match.',
      inputSchema: { type: 'object', properties: {
        sourcePath: { type: 'string', description: 'Exact visible ordinary note whose relation list is being replaced' },
        relation: { type: 'string', enum: [...RELATION_FIELDS.filter(field => !(RECIPROCAL_RELATIONS as readonly string[]).includes(field)), 'focus_supports'], description: 'Directional typed relation or focus_supports; use the reciprocal planner for related/same_as/close_match' },
        targetPaths: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1 }, description: 'Complete ordered exact target-note set; pass [] to clear the Property' },
        maxChars: { type: 'integer', minimum: 4096, maximum: 20000, default: 9000 }, accessToken, prettyPrint,
      }, required: ['sourcePath', 'relation', 'targetPaths'] },
    },
    {
      name: 'get_wiki_reciprocal_link_preview',
      description: 'Preview a coherent two-note related, same_as, or close_match relation. It resolves every existing link, rejects malformed/ambiguous values and scope leaks, and returns one revision-stamped notes.change_set so a mutual relation cannot be left half-written.',
      inputSchema: { type: 'object', properties: {
        leftPath: { type: 'string', description: 'Exact first visible note path' },
        rightPath: { type: 'string', description: 'Exact second visible note path' },
        relation: { type: 'string', enum: [...RECIPROCAL_RELATIONS] },
        maxChars: { type: 'integer', minimum: 4096, maximum: 20000, default: 8000 }, accessToken, prettyPrint,
      }, required: ['leftPath', 'rightPath', 'relation'] },
    },
    {
      name: 'get_wiki_lifecycle_transition_preview',
      description: 'Preview one coherent retirement or reactivation of a visible knowledge note. It checks legal preservation, scope-safe reference impact, replacement lineage, and exact revisions, then returns an atomic notes.change_set without writing, moving, deleting, or committing.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Exact visible ordinary knowledge-note path' },
        operation: { type: 'string', enum: ['archive', 'supersede', 'tombstone', 'reactivate'] },
        reason: { type: 'string', minLength: 1, maxLength: 1000, description: 'Why this lifecycle transition is being proposed; Git remains the authoritative change history' },
        replacementPath: { type: 'string', description: 'Exact visible successor path for supersede/replacement tombstones, or the current successor whose reverse edge must be removed during reactivation' },
        targetLifecycle: { type: 'string', enum: ['active', 'review', 'evergreen'], default: 'review', description: 'Reactivation destination; review is the conservative default' },
        nextKnowledgeStatus: { type: 'string', enum: ['draft', 'verified', 'disputed'], description: 'Required to reactivate a note whose knowledge_status is superseded; the planner never infers epistemic quality' },
        maxChars: { type: 'integer', minimum: 4096, maximum: 20000, default: 10000 }, accessToken, prettyPrint,
      }, required: ['path', 'operation', 'reason'] },
    },
    {
      name: 'get_wiki_note_template',
      description: 'Return a small optional Obsidian Markdown/Properties scaffold for a common note kind or a concept, argument, model, observation, or counterargument knowledge role. It never creates a file and never makes templates mandatory.',
      inputSchema: { type: 'object', properties: {
        noteKind: { type: 'string', enum: [...NOTE_TEMPLATE_IDS], default: 'atomic', description: 'Template ID; role templates still use ordinary atomic/knowledge notes plus knowledge_role' },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_bases_view',
      description: 'Return a bounded, optional Obsidian Bases YAML view for visible Wiki notes, including decisions, any-note action candidates, and focused concept, argument, model, observation, and counterargument shelves. This exports a local view definition only; it is not an MCP permission boundary and does not write a file.',
      inputSchema: { type: 'object', properties: {
        view: { type: 'string', enum: [...BASES_VIEW_IDS], default: 'all', description: 'Optional standard Obsidian Bases projection' },
        noteKind: { type: 'string', description: 'Optional exact note_kind filter' },
        lifecycle: { type: 'string', description: 'Optional exact lifecycle filter' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 12000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'export_wiki_base',
      description: 'Save one bounded Obsidian Bases view as a derived Views/*.base file. This is an explicit mutation, limited to a single file directly under Views/, and requires expectedRevision (use missing for a new file); it never changes note content or permissions.',
      inputSchema: { type: 'object', properties: {
        view: { type: 'string', enum: [...BASES_VIEW_IDS], default: 'all' },
        path: { type: 'string', description: 'Optional single Views/*.base path; defaults to the view suggestedPath' },
        noteKind: { type: 'string' }, lifecycle: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 12000 },
        expectedRevision: { type: 'string', description: "Required file revision; use 'missing' for a new Bases file" }, accessToken, prettyPrint,
      }, required: ['expectedRevision'] },
    },
    {
      name: 'get_wiki_canvas_view',
      description: 'Preview one visible note as a bounded Obsidian JSON Canvas 1.0 spatial map without copying note bodies. MOCs preserve authored order, nesting, and prerequisite edges; ordinary notes place direct links/backlinks closest, shared provenance/context next, and optional semantic/temporal discoveries farthest away. The result is a disposable navigation projection with exact source revisions, not evidence or an access boundary.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Visible Markdown/text root note' },
        mode: { type: 'string', enum: ['auto', 'moc', 'neighborhood'], default: 'auto', description: 'auto uses MOC layout for note_kind=moc and neighborhood layout otherwise' },
        maxDepth: { type: 'integer', minimum: 0, maximum: 6, default: 2, description: 'Nested MOC depth in moc mode' },
        includeSemantic: { type: 'boolean', default: false, description: 'Add optional semantic discovery only in neighborhood mode; lexical links and scope rules remain authoritative' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 24, description: 'Maximum file nodes including the root' },
        maxChars: { type: 'integer', minimum: 2048, maximum: 24000, default: 12000 },
        accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'export_wiki_canvas',
      description: 'Regenerate and save one validated scope-local Views/*.canvas file from the current MOC or neighborhood. Requires a Canvas file revision (use missing when new), optionally guards the root revision, rechecks every included source before writing, and never copies note bodies or changes authoritative Markdown.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Visible Markdown/text root note' },
        mode: { type: 'string', enum: ['auto', 'moc', 'neighborhood'], default: 'auto' },
        maxDepth: { type: 'integer', minimum: 0, maximum: 6, default: 2 },
        includeSemantic: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 24 },
        maxChars: { type: 'integer', minimum: 2048, maximum: 24000, default: 12000 },
        outputPath: { type: 'string', description: 'Optional single Views/*.canvas path in the same scope as the root; defaults to the preview suggestedPath' },
        expectedSourceRevision: { type: 'string', pattern: '^[a-fA-F0-9]{64}$', description: 'Optional root revision returned by the preview' },
        expectedRevision: { type: 'string', description: "Required Canvas file revision; use 'missing' for a new file" },
        accessToken, prettyPrint,
      }, required: ['path', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_canvas_health',
      description: 'Inspect scope-visible Views/*.canvas files for bounded MCPVault snapshot metadata, current source revisions, missing sources, malformed managed graphs, and scope violations. User-authored Canvases without MCPVault metadata remain valid unmanaged artifacts. This advisory view never rewrites a Canvas or its source notes.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_home',
      description: 'Return a bounded live launchpad and intent router for the current scope: one recommended next action, exact existing endpoint routes for find/capture/organize/decide/execute/review/repair/migrate, and revision-stamped MOCs, Projects/Tasks, all/current actionable-work counts, Inbox, review items, and stable IDs. Choose one route; do not call every dashboard. This is a derived Home/JDex-style view, never a second index or an access boundary.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'preflight_wiki_publish',
      description: 'Compare a proposed Wiki note with existing accessible notes and return bounded possible duplicates or related notes. This is advisory and never blocks publication.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, accessToken, prettyPrint,
      }, required: ['path', 'content'] },
    },
    {
      name: 'get_wiki_source_trust',
      description: 'List bounded source snapshots with citation metadata, capture-time trust level, reason, integrity, and evidence usage. Trust is advisory metadata; an intact hash and inspectable provenance remain required.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_citation_graph',
      description: 'Return a bounded source-to-knowledge citation graph from evidence_paths, evidence locators, and references. It highlights heavily reused and orphaned sources without creating a second provenance database.',
      inputSchema: { type: 'object', properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        maxChars: { type: 'integer', minimum: 1024, maximum: 20000, default: 8000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_source_lineage',
      description: 'Group immutable source snapshots into bounded work/edition lineages. It uses sourceWorkId/sourceEditionId when present and remains compatible with sourceFamily/sourceVersion; source IDs, hashes, and revisions remain authoritative.',
      inputSchema: { type: 'object', properties: { sourceFamily: { type: 'string', maxLength: 160, description: 'Optional work/family filter' }, limit: { type: 'integer', minimum: 1, maximum: 60, default: 20 }, maxChars: { type: 'integer', minimum: 1024, maximum: 20000, default: 8000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_archive_finding_aid',
      description: 'Browse immutable source snapshots by archival collection, broad-to-narrow series, accession, and original order. Without a filter it returns a bounded collection overview; pass collectionId and optionally a series prefix for revision-stamped rows and order conflicts. It is metadata-only and never moves files or replaces MOCs, source hashes, or Git.',
      inputSchema: { type: 'object', properties: {
        collectionId: { type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$', description: 'Optional stable archive_collection_id drill-down' },
        series: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 160 }, description: 'Optional broad-to-narrow archive_series prefix' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 9000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_organization_manifest',
      description: 'Return a bounded portable organization contract for PARA, Obsidian syntax, Properties, relations, lifecycle, and migration. Set includeReadiness to add only global path/revision/identity/shape metadata and detect local drift, collisions, and missing relation targets; Community, private scopes, bodies, sessions, and caches are excluded. Pass another bounded manifest as compareManifest plus its expected fingerprint for a non-mutating destination compatibility preview.',
      inputSchema: { type: 'object', properties: {
        includeReadiness: { type: 'boolean', default: false, description: 'Scan only portable global metadata; never includes note bodies, Community, private scopes, sessions, whispers, or caches' },
        compareManifest: { type: 'object', description: 'Optional counterpart organization manifest returned by this endpoint; limited to 128000 serialized characters' },
        expectedCounterpartFingerprint: { type: 'string', pattern: '^[a-fA-F0-9]{64}$', description: 'Optional revision guard for the compared contract' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30, description: 'Maximum readiness issues and metadata inventory rows' },
        maxChars: { type: 'integer', minimum: 2048, maximum: 24000, default: 14000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_promotion_candidates',
      description: 'Return bounded community posts that may deserve promotion into durable Wiki knowledge. This is an advisory candidate list; an agent must verify the post, preserve provenance, and publish a separate knowledge note.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_synthesis_candidates',
      description: 'Find bounded authored clusters of durable notes that may merit a model, argument, or decision synthesis. It groups by one explicit primary MOC/moc, project, domain, or subject term; returns current input revisions, counterpoints, existing-synthesis coverage, and a revision-safe non-mutating plan. Coverage and contradiction links use the same visible path/title/alias/preferred-term/stable-ID/relative-path resolver as the graph. It never clusters by folder/vector similarity, merges originals, guesses ambiguity, or treats synthesis as truth.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 }, maxChars: { type: 'integer', minimum: 768, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_summary_candidates',
      description: 'Find bounded knowledge notes missing a compact summary or too long for progressive reads, and return a candidate summary for an agent to verify and write.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_unused_knowledge',
      description: 'Suggest bounded review actions for knowledge notes older than a threshold with weak incoming links or references. It never archives or deletes anything automatically.',
      inputSchema: { type: 'object', properties: { olderThanDays: { type: 'integer', minimum: 1, maximum: 3650, default: 180 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_retention_queue',
      description: 'Return a bounded preservation and disposition queue for knowledge notes with retention metadata or an overdue retention review. It distinguishes preserve, legal hold, review, archive, and tombstone candidates; it never deletes or archives automatically.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'resurface_wiki_knowledge',
      description: 'Return a small deterministic rotating set of durable notes for Zettelkasten-style serendipitous rediscovery. An optional context/problem signal makes retrieval cues and use_when metadata influence the bounded ranking. Read selected notes before relying on them; this is a derived view and never mutates files.',
      inputSchema: { type: 'object', properties: { context: { type: 'string', maxLength: 1000, description: 'Optional current task, question, or problem signal used only to rank retrieval cues' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 5000 }, accessToken, prettyPrint } },
    },
    {
      name: 'resurface_wiki_archives',
      description: 'Find a bounded set of archived or superseded notes that are still referenced by current visible notes. It supports “forget without deleting” while never restoring, moving, or deleting anything automatically.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 5000 }, accessToken, prettyPrint } },
    },
    {
      name: 'update_wiki_projection',
      description: 'Advance only the compact Progressive Summarization projection of an existing note. Updates summary/key_points/open_questions/highlights with an expectedRevision, preserves the full Markdown body and unrelated Properties, and refreshes the body fingerprint; it never rewrites the body.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, summary: { type: 'string', maxLength: 2000 }, keyPoints: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 }, openQuestions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 }, summaryLayer: { type: 'integer', minimum: 0, maximum: 4 }, summaryHighlights: { type: 'array', maxItems: 12, items: { type: 'object', properties: { text: { type: 'string', maxLength: 600 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['text'] } }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'expectedRevision'] },
    },
    {
      name: 'lint_wiki',
      description: 'Deterministically check accessible Wiki sources, evidence grounding, integrity hashes, and broken wikilinks.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 }, accessToken, prettyPrint } },
    },
    {
      name: 'report_wiki_issue',
      description: 'Add a durable Error Book entry for a contradiction, unsupported claim, stale knowledge, broken link, or missing context.',
      inputSchema: { type: 'object', properties: {
        scopeUri, issueId: { type: 'string' }, kind: { type: 'string', enum: [...ISSUE_KINDS] },
        title: { type: 'string' }, description: { type: 'string' }, subjectPath: { type: 'string' }, evidencePaths: { type: 'array', items: { type: 'string' } },
        reportedBy: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['kind', 'title', 'description'] },
    },
    {
      name: 'propose_wiki_term_change',
      description: 'Create a Git-visible authority-control proposal for renaming or deprecating a term. Records current term, proposed preferred term, rationale, and affected note without renaming, redirecting, or rewriting any links automatically; resolve the proposal only after reviewing its impact.',
      inputSchema: { type: 'object', properties: {
        currentTerm: { type: 'string', maxLength: 300 }, proposedTerm: { type: 'string', maxLength: 300 }, rationale: { type: 'string', maxLength: 1200 }, affectedPath: { type: 'string' }, reportedBy: { type: 'string', maxLength: 200 }, scopeUri, accessToken, prettyPrint,
      }, required: ['currentTerm', 'proposedTerm', 'rationale'] },
    },
    {
      name: 'resolve_wiki_issue',
      description: 'Resolve an Error Book entry with attribution, reason, and optimistic concurrency protection.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, actor: { type: 'string' }, resolution: { type: 'string' }, resolutionStatus: organizationPropertySchema('issue_resolution_status'), retrospectiveStatus: organizationPropertySchema('issue_retrospective_status'), retrospective: { type: 'string', maxLength: 1200 }, followUpPaths: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'resolution', 'expectedRevision'] },
    },
  ];
}
