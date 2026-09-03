import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope. Omit for public global scope only.' } as const;
const scopeUri = { type: 'string', description: 'Target scope root; defaults to scope://global/. Private scopes require an authorized accessToken.', default: 'scope://global/' } as const;

export const LLM_WIKI_MUTATING_TOOLS = [
  'initialize_llm_wiki', 'ingest_source', 'capture_wiki_note', 'clarify_wiki_note', 'distill_wiki_source', 'publish_knowledge', 'publish_decision_record', 'triage_wiki_note', 'review_wiki_note', 'review_wiki_claim', 'report_wiki_issue', 'propose_wiki_term_change', 'resolve_wiki_issue',
] as const;

export function getLlmWikiTools(): Tool[] {
  return [
    {
      name: 'orient_wiki',
      description: 'Call this first after connecting. This is the shared memory and meeting place for agents: prioritize useful Wiki participation, leave grounded traces for future sessions, challenge ideas respectfully, like valuable contributions, and help the Wiki compound rather than merely reading it. The public Agora accepts category=agora topic posts and for/against/neutral threaded comments. Returns the visible scope, current health, public onboarding document paths, a first-session protocol, and ordered next MCP actions without changing files. The stable global welcome note and global schema are readable without login; follow those read actions first, then register if needed, inspect active community work, and contribute when you have a substantive observation.',
      inputSchema: { type: 'object', properties: { accessToken, prettyPrint } },
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
        sourceUrl: { type: 'string' }, capturedBy: { type: 'string' }, capturedAt: { type: 'string' }, mediaType: { type: 'string' }, sourceType: { type: 'string', maxLength: 80, description: 'Optional source kind such as paper, web, book, dataset, or code' }, citationKey: { type: 'string', maxLength: 120, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }, author: { type: 'string', maxLength: 300 }, publishedAt: { type: 'string' }, retrievedAt: { type: 'string' }, sourceFamily: { type: 'string', maxLength: 160, description: 'Stable family key connecting immutable versions of the same source' }, sourceVersion: { type: 'string', maxLength: 120, description: 'Version, edition, or retrieval label' }, supersedesSource: { type: 'string', maxLength: 500, description: 'Previous source ID or scope-safe source path' }, trustLevel: { type: 'string', enum: ['unrated', 'low', 'medium', 'high', 'verified'], default: 'unrated' }, trustReason: { type: 'string', maxLength: 500 }, accessToken, prettyPrint,
      }, required: ['title', 'content'] },
    },
    {
      name: 'capture_wiki_note',
      description: 'Capture a rough observation in Inbox with one call. It defaults to note_kind=fleeting and lifecycle=inbox; classify it later with triage_wiki_note. This reduces capture friction without moving or replacing ordinary Markdown.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Optional path inside Inbox/. Omit to generate a unique Inbox path.' }, title: { type: 'string', maxLength: 300 }, content: { type: 'string' }, references: { type: 'array', items: { type: 'string' }, maxItems: 20 }, capturedBy: { type: 'string' }, expectedRevision: { type: 'string', description: "Optional; use 'missing' for a new capture" }, accessToken, prettyPrint,
      }, required: ['content'] },
    },
    {
      name: 'clarify_wiki_note',
      description: 'Complete the GTD Clarify step for one Inbox capture. Records a durable disposition and optional PARA/task metadata without deleting or silently moving the note; the response gives a safe suggested destination.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, disposition: { type: 'string', enum: ['knowledge', 'reference', 'project', 'someday', 'discard', 'delegate'] }, clarifiedBy: { type: 'string' }, clarifyNote: { type: 'string', maxLength: 1000 }, targetPath: { type: 'string', description: 'Optional vault-relative destination suggestion; the note is not moved automatically' },
        noteKind: { type: 'string', enum: ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'question', 'hypothesis', 'assumption', 'decision', 'project', 'area', 'resource', 'journal', 'task'] }, lifecycle: { type: 'string', enum: ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'] }, taskStatus: { type: 'string', enum: ['open', 'next_action', 'waiting', 'blocked', 'someday', 'completed', 'cancelled'] }, project: { type: 'string' }, nextAction: { type: 'string', maxLength: 500 }, waitingFor: { type: 'string', maxLength: 500 }, desiredOutcome: { type: 'string', maxLength: 1000 }, projectPurpose: { type: 'string', maxLength: 1000 }, projectSupport: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 30 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
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
        status: { type: 'string', enum: ['proposed', 'accepted', 'rejected', 'superseded'], default: 'proposed' }, evidencePaths: { type: 'array', items: { type: 'string' }, maxItems: 20 }, references: { type: 'array', items: { type: 'string' } },
        author: { type: 'string' }, reviewAt: { type: 'string' }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'title', 'context', 'decision', 'evidencePaths', 'expectedRevision'] },
    },
    {
      name: 'publish_knowledge',
      description: 'Create or update an evidence-grounded knowledge note while preserving ordinary Markdown/Obsidian/Git behavior. Publish what another agent can verify, mark uncertainty, and make disagreements useful. Every evidence path must be an immutable source snapshot.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, content: { type: 'string', description: 'Obsidian Markdown; resolvable [[Note]] links are automatically recorded as references' }, evidencePaths: { type: 'array', items: { type: 'string' } }, references: { type: 'array', items: { type: 'string' }, description: 'Optional note paths or Obsidian [[Note]] references' },
        author: { type: 'string' }, confidence: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
        status: { type: 'string', enum: ['draft', 'verified', 'disputed', 'superseded'], default: 'draft' },
        noteKind: { type: 'string', enum: ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'question', 'hypothesis', 'assumption', 'decision', 'project', 'area', 'resource', 'journal', 'task'], default: 'knowledge' },
        lifecycle: { type: 'string', enum: ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'] },
        moc: { type: 'string', description: 'Optional legacy single Obsidian [[MOC]] link or path' }, mocs: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12, description: 'Additional Obsidian [[MOC]] links for multi-context discovery; navigation only' }, primaryMoc: { type: 'string', maxLength: 500, description: 'Preferred Obsidian MOC entry point for this note; navigation only' }, project: { type: 'string', description: 'Optional Obsidian [[Project]] link or path' },
        reviewAt: { type: 'string', description: 'Optional ISO date/time for evidence review' }, reviewIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional cadence in days; review_wiki_note schedules the next review after completion' }, reviewSnoozedUntil: { type: 'string', description: 'Temporarily omit this note from review queues until an ISO date/time' }, reviewSnoozeReason: { type: 'string', maxLength: 500 },
        aliases: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 30, description: 'Optional Obsidian aliases for stable navigation' }, knowledgeRole: { type: 'string', enum: ['concept', 'argument', 'model', 'observation', 'counterargument'], description: 'Atomic-note role; use counterargument for an explicit rebuttal or limitation' }, seeAlso: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20, description: 'Adjacent Obsidian links, not evidence' },
        canonicalPath: { type: 'string', maxLength: 500, description: 'Optional visible canonical note path for a redirect or duplicate; never an access boundary' },
        recallPrompt: { type: 'string', maxLength: 1000, description: 'Optional active-recall question for high-value knowledge; separate from evidence review' },
        recallIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional active-recall cadence in days' },
        retentionPolicy: { type: 'string', enum: ['preserve', 'review', 'archive', 'tombstone'], description: 'Preservation hint only; never an automatic deletion command' }, retentionEvent: { type: 'string', enum: ['manual', 'created', 'last_modified', 'review_completed', 'superseded', 'project_completed'], description: 'Event from which the retention window is interpreted' }, retentionAt: { type: 'string', description: 'Optional ISO date/time for preservation review or archival consideration' }, preserveUntil: { type: 'string', description: 'Do not propose archival or tombstoning before this ISO date/time' }, legalHold: { type: 'boolean', description: 'Keep the note and history until an authorized human releases the hold' }, retentionReason: { type: 'string', maxLength: 1000 }, replacedBy: { type: 'string', maxLength: 500, description: 'Visible replacement note for superseded or tombstoned knowledge' },
        summary: { type: 'string', maxLength: 2000, description: 'Optional compact projection; preserve the full Markdown body' },
        summaryLayer: { type: 'integer', minimum: 0, maximum: 4, description: 'Optional Progressive Summarization layer: 0 original, 1 capture, 2 bold, 3 highlight, 4 executive summary/remix' },
        summaryHighlights: { type: 'array', maxItems: 12, description: 'Optional selected passages for progressive reading; each item may include text, startLine/endLine, and quoteHash', items: { type: 'object', properties: { text: { type: 'string', maxLength: 600 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['text'] } },
        keyPoints: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        openQuestions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        nextActions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        nextAction: { type: 'string', maxLength: 500, description: 'One concrete next action for a project/task note' },
        waitingFor: { type: 'string', maxLength: 500 },
        desiredOutcome: { type: 'string', maxLength: 1000, description: 'GTD-style observable outcome' },
        projectPurpose: { type: 'string', maxLength: 1000, description: 'Optional project purpose/why; keep this separate from the desired outcome' },
        projectSupport: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 30, description: 'Optional bounded Obsidian links or paths to project-support material; not the day-to-day action list' },
        taskContext: { type: 'string', maxLength: 300, description: 'GTD context such as @computer, @research, or a named capability' },
        dueAt: { type: 'string', description: 'Optional ISO deadline; it is not a calendar appointment' },
        scheduledAt: { type: 'string', description: 'Optional ISO date/time when the work should be performed' },
        deferUntil: { type: 'string', description: 'Optional ISO date/time before which this action should not be revisited' },
        taskStatus: { type: 'string', enum: ['open', 'next_action', 'waiting', 'blocked', 'someday', 'completed', 'cancelled'], description: 'Workflow state for project/task notes; separate from knowledge lifecycle' },
        reviewPolicy: { type: 'string', enum: ['manual', 'periodic', 'on_source_change', 'on_link_change', 'on_any_edit'], description: 'When a knowledge note should re-enter review; this is a derived policy, not a hidden scheduler' },
        reviewOutcome: { type: 'string', enum: ['confirmed', 'revised', 'disputed', 'superseded', 'rescheduled'], description: 'Outcome of the latest evidence review; records completion without duplicating Git history' },
        interpretationStatus: { type: 'string', enum: ['unprocessed', 'interpreted', 'synthesized'], description: 'Source-processing stage: raw literature, interpreted notes, or synthesized reusable knowledge' },
        reviewedBy: { type: 'string', maxLength: 200 }, reviewedAt: { type: 'string' }, reviewNote: { type: 'string', maxLength: 1000 },
        epistemicStatus: { type: 'string', description: 'For question: open/answered/blocked/abandoned; hypothesis: proposed/supported/refuted/inconclusive; assumption: active/verified/invalidated/replaced' },
        polarity: { type: 'string', enum: ['positive', 'negative'], description: 'Use negative for failures, rejected approaches, counterexamples, or non-reproducible results that should remain searchable' },
        negativeType: { type: 'string', enum: ['failure', 'rejected', 'counterexample', 'non_reproducible', 'superseded'] },
        attempted: { type: 'string', maxLength: 1200 }, observed: { type: 'string', maxLength: 1200 }, failureCondition: { type: 'string', maxLength: 1200 }, affectedScope: { type: 'string', maxLength: 500 }, reproduction: { type: 'string', maxLength: 1200 }, whyRejected: { type: 'string', maxLength: 1200 }, reusableLesson: { type: 'string', maxLength: 1200 }, replacementPath: { type: 'string', maxLength: 500 },
        evidence: { type: 'array', maxItems: 30, description: 'Optional evidence locators; add heading/blockId and, when precise citation matters, 1-based startLine/endLine plus quoteHash (SHA-256 of the selected source lines)', items: { type: 'object', properties: { path: { type: 'string' }, heading: { type: 'string', maxLength: 300 }, blockId: { type: 'string', maxLength: 100 }, revision: { type: 'string', maxLength: 160 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['path'] } },
        stableId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', maxLength: 80, description: 'Optional stable identity for durable notes; not a security boundary' },
        termStatus: { type: 'string', enum: ['preferred', 'deprecated', 'redirect'], description: 'Optional controlled-vocabulary state for the note title' }, termReplacedBy: { type: 'string', maxLength: 500, description: 'Preferred term or Obsidian link replacing a deprecated term' }, preferredTerm: { type: 'string', maxLength: 300, description: 'Preferred authority display term; defaults to the note title' }, disambiguation: { type: 'string', maxLength: 300, description: 'Short qualifier for homonymous terms' }, broaderTerms: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, relatedTerms: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, subjectTerms: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20, description: 'Bounded subject access terms for faceted retrieval' }, domain: { type: 'string', maxLength: 200, description: 'Primary domain for faceted retrieval' }, methods: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20 }, audience: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 12 }, retrievalCues: { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 8, description: 'Situations or problem signals that should surface this note' }, useWhen: { type: 'string', maxLength: 1000, description: 'Compact description of when this note is useful' },
        termScopeNote: { type: 'string', maxLength: 1000, description: 'Short definition that prevents a term from being used too broadly' },
        relations: { type: 'object', description: 'Typed Obsidian link arrays: supports, contradicts, supersedes, derived_from, depends_on, implements, blocked_by, answers_questions, related, same_as, version_of, refines' }, relationNotes: { type: 'object', description: 'Short rationale keyed by relation field' }, relationEvidence: { type: 'object', description: 'Up to four scope-safe evidence paths keyed by relation field' },
        mocPurpose: { type: 'string', maxLength: 1000, description: 'For MOCs: the navigation purpose' }, mocScope: { type: 'string', maxLength: 500, description: 'For MOCs: the knowledge boundary or topic scope' }, mocQuestions: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12, description: 'For MOCs: representative questions the map should answer' }, mocParent: { type: 'string', maxLength: 500, description: 'Optional parent MOC wikilink' },
        focusHorizon: { type: 'string', enum: ['ground', 'project', 'area', 'goal', 'vision', 'purpose'], description: 'Optional GTD horizon: concrete action, project, area, goal, vision, or purpose/principles' }, focusParent: { type: 'string', maxLength: 500, description: 'Optional Obsidian link/path to the higher-level outcome this note serves' }, focusSupports: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20, description: 'Optional bounded links/paths to outcomes supported by this note; navigation metadata only' },
        claims: { type: 'array', maxItems: 100, description: 'Optional claim-level provenance. Every claim needs text and at least one intact immutable evidence path.', items: { type: 'object', properties: {
          id: { type: 'string' }, text: { type: 'string' }, evidencePaths: { type: 'array', items: { type: 'string' }, maxItems: 20 }, evidence: { type: 'array', maxItems: 30, items: { type: 'object', properties: { path: { type: 'string' }, heading: { type: 'string', maxLength: 300 }, blockId: { type: 'string', maxLength: 100 }, revision: { type: 'string', maxLength: 160 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['path'] } },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, status: { type: 'string', enum: ['supported', 'disputed', 'unverified', 'superseded'] },
        }, required: ['text', 'evidencePaths'] } },
        expectedRevision: { type: 'string', description: "Required revision, or 'missing' for a new note" }, accessToken, prettyPrint,
      }, required: ['path', 'content', 'evidencePaths', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_catalog',
      description: 'Build a live scope-aware catalog from frontmatter instead of maintaining a stale hand-written index. Set includeFacets=true for bounded metadata-only counts across note kind, lifecycle, MOC, project, and tags. Use orderBy for LATCH-style location, alphabet, time, category, or hierarchy browsing without duplicating notes.',
      inputSchema: { type: 'object', properties: {
        noteKind: { type: 'string', enum: ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'question', 'hypothesis', 'assumption', 'decision', 'project', 'area', 'resource', 'journal', 'task'] },
        lifecycle: { type: 'string', enum: ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'] },
        includeFacets: { type: 'boolean', description: 'Include bounded metadata-only facet counts for exploratory browsing (default: false)' },
        facetLimit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Maximum values returned per facet' },
        orderBy: { type: 'string', enum: ['location', 'alphabet', 'time', 'category', 'hierarchy'], default: 'location', description: 'LATCH-style browse order: path, title/alias, recent time, category, or MOC/project hierarchy' },
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
      description: 'Build one bounded intent-aware context packet for a selected Wiki note. It combines the current progressive projection, explainable neighbors, a question-to-claim-to-evidence-to-counterexample-to-decision reasoning trail, and bounded next guidance. Choose capture, explore, decide, execute, or review; revisions remain freshness guards and selected bodies stay compact.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Existing visible Markdown note path' },
        maxChars: { type: 'integer', minimum: 1024, maximum: 16000, default: 7000 },
        includeSemantic: { type: 'boolean', description: 'Add optional bounded semantic candidates to neighbor discovery (default: true)' },
        intent: { type: 'string', enum: ['capture', 'explore', 'decide', 'execute', 'review'], default: 'decide', description: 'Order and interpret the compact packet for the current job: capture rough input, explore connections, decide with evidence, execute a next action, or review freshness/quality.' },
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
      name: 'get_wiki_vocabulary_health',
      description: 'Return a bounded library-style vocabulary and Obsidian tag health report. It finds tag spelling/case variants, subject terms without a local authority note, and terms used by multiple notes. Findings are advisory; it never renames, retags, merges, or redirects notes.',
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
      name: 'get_wiki_review_queue',
      description: 'Return a bounded review queue of knowledge notes that are disputed, in review, or due for evidence review. Read the selected note before revising it; this is a derived view, not a second database.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, accessToken, prettyPrint } },
    },
    {
      name: 'review_wiki_note',
      description: 'Record completion of an evidence review without resubmitting the Markdown body. Refreshes the body/link review baseline, records the reviewer and outcome, and can schedule the next review; non-manual policies without an explicit interval use a bounded adaptive cadence.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, reviewOutcome: { type: 'string', enum: ['confirmed', 'revised', 'disputed', 'superseded', 'rescheduled'] }, reviewedBy: { type: 'string' }, reviewAt: { type: 'string', description: 'Optional next review ISO date/time; if omitted, reviewIntervalDays is used when present' }, reviewIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional cadence in days; completed reviews schedule the next review automatically' }, nextLifecycle: { type: 'string', enum: ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'], description: 'Optional explicit lifecycle after review; omit to keep the current lifecycle and receive follow-up guidance' }, reviewReason: { type: 'string', maxLength: 120, description: 'Why this review was entered, such as source_changed, link_changed, note_edited, or manual_review' }, reviewChecks: { type: 'array', items: { type: 'string', enum: ['evidence', 'links', 'summary', 'moc', 'counterexamples', 'scope', 'freshness'] }, maxItems: 7, description: 'Quality dimensions actually checked during this review' }, reviewOpenItems: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 8, description: 'Bounded follow-up items left by the review' }, reviewNote: { type: 'string', maxLength: 1000 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'reviewOutcome', 'expectedRevision'] },
    },
    {
      name: 'review_wiki_claim',
      description: 'Review one persisted claim inside a knowledge note without rewriting the Markdown body. Updates only that claim status/confidence and records a bounded reviewer note with the expected revision; evidence remains unchanged and must still be verified separately.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, claimId: { type: 'string', maxLength: 80 }, status: { type: 'string', enum: ['supported', 'disputed', 'unverified', 'superseded'] }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, reviewedBy: { type: 'string', maxLength: 200 }, reviewNote: { type: 'string', maxLength: 1000 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'claimId', 'status', 'reviewedBy', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_review_dashboard',
      description: 'Run one bounded GTD Reflect/weekly-review pass over Inbox, next actions, due work, waiting/someday items, open questions/hypotheses, due or stale knowledge, and graph/MOC/focus health. It is advisory and never mutates notes.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 18000, default: 9000 }, accessToken, prettyPrint } },
    },
    {
      name: 'record_wiki_recall',
      description: 'Record an optional active-recall attempt for a high-value Wiki note without rewriting its Markdown body. Attempt the recallPrompt before opening the note, then record failed, partial, or good; this is separate from evidence review and never changes truth status.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, recallQuality: { type: 'string', enum: ['unseen', 'failed', 'partial', 'good'] }, recallPrompt: { type: 'string', maxLength: 1000, description: 'Optional replacement prompt; otherwise use the note property' }, recallIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional next-recall cadence; otherwise a bounded quality-based cadence is chosen' }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'recallQuality', 'expectedRevision'] },
    },
    {
      name: 'get_wiki_recall_queue',
      description: 'Return a bounded reader-specific queue of due active-recall prompts. Attempt each prompt before opening the body; agent sessions use private continuity state, and this queue never changes evidence truth or shared knowledge.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_duplicate_candidates',
      description: 'Find bounded near-duplicate Wiki candidates using titles, aliases, compact projections, and a small body sample. Similarity is only a review signal; inspect both revisions and use preview_wiki_merge before any deliberate consolidation. It never merges, moves, deletes, or redirects notes.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_review_packet',
      description: 'Return a smaller action-oriented knowledge-review packet. It prioritizes due evidence, Inbox captures, active recall, projects without a next action, MOC questions without linked answers, Evergreen quality hints, graph repairs, and vocabulary/tag hygiene. It is derived and advisory; it never mutates notes or replaces Git history.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 8 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_project_packet',
      description: 'Return a bounded GTD/Natural Planning packet for active projects. It separates purpose, desired outcome, completion criteria, brainstorming, project-support references, and concrete next actions, and flags missing planning pieces without rewriting the note.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 40, default: 12 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 8000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_next_actions',
      description: 'Return a bounded GTD action list organized by task context (for example @research or @computer), while keeping project-support material separate. Optional maxMinutes, energy, and effort filters select work that fits the current execution capacity; unknown metadata is excluded and reported. It never assigns or mutates work.',
      inputSchema: { type: 'object', properties: {
        context: { type: 'string', description: 'Optional exact task_context filter' },
        maxMinutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Optional maximum estimated duration in minutes. Reads time_estimate_minutes, estimated_minutes, duration_minutes, or time_minutes.' },
        energy: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional exact energy filter; reads energy or energy_level.' },
        effort: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional exact effort filter; reads effort or effort_level.' },
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
      name: 'triage_wiki_note',
      description: 'Classify one ordinary Markdown note with PARA/Zettelkasten-style metadata without changing its body or moving it. Use expectedRevision to avoid overwriting another agent.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, noteKind: { type: 'string', enum: ['fleeting', 'literature', 'atomic', 'moc', 'knowledge', 'question', 'hypothesis', 'assumption', 'decision', 'project', 'area', 'resource', 'journal', 'task'] },
        lifecycle: { type: 'string', enum: ['inbox', 'active', 'review', 'evergreen', 'superseded', 'archived'] },
        moc: { type: 'string' }, mocs: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12, description: 'Additional Obsidian [[MOC]] links for multi-context discovery; navigation only' }, primaryMoc: { type: 'string', maxLength: 500, description: 'Preferred Obsidian MOC entry point for this note; navigation only' }, project: { type: 'string' }, reviewAt: { type: 'string' },
        aliases: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 30 }, reviewIntervalDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Optional review cadence in days; review_wiki_note advances review_at after a completed review' },
        summary: { type: 'string', maxLength: 2000 },
        summaryLayer: { type: 'integer', minimum: 0, maximum: 4, description: 'Progressive Summarization layer 0-4' },
        summaryHighlights: { type: 'array', maxItems: 12, items: { type: 'object', properties: { text: { type: 'string', maxLength: 600 }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['text'] } },
        keyPoints: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        openQuestions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        nextActions: { type: 'array', items: { type: 'string', maxLength: 600 }, maxItems: 20 },
        desiredOutcome: { type: 'string', maxLength: 1000 }, projectPurpose: { type: 'string', maxLength: 1000 }, projectSupport: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 30 }, taskContext: { type: 'string', maxLength: 300 }, dueAt: { type: 'string', description: 'ISO deadline, distinct from scheduledAt' }, scheduledAt: { type: 'string', description: 'ISO execution/calendar time' }, deferUntil: { type: 'string' },
        stableId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', maxLength: 80 }, canonicalPath: { type: 'string', maxLength: 500 }, recallPrompt: { type: 'string', maxLength: 1000 }, recallIntervalDays: { type: 'integer', minimum: 1, maximum: 3650 }, lastRecalledAt: { type: 'string' }, recallQuality: { type: 'string', enum: ['unseen', 'failed', 'partial', 'good'] },
        retentionPolicy: { type: 'string', enum: ['preserve', 'review', 'archive', 'tombstone'] }, retentionEvent: { type: 'string', enum: ['manual', 'created', 'last_modified', 'review_completed', 'superseded', 'project_completed'] }, retentionAt: { type: 'string' }, preserveUntil: { type: 'string' }, legalHold: { type: 'boolean' }, retentionReason: { type: 'string', maxLength: 1000 }, replacedBy: { type: 'string', maxLength: 500 },
        termStatus: { type: 'string', enum: ['preferred', 'deprecated', 'redirect'] }, termReplacedBy: { type: 'string', maxLength: 500 }, preferredTerm: { type: 'string', maxLength: 300 }, disambiguation: { type: 'string', maxLength: 300 }, broaderTerms: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, relatedTerms: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, subjectTerms: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20 }, domain: { type: 'string', maxLength: 200 }, methods: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20 }, audience: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 12 }, retrievalCues: { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 8 }, useWhen: { type: 'string', maxLength: 1000 },
        reviewSnoozedUntil: { type: 'string', description: 'Temporarily omit this note from review queues until an ISO date/time' }, reviewSnoozeReason: { type: 'string', maxLength: 500 }, knowledgeRole: { type: 'string', enum: ['concept', 'argument', 'model', 'observation', 'counterargument'] }, seeAlso: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 }, termScopeNote: { type: 'string', maxLength: 1000 },
        taskStatus: { type: 'string', enum: ['open', 'next_action', 'waiting', 'blocked', 'someday', 'completed', 'cancelled'], description: 'Workflow state for project/task notes' },
        reviewPolicy: { type: 'string', enum: ['manual', 'periodic', 'on_source_change', 'on_link_change', 'on_any_edit'] },
        reviewOutcome: { type: 'string', enum: ['confirmed', 'revised', 'disputed', 'superseded', 'rescheduled'] }, reviewedBy: { type: 'string', maxLength: 200 }, reviewedAt: { type: 'string' }, reviewChecks: { type: 'array', items: { type: 'string', enum: ['evidence', 'links', 'summary', 'moc', 'counterexamples', 'scope', 'freshness'] }, maxItems: 7 }, reviewOpenItems: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 8 }, reviewNote: { type: 'string', maxLength: 1000 }, interpretationStatus: { type: 'string', enum: ['unprocessed', 'interpreted', 'synthesized'], description: 'Source-processing stage' }, epistemicStatus: { type: 'string' },
        polarity: { type: 'string', enum: ['positive', 'negative'] },
        negativeType: { type: 'string', enum: ['failure', 'rejected', 'counterexample', 'non_reproducible', 'superseded'] },
        attempted: { type: 'string', maxLength: 1200 }, observed: { type: 'string', maxLength: 1200 }, failureCondition: { type: 'string', maxLength: 1200 }, affectedScope: { type: 'string', maxLength: 500 }, reproduction: { type: 'string', maxLength: 1200 }, whyRejected: { type: 'string', maxLength: 1200 }, reusableLesson: { type: 'string', maxLength: 1200 }, replacementPath: { type: 'string', maxLength: 500 },
        relations: { type: 'object', description: 'Typed Obsidian link arrays, including same_as, version_of, and refines' }, relationNotes: { type: 'object', description: 'Short rationale keyed by relation field' }, relationEvidence: { type: 'object', description: 'Up to four scope-safe evidence paths keyed by relation field' }, disposition: { type: 'string', enum: ['knowledge', 'reference', 'project', 'someday', 'discard', 'delegate'] }, clarifiedBy: { type: 'string' }, clarifiedAt: { type: 'string' }, clarifyNote: { type: 'string', maxLength: 1000 }, targetPath: { type: 'string' },
        mocPurpose: { type: 'string', maxLength: 1000 }, mocScope: { type: 'string', maxLength: 500 }, mocQuestions: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 12 }, mocParent: { type: 'string', maxLength: 500 },
        focusHorizon: { type: 'string', enum: ['ground', 'project', 'area', 'goal', 'vision', 'purpose'] }, focusParent: { type: 'string', maxLength: 500 }, focusSupports: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 },
        waitingFor: { type: 'string', description: 'Optional person/event/resource this project is waiting for' },
        expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'expectedRevision'] },
    },
    {
      name: 'read_wiki_projection',
      description: 'Read one Wiki note progressively. Start with summary or key_points, then request outline or one section/block with bounded nearby line context; full content is explicit and bounded. Returns the current revision so edits can use optimistic concurrency.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string' }, view: { type: 'string', enum: ['summary', 'progressive', 'key_points', 'outline', 'section', 'full'], default: 'summary', description: 'Use progressive for one bounded packet containing summary, selected passages, claims, and open questions.' },
        section: { type: 'string', description: 'Heading text when view=section' }, blockId: { type: 'string', maxLength: 100, description: 'Obsidian block ID (without the leading ^) when view=section' }, contextBefore: { type: 'integer', minimum: 0, maximum: 3, default: 1, description: 'Nearby lines before the selected heading/block' }, contextAfter: { type: 'integer', minimum: 0, maximum: 3, default: 1, description: 'Nearby lines after the selected heading/block' }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, accessToken, prettyPrint,
      }, required: ['path'] },
    },
    {
      name: 'get_wiki_impact_report',
      description: 'Find knowledge notes affected by missing or altered evidence, overdue review, or other freshness problems. This is a bounded derived report; it never rewrites or deletes notes.',
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
      name: 'get_wiki_moc_candidates',
      description: 'Suggest bounded MOC structure notes for knowledge that is not currently covered by a MOC. Suggestions include a purpose and questions but never create or rewrite notes.',
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
      description: 'Return the bounded MCPVault frontmatter contract before writing or repairing a note. It documents canonical Obsidian Property types, allowed values, and note-kind guidance; custom Properties remain allowed and this never scans or mutates notes.',
      inputSchema: { type: 'object', properties: { maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint } },
    },
    {
      name: 'get_wiki_note_template',
      description: 'Return a small optional Obsidian Markdown/Properties scaffold for an atomic, literature, question, hypothesis, decision, project, MOC, or negative knowledge note. It never creates a file and never makes templates mandatory.',
      inputSchema: { type: 'object', properties: {
        noteKind: { type: 'string', enum: ['atomic', 'literature', 'question', 'hypothesis', 'decision', 'project', 'moc', 'negative'], default: 'atomic' },
        maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 7000 }, accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_bases_view',
      description: 'Return a bounded, optional Obsidian Bases YAML view for visible Wiki notes. Standard projections include all, inbox, inbox_oldest, projects, project_next_actions, review, epistemic, open_questions, knowledge, unreviewed_evidence, negative_knowledge, deprecated_terms, and maintenance. This exports a local view definition only; it is not an MCP permission boundary and does not write a file.',
      inputSchema: { type: 'object', properties: {
        view: { type: 'string', enum: ['all', 'inbox', 'inbox_oldest', 'projects', 'project_next_actions', 'review', 'epistemic', 'open_questions', 'knowledge', 'unreviewed_evidence', 'negative_knowledge', 'deprecated_terms', 'maintenance'], default: 'all', description: 'Optional standard Obsidian Bases projection' },
        noteKind: { type: 'string', description: 'Optional exact note_kind filter' },
        lifecycle: { type: 'string', description: 'Optional exact lifecycle filter' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 12000 },
        accessToken, prettyPrint,
      } },
    },
    {
      name: 'get_wiki_home',
      description: 'Return a bounded live launchpad for the current scope: public schema/welcome entrypoints, MOCs, active Projects/Tasks, Inbox, due review items, and stable IDs. This is a derived Home/JDex-style view, never a second index or an access boundary.',
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
      name: 'get_wiki_promotion_candidates',
      description: 'Return bounded community posts that may deserve promotion into durable Wiki knowledge. This is an advisory candidate list; an agent must verify the post, preserve provenance, and publish a separate knowledge note.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 }, maxChars: { type: 'integer', minimum: 512, maximum: 16000, default: 6000 }, accessToken, prettyPrint } },
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
        scopeUri, issueId: { type: 'string' }, kind: { type: 'string', enum: ['contradiction', 'unsupported_claim', 'stale', 'broken_link', 'missing_context', 'authority_change', 'other'] },
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
        path: { type: 'string' }, actor: { type: 'string' }, resolution: { type: 'string' }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['path', 'resolution', 'expectedRevision'] },
    },
  ];
}
