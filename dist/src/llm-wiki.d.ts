import { type FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
import type { SemanticSearchService } from './semantic-search.js';
import { type AnswerPacketIntent, type CatalogOrder, type TemporalValidityState, type WikiProjectionView } from './organization.js';
import { type ProjectPacketOptions } from './project-packet.js';
import { type NoteKind } from './organization.js';
export { SOURCE_TRUST_LEVELS } from './organization.js';
export interface WikiCatalogOptions {
    summaryOnly?: boolean;
    noteKind?: string;
    lifecycle?: string;
    epistemicStatus?: string;
    taskStatus?: string;
    reviewPolicy?: string;
    sourceType?: string;
    polarity?: string;
    knowledgeRole?: string;
    moc?: string;
    project?: string;
    domain?: string;
    subjectTerm?: string;
    method?: string;
    audience?: string;
    tag?: string;
    validity?: TemporalValidityState;
    validAt?: string;
    limit?: number;
    maxChars?: number;
    /** Include bounded metadata-only facet counts for exploratory browsing. */
    includeFacets?: boolean;
    /** Maximum number of values returned for each facet. */
    facetLimit?: number;
    /** LATCH-style derived browse order; location remains the default. */
    orderBy?: CatalogOrder;
}
export interface WikiClaimInput {
    id?: string;
    text: string;
    evidencePaths?: string[];
    evidence?: WikiEvidenceInput[];
    confidence?: string;
    status?: string;
    /** Optional job of this claim inside an argument. */
    claimRole?: string;
    /** Obsidian block links to claims this claim supports. */
    supportsClaims?: string[];
    /** Obsidian block links to claims this claim challenges. */
    contradictsClaims?: string[];
    /** Obsidian block links to claims this claim requires. */
    dependsOnClaims?: string[];
}
export interface WikiEvidenceInput {
    path: string;
    heading?: string;
    blockId?: string;
    revision?: string;
    startLine?: number;
    endLine?: number;
    quoteHash?: string;
}
type WorkDependencyFindingState = 'active' | 'satisfied' | 'cancelled' | 'inactive' | 'unresolved_or_inaccessible' | 'ambiguous' | 'non_work_target' | 'informational';
interface WikiLintIssue {
    severity: 'error' | 'warning';
    code: string;
    path: string;
    detail: string;
    /** Owner revision captured while computing this signal, not its dependencies. */
    revision?: string;
}
interface WikiLintResult {
    healthy: boolean;
    errors: number;
    warnings: number;
    issues: WikiLintIssue[];
    truncated: boolean;
}
interface ReviewPacketOptions {
    attentionKey?: string;
}
interface SynthesisCandidatesOptions {
    /** Internal identity key used only to distribute equal-score idle work. */
    attentionKey?: string;
    /** Public stable locator used to reopen the exact candidate selected by a pulse. */
    focusPath?: string;
}
export declare class LlmWikiService {
    private readonly fileSystem;
    private readonly access;
    private readonly references;
    private readonly semanticSearch?;
    private workDateProjection;
    private dateRepairProjection;
    private generation;
    private readonly catalogSummaryCache;
    private readonly catalogSummaryInFlight;
    private readonly lintCache;
    private readonly lintInFlight;
    private readonly lintSnapshots;
    private readonly lintCollections;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService, semanticSearch?: SemanticSearchService | undefined);
    invalidate(): void;
    /**
     * Monotonic version for disposable Wiki read projections. Consumers may
     * reuse advisory results only while this value remains unchanged.
     */
    readModelGeneration(): number;
    private principalKey;
    private validatedKnowledgeDisposition;
    private knowledgeDispositionFrontmatter;
    private knowledgeDispositionProjection;
    /**
     * Build one request-local work graph so flow, project planning, and next
     * action projections agree about whether an action is actually executable.
     * Markdown Properties remain authoritative; this graph is never persisted.
     */
    private workDependencySnapshot;
    private workDependencyProjection;
    /**
     * Active recall is a property of the reader, not of the shared knowledge
     * note. Agent sessions therefore keep their recall result in their private
     * continuity scope; the legacy model-owner path continues to use the note
     * frontmatter for compatibility.
     */
    private privateRecallPath;
    private readPrivateRecall;
    /**
     * Capture the revisions of notes linked by the current body/metadata. This
     * is a derived review baseline: Markdown and Git remain authoritative.
     */
    private collectReviewBasisLinks;
    /** Build one request-local metadata resolver. It is intentionally not a
     * second persistent index: callers doing a full review scan share it once,
     * while a single publish/review builds it once for all relation fields. */
    private buildKnowledgeReferenceIndex;
    /** Resolve exact qualified paths or exact visible title/alias/stable-ID terms. */
    private resolveKnowledgeReference;
    /**
     * Snapshot the typed notes whose state can invalidate this note. Outgoing
     * derived_from/depends_on/version_of/refines/tests edges are prerequisites;
     * incoming supports edges are evidence supplied by another knowledge note.
     * The snapshot is bounded frontmatter, not a second graph database.
     */
    private collectReviewBasisUpstream;
    /** Return notes whose conclusions can be affected when this note changes. */
    private collectDownstreamKnowledgePaths;
    /** Return notes whose argument may change when one structured claim is
     * disputed or retired. Incoming claim dependencies and the claim's outgoing
     * support/contradiction links are navigation signals, not automatic edits. */
    private collectClaimDownstreamKnowledgePaths;
    private reviewBodyNote;
    private reviewChangeSignals;
    /**
     * Project direct invalidation through explicit typed note relations. This is
     * deliberately request-local and read-only: it never mutates lifecycle or
     * stores another graph. Only visible notes that opted into
     * on_upstream_change can receive or continue a cascade.
     */
    private upstreamCascadeProjection;
    initialize(scopeRoot: string, actor: string): Promise<{
        success: boolean;
        created: boolean;
        schemaPath: string;
        revision: string;
    }>;
    ingestSource(params: {
        scopeRoot: string;
        sourceId?: string;
        title: string;
        content: string;
        sourceUrl?: string;
        capturedBy: string;
        capturedAt?: string;
        mediaType?: string;
        sourceType?: string;
        citationKey?: string;
        author?: string;
        publishedAt?: string;
        retrievedAt?: string;
        trustLevel?: string;
        trustReason?: string;
        sourceFamily?: string;
        sourceVersion?: string;
        supersedesSource?: string;
        sourceWorkId?: string;
        sourceEditionId?: string;
        archiveCollectionId?: string;
        archiveSeries?: unknown;
        archiveSequence?: unknown;
        accessionId?: string;
        custodialHistory?: string;
        originalOrderNote?: string;
    }): Promise<{
        success: boolean;
        created: boolean;
        sourceId: string;
        path: string;
        contentHash: string;
        revision: string;
    }>;
    /** Turn one immutable source snapshot into an attributed reading note. This
     * is a convenience boundary, not a second persistence model: the resulting
     * note remains ordinary Markdown and still points at the source revision. */
    distillSource(params: {
        principal?: ScopePrincipal;
        sourcePath: string;
        path: string;
        title: string;
        content: string;
        author: string;
        noteKind?: string;
        references?: unknown;
        summary?: string;
        keyPoints?: unknown;
        openQuestions?: unknown;
        summaryLayer?: unknown;
        summaryHighlights?: unknown;
        expectedRevision: string;
    }): Promise<{
        noteKind: "area" | "assumption" | "atomic" | "decision" | "experiment" | "fleeting" | "hypothesis" | "journal" | "knowledge" | "literature" | "moc" | "project" | "question" | "resource" | "task";
        distilledFrom: {
            path: string;
            revision: string;
        };
        nextAction: {
            endpointId: string;
            instruction: string;
        };
        success: boolean;
        created: boolean;
        path: string;
        evidencePaths: string[];
        evidence: {
            heading?: string;
            blockId?: string;
            revision?: string;
            startLine?: number;
            endLine?: number;
            quoteHash?: string;
            path: string;
        }[];
        claims?: Record<string, unknown>[];
        revision: string;
    }>;
    publishKnowledge(params: {
        tags?: unknown;
        timeEstimateMinutes?: unknown;
        energy?: unknown;
        effort?: unknown;
        principal?: ScopePrincipal;
        path: string;
        content: string;
        evidencePaths: string[];
        references?: unknown;
        author: string;
        confidence?: string;
        status?: string;
        noteKind?: string;
        lifecycle?: string;
        decisionStatus?: unknown;
        primaryMoc?: string;
        moc?: string;
        mocs?: unknown;
        navOrder?: unknown;
        project?: string;
        reviewAt?: string;
        reviewIntervalDays?: unknown;
        volatilityClass?: unknown;
        aliases?: unknown;
        summary?: string;
        keyPoints?: unknown;
        openQuestions?: unknown;
        summaryLayer?: unknown;
        summaryHighlights?: unknown;
        nextActions?: unknown;
        nextAction?: string;
        waitingFor?: string;
        desiredOutcome?: string;
        projectPurpose?: string;
        projectSupport?: unknown;
        taskContext?: string;
        dueAt?: string;
        scheduledAt?: string;
        deferUntil?: string;
        serviceClass?: unknown;
        completionCriteria?: unknown;
        startedAt?: unknown;
        blockedSince?: unknown;
        waitingSince?: unknown;
        completedAt?: unknown;
        stableId?: string;
        canonicalPath?: string;
        recallPrompt?: string;
        recallIntervalDays?: unknown;
        lastRecalledAt?: string;
        recallQuality?: unknown;
        retentionPolicy?: unknown;
        retentionEvent?: unknown;
        retentionAt?: unknown;
        preserveUntil?: unknown;
        legalHold?: unknown;
        retentionReason?: string;
        archiveReason?: string;
        replacedBy?: string;
        reviewSnoozedUntil?: unknown;
        reviewSnoozeReason?: unknown;
        knowledgeRole?: unknown;
        termStatus?: string;
        termReplacedBy?: string;
        termScopeNote?: string;
        preferredTerm?: string;
        termLanguage?: string;
        authorityScheme?: string;
        authorityId?: string;
        disambiguation?: string;
        broaderTerms?: unknown;
        relatedTerms?: unknown;
        subjectTerms?: unknown;
        domain?: string;
        methods?: unknown;
        audience?: unknown;
        retrievalCues?: unknown;
        useWhen?: string;
        validFrom?: string;
        validUntil?: string;
        observedAt?: string;
        temporalScope?: string;
        seeAlso?: unknown;
        relations?: unknown;
        relationNotes?: unknown;
        relationEvidence?: unknown;
        taskStatus?: unknown;
        knowledgeNotes?: unknown;
        negativeKnowledgeNotes?: unknown;
        retrospective?: unknown;
        noReusableKnowledge?: unknown;
        knowledgeDispositionReason?: unknown;
        reviewPolicy?: unknown;
        reviewOutcome?: unknown;
        reviewedBy?: string;
        reviewedAt?: string;
        reviewNote?: string;
        reviewChecks?: unknown;
        reviewOpenItems?: unknown;
        interpretationStatus?: unknown;
        epistemicStatus?: unknown;
        polarity?: unknown;
        negativeType?: unknown;
        attempted?: string;
        observed?: string;
        failureCondition?: string;
        affectedScope?: string;
        reproduction?: string;
        whyRejected?: string;
        reusableLesson?: string;
        replacementPath?: string;
        mocPurpose?: string;
        mocScope?: string;
        mocQuestions?: unknown;
        mocParent?: string;
        focusHorizon?: unknown;
        focusParent?: string;
        focusSupports?: unknown;
        evidence?: unknown;
        claims?: WikiClaimInput[];
        expectedRevision: string;
    }, internal?: {
        allowRetiredLifecycle?: boolean;
        revisionGuards?: Array<{
            path: string;
            expectedRevision: string;
        }>;
    }): Promise<{
        success: boolean;
        created: boolean;
        path: string;
        evidencePaths: string[];
        evidence: {
            heading?: string;
            blockId?: string;
            revision?: string;
            startLine?: number;
            endLine?: number;
            quoteHash?: string;
            path: string;
        }[];
        claims?: Record<string, unknown>[];
        revision: string;
    }>;
    catalog(principal?: ScopePrincipal, options?: WikiCatalogOptions): Promise<any>;
    private computeCatalog;
    /**
     * Report likely filing mismatches without treating folders as permissions.
     * PARA is a retrieval aid here: the note's Properties/lifecycle are the
     * signal, while the existing Markdown path remains authoritative and no
     * move is performed automatically.
     */
    placementCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        mode: string;
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        note: string;
    }>;
    /**
     * Surface unresolved epistemic work as a small active-recall/research queue.
     * Questions, hypotheses, assumptions, disputed claims, and negative
     * knowledge stay as ordinary Markdown; this is only a bounded projection.
     */
    knowledgeGaps(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        mode: string;
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        note: string;
    }>;
    /** Resolve an authored navigation edge using its syntax and source scope. */
    private resolveNavigationLink;
    /** Bounded, explainable neighbors; Markdown identity remains authoritative. */
    neighborhood(principal: ScopePrincipal | undefined, path: string, limit?: number, maxChars?: number, includeSemantic?: boolean): Promise<{
        source: {
            path: string;
            revision: string;
        };
        neighbors: {
            path: string;
            title: string | undefined;
            noteKind?: string;
            lifecycle?: string;
            reasons: string[];
            relations?: string[];
            line?: number;
            context?: string;
            contextPath?: string;
            contextRevision?: string;
            moc?: string;
            mocs?: string[];
            project?: string;
            polarity?: string;
            status?: string;
            summaryFresh?: boolean;
            pathTrace: string[];
            revision?: string;
        }[];
        totalCandidates: number;
        navigation: {
            unresolvedLinks: number;
            ambiguousLinks: number;
            truncated: boolean;
        };
        truncated: boolean;
    }>;
    /**
     * Find short, explainable link paths between two visible notes. This is a
     * graph traversal projection only: it reads the existing Obsidian graph,
     * never creates adjacency data, and never treats a path as evidence.
     */
    trail(principal: ScopePrincipal | undefined, fromPath: string, toPath: string, maxDepth?: number, limit?: number, maxChars?: number): Promise<{
        mode: string;
        from: string;
        to: string;
        maxDepth: number;
        paths: {
            nodes: string[];
            edges: {
                from: string;
                to: string;
                sourceRevision: string;
                line: number;
                link: string;
                context: string;
                relation?: string;
            }[];
            length: number;
        }[];
        totalPaths: number;
        exploredNodes: number;
        exploredEdges: number;
        truncated: boolean;
    }>;
    reviewQueue(principal?: ScopePrincipal, limit?: number, maxChars?: number, maxCascadeDepth?: number, options?: {
        prettyPrint?: boolean;
    }): Promise<import("./organization-queue-packet.js").OrganizationQueuePacket>;
    private collectReviewQueue;
    inbox(principal?: ScopePrincipal, limit?: number, maxChars?: number, options?: {
        prettyPrint?: boolean;
    }): Promise<import("./organization-queue-packet.js").OrganizationQueuePacket>;
    private collectInbox;
    /**
     * Produce a read-only plan for Inbox clarification.  Suggestions are based
     * only on existing Properties, so the agent can review the evidence before
     * choosing a GTD disposition; this endpoint never moves or edits notes.
     */
    inboxPlan(principal?: ScopePrincipal, limit?: number, maxChars?: number, options?: {
        prettyPrint?: boolean;
    }): Promise<import("./organization-queue-packet.js").OrganizationQueuePacket>;
    /**
     * Flag links in durable Wiki notes that have no explanatory nearby text.
     * This is intentionally advisory: a short link can be correct, and the
     * report is meant to improve Zettelkasten discoverability rather than impose
     * a prose style on every note.
     */
    linkContextHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        scannedNotes: number;
        total: number;
        items: Record<string, unknown>[];
        truncated: boolean;
        generatedAt: string;
    }>;
    /** Capture first, classify later. The default path deliberately removes
     * filing decisions from the first interaction and keeps the note ordinary
     * Markdown so Obsidian and Git remain the source of truth. */
    capture(params: {
        principal?: ScopePrincipal;
        path?: string;
        title?: string;
        content: string;
        capturedBy: string;
        references?: unknown;
        capturedFrom?: unknown;
        captureReason?: unknown;
        captureContext?: unknown;
        relatedTask?: unknown;
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        path: string;
        title: string;
        noteKind: string;
        lifecycle: string;
        revision: string;
        capturedFrom?: string;
        captureReason?: string;
        captureContext?: string;
        relatedTask?: string;
        nextAction: {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string;
            };
            instruction: string;
        };
    }>;
    /** Apply the GTD clarification decision to an Inbox capture without
     * deleting it or silently moving it. The disposition is durable metadata;
     * the caller can move the note later with the normal revision-checked edit
     * flow, preserving links and human review. */
    clarify(params: {
        principal?: ScopePrincipal;
        path: string;
        disposition: unknown;
        clarifiedBy: string;
        clarifyNote?: string;
        targetPath?: string;
        noteKind?: string;
        lifecycle?: string;
        epistemicStatus?: unknown;
        taskStatus?: unknown;
        knowledgeNotes?: unknown;
        negativeKnowledgeNotes?: unknown;
        retrospective?: unknown;
        noReusableKnowledge?: unknown;
        knowledgeDispositionReason?: unknown;
        project?: string;
        nextAction?: string;
        waitingFor?: string;
        desiredOutcome?: string;
        projectPurpose?: string;
        projectSupport?: unknown;
        expectedRevision: string;
    }): Promise<{
        disposition: "delegate" | "discard" | "knowledge" | "project" | "reference" | "someday";
        targetPath?: string;
        targetExists?: boolean;
        targetRevision?: string;
        recommendedPath: unknown;
        recommendedLifecycle: unknown;
        nextAction: {
            endpointId: string;
            instruction: string;
            arguments?: never;
        } | {
            endpointId: string;
            arguments: {
                sourcePath: string;
                targetPath: string;
                newPath?: never;
                oldPath?: never;
                expectedRevision?: never;
            };
            instruction: string;
        } | {
            endpointId: string;
            arguments: {
                sourcePath?: never;
                targetPath?: never;
                oldPath: string;
                newPath: string;
                expectedRevision: string;
            };
            instruction: string;
        } | {
            endpointId: string;
            arguments: {
                sourcePath?: never;
                targetPath?: never;
                newPath?: never;
                oldPath: string;
                expectedRevision: string;
            };
            instruction: string;
        };
        success: boolean;
        path: string;
        revision: string;
        clearedProperties?: string[];
        inapplicableProperties?: string[];
        frontmatter: any;
    }>;
    /**
     * Find bounded near-duplicate candidates using titles, aliases, compact
     * projections, and a small body sample. This is deliberately a report:
     * similar notes can represent different perspectives and are never merged
     * automatically.
     */
    duplicateCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        total: number;
        items: Record<string, unknown>[];
        truncated: boolean;
        generatedAt: string;
    }>;
    /** Record an optional active-recall attempt without rewriting the note body. */
    recordRecall(params: {
        principal?: ScopePrincipal;
        path: string;
        recallQuality: unknown;
        recallPrompt?: string;
        recallIntervalDays?: unknown;
        confusion?: string;
        repairPath?: string;
        repairStatus?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        path: string;
        revision: string;
        recallQuality: "failed" | "good" | "partial" | "unseen";
        recallPrompt: string;
        recalledAt: string;
        isolatedTo?: string;
        stateRevision?: string | undefined;
        recallHistoryCount?: any;
        recallStreak?: any;
        recallSuccessCount?: any;
        recallIntervalDays?: number;
        nextRecallAt?: string | undefined;
        adaptiveRecallInterval?: boolean;
        confusion?: string;
        repairStatus: string;
        repairPath?: string;
        repairAction?: string;
        nextAction: string;
    }>;
    /**
     * Return the reader's due active-recall queue without opening note bodies.
     * Agent sessions use their private continuity record; model-owner sessions
     * retain the legacy note Properties path for compatibility.
     */
    recallQueue(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        total: number;
        items: Record<string, unknown>[];
        diversity: {
            groups: number;
            strategy: string;
        };
        truncated: boolean;
        generatedAt: string;
    }>;
    review(params: {
        principal?: ScopePrincipal;
        path: string;
        reviewOutcome: unknown;
        reviewedBy: string;
        reviewAt?: string;
        reviewIntervalDays?: unknown;
        reviewNote?: string;
        reviewReason?: string;
        nextLifecycle?: string;
        reviewChecks?: unknown;
        reviewOpenItems?: unknown;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        path: string;
        revision: string;
        reviewOutcome: "confirmed" | "disputed" | "rescheduled" | "revised" | "superseded";
        reviewedBy: any;
        reviewedAt: any;
        reviewTrigger: string;
        reviewCount: number;
        reviewReopenCount: number;
        volatilityClass: "durable" | "ephemeral" | "evolving" | "foundational";
        reviewChecks?: string[];
        reviewOpenItems?: string[];
        reviewAt?: string;
        reviewIntervalDays?: number;
        adaptiveReviewInterval?: boolean;
        nextLifecycle?: "active" | "archived" | "evergreen" | "inbox" | "review" | "superseded";
        followUpRequired?: true;
        followUp?: string;
        impactedDownstreamCount?: number;
        impactedDownstreamPaths?: string[];
        downstreamWarning?: string;
    }>;
    reviewClaim(params: {
        principal?: ScopePrincipal;
        path: string;
        claimId: string;
        status: string;
        confidence?: string;
        reviewedBy: string;
        reviewNote?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        path: string;
        claimId: string;
        status: unknown;
        confidence: unknown;
        reviewedBy: string;
        reviewedAt: string;
        reviewNote?: string;
        revision: string;
        impactedDownstreamCount?: number;
        impactedDownstreamPaths?: string[];
        impactTruncated?: boolean;
        downstreamWarning?: string;
    }>;
    reviewDashboard(principal?: ScopePrincipal, limit?: number, maxChars?: number, options?: {
        prettyPrint?: boolean;
    }): Promise<{
        [x: string]: any;
    }>;
    /** Shared bounded-row discovery, before any user-facing packet compaction. */
    private collectReviewDashboard;
    /**
     * A bounded Kanban-style flow view derived from orthogonal work Properties.
     * `next_action` is treated as executable WIP, while `open` items with a
     * concrete next action are pull-ready.  This is advisory: it never assigns,
     * moves, or changes a note.
     */
    flowHealth(principal?: ScopePrincipal, wipLimit?: number, blockedAfterDays?: number, waitingAfterDays?: number, limit?: number, maxChars?: number, options?: {
        prettyPrint?: boolean;
    }): Promise<Record<string, any> | {
        purpose: string;
        policy: {
            wipLimit: number;
            blockedAfterDays: number;
            waitingAfterDays: number;
            wipDefinition: string;
            pullDefinition: string;
            classesOfService: ("expedite" | "fixed_date" | "research" | "standard")[];
        };
        flow: {
            totalWork: number;
            activeWip: number;
            wipOverflow: number;
            pullAllowed: boolean;
            readyToPull: number;
            blocked: number;
            dependencyBlocked: number;
            waiting: number;
            deferred: number;
            overdue: number;
        };
        lanes: {
            active: Record<string, unknown>[];
            ready: Record<string, unknown>[];
            blocked: Record<string, unknown>[];
            waiting: Record<string, unknown>[];
            deferred: Record<string, unknown>[];
        };
        dependencyPlan: {
            purpose: string;
            stats: {
                edges: number;
                stageable: number;
                stages: number;
                longestDependencyDepth: number;
                incompletePrerequisites: number;
                blockedByIncompletePrerequisites: number;
                workflowHolds: number;
                blockedByWorkflowHolds: number;
                dependencyCycles: number;
                cyclicItems: number;
                blockedByCycles: number;
            };
            recommendedStages: {
                stage: number;
                meaning: string;
                total: number;
                items: {
                    dueAt?: string;
                    scheduledAt?: string;
                    deferUntil?: string;
                    dateIssues?: string[];
                    dateRepairAction?: {
                        endpointId: string;
                        arguments: {
                            path: string;
                            expectedRevision: string | undefined;
                            maxChars: number;
                        };
                    };
                    dateRepairGuidance?: string;
                    path: string;
                    title: any;
                    revision?: string;
                    taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                    needsNextAction?: boolean;
                    directDependents: number;
                    immediateUnlocks: number;
                }[];
                truncated: boolean;
            }[];
            unlockPoints: {
                total: number;
                items: {
                    dueAt?: string;
                    scheduledAt?: string;
                    deferUntil?: string;
                    dateIssues?: string[];
                    dateRepairAction?: {
                        endpointId: string;
                        arguments: {
                            path: string;
                            expectedRevision: string | undefined;
                            maxChars: number;
                        };
                    };
                    dateRepairGuidance?: string;
                    path: string;
                    title: any;
                    revision?: string;
                    taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                    needsNextAction?: boolean;
                    directDependents: number;
                    immediateUnlocks: number;
                }[];
                truncated: boolean;
            };
            deepestDependencyChain?: {
                dueAt?: string;
                scheduledAt?: string;
                deferUntil?: string;
                dateIssues?: string[];
                dateRepairAction?: {
                    endpointId: string;
                    arguments: {
                        path: string;
                        expectedRevision: string | undefined;
                        maxChars: number;
                    };
                };
                dateRepairGuidance?: string;
                path: string;
                title: any;
                revision?: string;
                taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                needsNextAction?: boolean;
                directDependents: number;
                immediateUnlocks: number;
            }[];
            deepestDependencyChainTotal?: number;
            deepestDependencyChainTruncated?: boolean;
            dependencyCycles: {
                total: number;
                items: {
                    cycle: number;
                    notes: {
                        dueAt?: string;
                        scheduledAt?: string;
                        deferUntil?: string;
                        dateIssues?: string[];
                        dateRepairAction?: {
                            endpointId: string;
                            arguments: {
                                path: string;
                                expectedRevision: string | undefined;
                                maxChars: number;
                            };
                        };
                        dateRepairGuidance?: string;
                        path: string;
                        title: any;
                        revision?: string;
                        taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                        needsNextAction?: boolean;
                        directDependents: number;
                        immediateUnlocks: number;
                    }[];
                    truncated: boolean;
                }[];
                truncated: boolean;
            };
            cycleBlockedDependents: {
                total: number;
                items: {
                    dueAt?: string;
                    scheduledAt?: string;
                    deferUntil?: string;
                    dateIssues?: string[];
                    dateRepairAction?: {
                        endpointId: string;
                        arguments: {
                            path: string;
                            expectedRevision: string | undefined;
                            maxChars: number;
                        };
                    };
                    dateRepairGuidance?: string;
                    path: string;
                    title: any;
                    revision?: string;
                    taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                    needsNextAction?: boolean;
                    directDependents: number;
                    immediateUnlocks: number;
                }[];
                truncated: boolean;
            };
            incompletePrerequisites: {
                total: number;
                items: {
                    dueAt?: string;
                    scheduledAt?: string;
                    deferUntil?: string;
                    dateIssues?: string[];
                    dateRepairAction?: {
                        endpointId: string;
                        arguments: {
                            path: string;
                            expectedRevision: string | undefined;
                            maxChars: number;
                        };
                    };
                    dateRepairGuidance?: string;
                    path: string;
                    title: any;
                    revision?: string;
                    taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                    needsNextAction?: boolean;
                    directDependents: number;
                    immediateUnlocks: number;
                    dependencies: {
                        executable: boolean;
                        blockerCount: number;
                        blockers: {
                            relation: "blocked_by" | "depends_on";
                            target: string;
                            state: WorkDependencyFindingState;
                            targetPaths?: string[];
                            targetStatuses?: string[];
                            targetRevisions?: string[];
                        }[];
                        satisfiedCount: number;
                        informationalCount: number;
                        dependencyCycle?: string[];
                        truncated: boolean;
                    };
                }[];
                truncated: boolean;
            };
            incompleteBlockedDependents: {
                total: number;
                items: {
                    dueAt?: string;
                    scheduledAt?: string;
                    deferUntil?: string;
                    dateIssues?: string[];
                    dateRepairAction?: {
                        endpointId: string;
                        arguments: {
                            path: string;
                            expectedRevision: string | undefined;
                            maxChars: number;
                        };
                    };
                    dateRepairGuidance?: string;
                    path: string;
                    title: any;
                    revision?: string;
                    taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                    needsNextAction?: boolean;
                    directDependents: number;
                    immediateUnlocks: number;
                }[];
                truncated: boolean;
            };
            workflowHolds: {
                total: number;
                items: {
                    dueAt?: string;
                    scheduledAt?: string;
                    deferUntil?: string;
                    dateIssues?: string[];
                    dateRepairAction?: {
                        endpointId: string;
                        arguments: {
                            path: string;
                            expectedRevision: string | undefined;
                            maxChars: number;
                        };
                    };
                    dateRepairGuidance?: string;
                    path: string;
                    title: any;
                    revision?: string;
                    taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                    needsNextAction?: boolean;
                    directDependents: number;
                    immediateUnlocks: number;
                }[];
                truncated: boolean;
            };
            workflowHoldBlockedDependents: {
                total: number;
                items: {
                    dueAt?: string;
                    scheduledAt?: string;
                    deferUntil?: string;
                    dateIssues?: string[];
                    dateRepairAction?: {
                        endpointId: string;
                        arguments: {
                            path: string;
                            expectedRevision: string | undefined;
                            maxChars: number;
                        };
                    };
                    dateRepairGuidance?: string;
                    path: string;
                    title: any;
                    revision?: string;
                    taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                    needsNextAction?: boolean;
                    directDependents: number;
                    immediateUnlocks: number;
                }[];
                truncated: boolean;
            };
            guidance: string;
        };
        observability: {
            missingTimestamps: Record<string, unknown>[];
            cycleTimeAvailable: string;
            note: string;
        };
        nextActions: string[];
        generatedAt: string;
    }>;
    /**
     * Return a portable organization contract and, when explicitly requested,
     * a metadata-only migration preflight. The preflight deliberately scans
     * only global material: command-center Community, model/agent/user scopes,
     * whispers, and disposable caches never enter an export inventory.
     */
    organizationManifest(principal: ScopePrincipal | undefined, options?: {
        maxChars?: number;
        includeReadiness?: boolean;
        compareManifest?: unknown;
        expectedCounterpartFingerprint?: string;
        limit?: number;
    }): Promise<any>;
    /**
     * A small action-oriented packet for agents that need to decide what to do
     * next. It is a projection over the existing Reflect/graph reports, not a
     * new task or history store.
     */
    reviewPacket(principal?: ScopePrincipal, limit?: number, maxChars?: number, options?: ReviewPacketOptions): Promise<Record<string, any> | {
        purpose: string;
        priorities: (Record<string, unknown> & {
            priority: number;
            path: string;
            reason: string;
            reasons: string[];
            suggestedTool: string;
            suggestedTools: string[];
        })[];
        attentionRouting?: {
            mode: 'stateless_rendezvous';
            candidateBand: number;
            exclusive: false;
        };
        counts: {
            snoozedPriorities: number;
            inbox: number;
            knowledgeReview: number;
            due: number;
            projectNeedsAction: number;
            activeWip: number;
            wipOverflow: number;
            readyToPull: number;
            blocked: number;
            dependencyBlocked: number;
            waiting: number;
            deferred: number;
            unlinkedMocQuestions: number;
            mocSequenceNeedsAttention: number;
            mocHierarchyIssues: number;
            focusHierarchyIssues: number;
            connectivityIssues: number;
            epistemicIssues: number;
            knowledgeFlowIssues: number;
            typedRelationIssues: number;
            claimArgumentIssues: number;
            evergreenNeedsAttention: number;
            recallDue: number;
            tagVariantIssues: number;
            unresolvedSubjectTerms: number;
            authorityTermCollisions: number;
            fragmentedFacets: number;
            lowSelectivityFacetValues: number;
            lintIssues: number;
        };
        nextSnoozedReviewAt?: string;
        priorityScanTruncated: boolean;
        supportingViews: {
            inbox: any;
            knowledge: any;
            executionFlow: Record<string, any> | {
                purpose: string;
                policy: {
                    wipLimit: number;
                    blockedAfterDays: number;
                    waitingAfterDays: number;
                    wipDefinition: string;
                    pullDefinition: string;
                    classesOfService: ("expedite" | "fixed_date" | "research" | "standard")[];
                };
                flow: {
                    totalWork: number;
                    activeWip: number;
                    wipOverflow: number;
                    pullAllowed: boolean;
                    readyToPull: number;
                    blocked: number;
                    dependencyBlocked: number;
                    waiting: number;
                    deferred: number;
                    overdue: number;
                };
                lanes: {
                    active: Record<string, unknown>[];
                    ready: Record<string, unknown>[];
                    blocked: Record<string, unknown>[];
                    waiting: Record<string, unknown>[];
                    deferred: Record<string, unknown>[];
                };
                dependencyPlan: {
                    purpose: string;
                    stats: {
                        edges: number;
                        stageable: number;
                        stages: number;
                        longestDependencyDepth: number;
                        incompletePrerequisites: number;
                        blockedByIncompletePrerequisites: number;
                        workflowHolds: number;
                        blockedByWorkflowHolds: number;
                        dependencyCycles: number;
                        cyclicItems: number;
                        blockedByCycles: number;
                    };
                    recommendedStages: {
                        stage: number;
                        meaning: string;
                        total: number;
                        items: {
                            dueAt?: string;
                            scheduledAt?: string;
                            deferUntil?: string;
                            dateIssues?: string[];
                            dateRepairAction?: {
                                endpointId: string;
                                arguments: {
                                    path: string;
                                    expectedRevision: string | undefined;
                                    maxChars: number;
                                };
                            };
                            dateRepairGuidance?: string;
                            path: string;
                            title: any;
                            revision?: string;
                            taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                            needsNextAction?: boolean;
                            directDependents: number;
                            immediateUnlocks: number;
                        }[];
                        truncated: boolean;
                    }[];
                    unlockPoints: {
                        total: number;
                        items: {
                            dueAt?: string;
                            scheduledAt?: string;
                            deferUntil?: string;
                            dateIssues?: string[];
                            dateRepairAction?: {
                                endpointId: string;
                                arguments: {
                                    path: string;
                                    expectedRevision: string | undefined;
                                    maxChars: number;
                                };
                            };
                            dateRepairGuidance?: string;
                            path: string;
                            title: any;
                            revision?: string;
                            taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                            needsNextAction?: boolean;
                            directDependents: number;
                            immediateUnlocks: number;
                        }[];
                        truncated: boolean;
                    };
                    deepestDependencyChain?: {
                        dueAt?: string;
                        scheduledAt?: string;
                        deferUntil?: string;
                        dateIssues?: string[];
                        dateRepairAction?: {
                            endpointId: string;
                            arguments: {
                                path: string;
                                expectedRevision: string | undefined;
                                maxChars: number;
                            };
                        };
                        dateRepairGuidance?: string;
                        path: string;
                        title: any;
                        revision?: string;
                        taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                        needsNextAction?: boolean;
                        directDependents: number;
                        immediateUnlocks: number;
                    }[];
                    deepestDependencyChainTotal?: number;
                    deepestDependencyChainTruncated?: boolean;
                    dependencyCycles: {
                        total: number;
                        items: {
                            cycle: number;
                            notes: {
                                dueAt?: string;
                                scheduledAt?: string;
                                deferUntil?: string;
                                dateIssues?: string[];
                                dateRepairAction?: {
                                    endpointId: string;
                                    arguments: {
                                        path: string;
                                        expectedRevision: string | undefined;
                                        maxChars: number;
                                    };
                                };
                                dateRepairGuidance?: string;
                                path: string;
                                title: any;
                                revision?: string;
                                taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                                needsNextAction?: boolean;
                                directDependents: number;
                                immediateUnlocks: number;
                            }[];
                            truncated: boolean;
                        }[];
                        truncated: boolean;
                    };
                    cycleBlockedDependents: {
                        total: number;
                        items: {
                            dueAt?: string;
                            scheduledAt?: string;
                            deferUntil?: string;
                            dateIssues?: string[];
                            dateRepairAction?: {
                                endpointId: string;
                                arguments: {
                                    path: string;
                                    expectedRevision: string | undefined;
                                    maxChars: number;
                                };
                            };
                            dateRepairGuidance?: string;
                            path: string;
                            title: any;
                            revision?: string;
                            taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                            needsNextAction?: boolean;
                            directDependents: number;
                            immediateUnlocks: number;
                        }[];
                        truncated: boolean;
                    };
                    incompletePrerequisites: {
                        total: number;
                        items: {
                            dueAt?: string;
                            scheduledAt?: string;
                            deferUntil?: string;
                            dateIssues?: string[];
                            dateRepairAction?: {
                                endpointId: string;
                                arguments: {
                                    path: string;
                                    expectedRevision: string | undefined;
                                    maxChars: number;
                                };
                            };
                            dateRepairGuidance?: string;
                            path: string;
                            title: any;
                            revision?: string;
                            taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                            needsNextAction?: boolean;
                            directDependents: number;
                            immediateUnlocks: number;
                            dependencies: {
                                executable: boolean;
                                blockerCount: number;
                                blockers: {
                                    relation: "blocked_by" | "depends_on";
                                    target: string;
                                    state: WorkDependencyFindingState;
                                    targetPaths?: string[];
                                    targetStatuses?: string[];
                                    targetRevisions?: string[];
                                }[];
                                satisfiedCount: number;
                                informationalCount: number;
                                dependencyCycle?: string[];
                                truncated: boolean;
                            };
                        }[];
                        truncated: boolean;
                    };
                    incompleteBlockedDependents: {
                        total: number;
                        items: {
                            dueAt?: string;
                            scheduledAt?: string;
                            deferUntil?: string;
                            dateIssues?: string[];
                            dateRepairAction?: {
                                endpointId: string;
                                arguments: {
                                    path: string;
                                    expectedRevision: string | undefined;
                                    maxChars: number;
                                };
                            };
                            dateRepairGuidance?: string;
                            path: string;
                            title: any;
                            revision?: string;
                            taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                            needsNextAction?: boolean;
                            directDependents: number;
                            immediateUnlocks: number;
                        }[];
                        truncated: boolean;
                    };
                    workflowHolds: {
                        total: number;
                        items: {
                            dueAt?: string;
                            scheduledAt?: string;
                            deferUntil?: string;
                            dateIssues?: string[];
                            dateRepairAction?: {
                                endpointId: string;
                                arguments: {
                                    path: string;
                                    expectedRevision: string | undefined;
                                    maxChars: number;
                                };
                            };
                            dateRepairGuidance?: string;
                            path: string;
                            title: any;
                            revision?: string;
                            taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                            needsNextAction?: boolean;
                            directDependents: number;
                            immediateUnlocks: number;
                        }[];
                        truncated: boolean;
                    };
                    workflowHoldBlockedDependents: {
                        total: number;
                        items: {
                            dueAt?: string;
                            scheduledAt?: string;
                            deferUntil?: string;
                            dateIssues?: string[];
                            dateRepairAction?: {
                                endpointId: string;
                                arguments: {
                                    path: string;
                                    expectedRevision: string | undefined;
                                    maxChars: number;
                                };
                            };
                            dateRepairGuidance?: string;
                            path: string;
                            title: any;
                            revision?: string;
                            taskStatus: "blocked" | "cancelled" | "completed" | "invalid" | "next_action" | "open" | "someday" | "waiting";
                            needsNextAction?: boolean;
                            directDependents: number;
                            immediateUnlocks: number;
                        }[];
                        truncated: boolean;
                    };
                    guidance: string;
                };
                observability: {
                    missingTimestamps: Record<string, unknown>[];
                    cycleTimeAvailable: string;
                    note: string;
                };
                nextActions: string[];
                generatedAt: string;
            };
            mocQuestions: any;
            mocSequences: any;
            mocHierarchy: any;
            evergreenQuality: any;
            recall: {
                purpose: string;
                total: number;
                items: Record<string, unknown>[];
                diversity: {
                    groups: number;
                    strategy: string;
                };
                truncated: boolean;
                generatedAt: string;
            };
            vocabulary: {
                purpose: string;
                noteCount: number;
                tagCount: number;
                authorityTermCount: number;
                subjectTermCount: number;
                issueCounts: {
                    tagVariants: number;
                    unresolvedSubjectTerms: number;
                    termCollisions: number;
                    fragmentedFacets: number;
                    lowSelectivityValues: number;
                };
                tagVariants: {
                    key: string;
                    variants: string[];
                    count: number;
                    noteCount: number;
                    paths: string[];
                    reason: string;
                }[];
                unresolvedSubjectTerms: {
                    term: string;
                    count: number;
                    noteCount: number;
                    paths: string[];
                    reason: string;
                    advisory: boolean;
                }[];
                termCollisions: {
                    term: string;
                    noteCount: number;
                    paths: string[];
                    reason: string;
                }[];
                facetHealth: {
                    thresholds: {
                        minimumVisibleNotes: number;
                        fragmentationMinimumValues: number;
                        fragmentationSingletonRatio: number;
                        lowSelectivityCoverageRatio: number;
                    };
                    fragmentedTotal: number;
                    lowSelectivityTotal: number;
                    fragmentedFacets: {
                        facet: string;
                        distinctValues: number;
                        singletonValues: number;
                        singletonRatio: number;
                        examples: string[];
                        reason: string;
                        guidance: string;
                    }[];
                    lowSelectivityValues: {
                        facet: string;
                        value: string;
                        noteCount: number;
                        coverageRatio: number;
                        reason: string;
                        guidance: string;
                    }[];
                    advisory: boolean;
                };
                facets: {
                    [k: string]: {
                        [k: string]: number;
                    };
                };
                recommendations: string[];
                truncated: boolean;
                generatedAt: string;
            };
            graph: {
                unresolvedLinks: any;
                orphanNotes: any;
            };
        };
        curationPlan?: Record<string, unknown>;
        crossVaultActions: {
            reason: string;
            count: number;
            inspect: {
                endpointId: string;
                arguments: {
                    limit: number;
                    maxChars: number;
                };
            };
            instruction: string;
        }[];
        nextActions: string[];
        sourceTruncated: boolean;
        generatedAt: string;
    } | {
        selected: {
            path: unknown;
            revision: unknown;
            reason: unknown;
        } | undefined;
        nextAction: {
            endpointId: unknown;
            arguments: unknown;
        } | undefined;
        then: {
            endpointId: unknown;
        } | undefined;
        nextSnoozedReviewAt?: string;
        attentionRouting?: {
            mode: 'stateless_rendezvous';
            candidateBand: number;
            exclusive: false;
        };
        priorityScanTruncated: boolean;
        truncated: boolean;
    }>;
    /**
     * Return the shared frontmatter contract without scanning note bodies. This
     * is intentionally read-only: agents can inspect the vocabulary before
     * writing, while custom Properties remain valid outside this contract.
     */
    propertyContract(options?: {
        maxChars?: number;
        names?: unknown;
        query?: string;
        offset?: number;
        limit?: number;
    }): {
        purpose: string;
        contractFingerprint: string;
        fields: import("./organization.js").OrganizationPropertyContractEntry[];
        totalFields: number;
        totalRelations: number;
        selection: {
            mode: string;
            names: string[];
            matches: number;
            offset: number;
            returned: number;
            unknownNames?: string[];
            nextOffset?: number;
        } | {
            mode: string;
            query: string;
            matches: number;
            offset: number;
            returned: number;
            unknownNames?: string[];
            nextOffset?: number;
        } | undefined;
        nextAction?: {
            endpointId: string;
            arguments: {
                names: string[];
                offset: number;
                limit: number;
                maxChars: number;
            } | {
                query: string;
                offset: number;
                limit: number;
                maxChars: number;
            };
        };
        generatedAt: string;
        relations?: never;
        conventions?: never;
    } | {
        purpose: string;
        contractFingerprint: string;
        fields: import("./organization.js").OrganizationPropertyContractEntry[];
        relations: ({
            field: 'supports';
            direction: 'directional';
            target: 'A claim, decision, or note supported by this note.';
            reciprocal: false;
        } | {
            field: 'contradicts';
            direction: 'directional';
            target: 'A claim or conclusion challenged by this note.';
            reciprocal: false;
        } | {
            field: 'supersedes';
            direction: 'directional';
            target: 'An older or replaced note.';
            reciprocal: false;
        } | {
            field: 'derived_from';
            direction: 'directional';
            target: 'The source or note from which this note was derived.';
            reciprocal: false;
        } | {
            field: 'depends_on';
            direction: 'directional';
            target: 'A prerequisite note, decision, or project.';
            reciprocal: false;
        } | {
            field: 'implements';
            direction: 'directional';
            target: 'The design, decision, or requirement implemented here.';
            reciprocal: false;
        } | {
            field: 'blocked_by';
            direction: 'directional';
            target: 'The note or dependency currently blocking this note.';
            reciprocal: false;
        } | {
            field: 'answers_questions';
            direction: 'directional';
            target: 'A question note answered by this note.';
            reciprocal: false;
        } | {
            field: 'tests';
            direction: 'directional';
            target: 'A question, hypothesis, or assumption tested by this experiment.';
            reciprocal: false;
        } | {
            field: 'related';
            direction: 'mutual';
            target: 'A materially related note without a stronger claim.';
            reciprocal: true;
        } | {
            field: 'same_as';
            direction: 'mutual';
            target: 'The same concept represented by another note or alias.';
            reciprocal: true;
        } | {
            field: 'close_match';
            direction: 'mutual';
            target: 'A near-equivalent concept useful for discovery but not safe to merge or treat as exact identity.';
            reciprocal: true;
        } | {
            field: 'version_of';
            direction: 'directional';
            target: 'The conceptual note this version belongs to.';
            reciprocal: false;
        } | {
            field: 'refines';
            direction: 'directional';
            target: 'A note made more precise or useful by this note.';
            reciprocal: false;
        })[];
        conventions: {
            scalar: string;
            lists: string;
            nested: string;
            nativeCompatibility: {
                safeTypes: string[];
                mcpManagedComplexFields: string[];
                rule: string;
            };
            lifecycle: string;
            review: string;
        };
        generatedAt: string;
    } | {
        purpose: string;
        contractFingerprint: string;
        fields: {
            name: string;
            type: "boolean" | "list" | "number" | "object" | "text";
            allowed?: readonly string[];
            appliesTo?: readonly string[];
        }[];
        relations: {
            field: "answers_questions" | "blocked_by" | "close_match" | "contradicts" | "depends_on" | "derived_from" | "implements" | "refines" | "related" | "same_as" | "supersedes" | "supports" | "tests" | "version_of";
            direction: "directional" | "mutual";
        }[];
        conventions: {
            nativeCompatibility: {
                safeTypes: string[];
                mcpManagedComplexFields: string[];
            };
            lifecycle: string;
        };
        totalFields: number;
        totalRelations: number;
        selection?: {
            mode: string;
            names: string[];
            matches: number;
            offset: number;
            returned: number;
            unknownNames?: string[];
            nextOffset?: number;
        } | {
            mode: string;
            query: string;
            matches: number;
            offset: number;
            returned: number;
            unknownNames?: string[];
            nextOffset?: number;
        };
        nextAction?: {
            endpointId: string;
            arguments: {
                names: string[];
                offset: number;
                limit: number;
                maxChars: number;
            } | {
                query: string;
                offset: number;
                limit: number;
                maxChars: number;
            };
        };
        truncated: boolean;
    } | {
        purpose: string;
        contractFingerprint: string;
        fields: string[];
        relations: {
            field: "answers_questions" | "blocked_by" | "close_match" | "contradicts" | "depends_on" | "derived_from" | "implements" | "refines" | "related" | "same_as" | "supersedes" | "supports" | "tests" | "version_of";
            direction: "directional" | "mutual";
        }[];
        conventions: {
            nativeCompatibility: {
                safeTypes: string[];
                mcpManagedComplexFields: string[];
            };
            lifecycle: string;
        };
        totalFields: number;
        totalRelations: number;
        selection?: {
            mode: string;
            names: string[];
            matches: number;
            offset: number;
            returned: number;
            unknownNames?: string[];
            nextOffset?: number;
        } | {
            mode: string;
            query: string;
            matches: number;
            offset: number;
            returned: number;
            unknownNames?: string[];
            nextOffset?: number;
        };
        nextAction?: {
            endpointId: string;
            arguments: {
                names: string[];
                offset: number;
                limit: number;
                maxChars: number;
            } | {
                query: string;
                offset: number;
                limit: number;
                maxChars: number;
            };
        };
        truncated: boolean;
    } | {
        contractFingerprint: string;
        totalFields: number;
        totalRelations: number;
        selection?: {
            mode: string;
            names: string[];
            matches: number;
            offset: number;
            returned: number;
            unknownNames?: string[];
            nextOffset?: number;
        } | {
            mode: string;
            query: string;
            matches: number;
            offset: number;
            returned: number;
            unknownNames?: string[];
            nextOffset?: number;
        };
        truncated: boolean;
        nextAction: {
            endpointId: string;
            arguments: {
                names: string[];
                offset: number;
                limit: number;
                maxChars: number;
            } | {
                query: string;
                offset: number;
                limit: number;
                maxChars: number;
            };
        } | {
            endpointId: string;
            arguments: {
                maxChars: number;
            };
        };
    };
    /**
     * Turn a top-level Property rename/value-map into exact, revision-stamped
     * notes.change_set inputs. This is a read-only planner: callers must dry-run
     * and explicitly confirm the returned change set before anything is written.
     */
    propertyMigrationPreview(principal: ScopePrincipal | undefined, options: {
        fromProperty: unknown;
        toProperty?: unknown;
        valueMap?: unknown;
        pathPrefix?: string;
        limit?: number;
        scanLimit?: number;
        maxChars?: number;
    }): Promise<{
        purpose: string;
        contractFingerprint: string;
        fromProperty: string;
        toProperty: string;
        valueMapEntries: number;
        scanned: number;
        scanLimit: number;
        scanComplete: boolean;
        matchesObserved: number;
        executableObserved: number;
        blockedObserved: number;
        changes: {
            path: string;
            expectedRevision: string;
            frontmatter: {
                set?: Record<string, unknown>;
                remove?: string[];
            };
        }[];
        blocked: {
            path: string;
            revision?: string;
            reason: string;
        }[];
        truncated: boolean;
        nextAction: {
            endpointId: string;
            instruction: string;
        } | undefined;
        generatedAt: string;
    }>;
    /**
     * Convert one complete MOC sibling ordering into an exact change set. The
     * complete-set requirement prevents an omitted sibling from being silently
     * pushed out of the intended sequence.
     */
    mocOrderPreview(principal: ScopePrincipal | undefined, options: {
        orderedMocs: unknown;
        parentPath?: string;
        startAt?: number;
        step?: number;
        maxChars?: number;
    }): Promise<{
        purpose: string;
        parent?: {
            path: string;
            revision: string;
        };
        hierarchy: {
            scannedMocs: number;
            siblingTotal: number;
        };
        currentOrder: {
            path: string;
            revision: string;
            navOrder?: number;
        }[];
        proposedOrder: {
            path: string;
            navOrder: number;
            revision?: string;
        }[];
        requiredChanges: number;
        changes: {
            path: string;
            expectedRevision: string;
            frontmatter: {
                set: {
                    nav_order: number;
                };
            };
        }[];
        blockers: {
            reason: string;
            paths?: string[];
        }[];
        valid: boolean;
        alreadyOrdered: boolean;
        nextAction: {
            endpointId: string;
            instruction: string;
        } | undefined;
        generatedAt: string;
    }>;
    /**
     * Preflight one explicit MOC or GTD-focus parent edge. The selected edge is
     * simulated against the visible graph so an apparently small Properties
     * edit cannot create a cycle, attach below a broken ancestor, or point a
     * focus item toward an equal/lower horizon.
     */
    hierarchyChangePreview(principal: ScopePrincipal | undefined, options: {
        hierarchy: unknown;
        operation: unknown;
        childPath: string;
        parentPath?: string;
        maxChars?: number;
    }): Promise<{
        purpose: string;
        hierarchy: string;
        operation: string;
        field: string;
        child: {
            path: string;
            revision: string;
            currentParent?: string;
        };
        parent?: {
            path: string;
            revision: string;
        };
        afterState: string;
        changes: {
            path: string;
            expectedRevision: string;
            frontmatter: {
                set: {
                    [x: string]: string;
                };
                remove?: never;
            } | {
                set?: never;
                remove: string[];
            };
        }[];
        blockers: {
            path?: string;
            reason: string;
        }[];
        warnings: {
            path?: string;
            reason: string;
        }[];
        valid: boolean;
        alreadyApplied: boolean;
        nextAction: {
            endpointId: string;
            instruction: string;
        } | undefined;
        generatedAt: string;
    }>;
    /** Validate and canonicalize one note's preferred and contextual MOC entry
     * points. This replaces only primary_moc/mocs and deliberately leaves the
     * legacy moc field visible for an explicit later migration. */
    mocMembershipPreview(principal: ScopePrincipal | undefined, options: {
        notePath: string;
        primaryMocPath: string;
        additionalMocPaths?: unknown;
        maxChars?: number;
    }): Promise<{
        purpose: string;
        note: {
            path: string;
            revision: string;
        };
        primaryMoc: {
            path: string;
            link: string | undefined;
        };
        additionalMocs: {
            path: string;
            link: string | undefined;
        }[];
        changes: {
            path: string;
            expectedRevision: string;
            frontmatter: {
                set: {
                    primary_moc: string;
                    mocs?: string[];
                };
                remove?: string[];
            };
        }[];
        blockers: {
            path?: string;
            reason: string;
        }[];
        warnings: {
            path?: string;
            reason: string;
        }[];
        valid: boolean;
        alreadyApplied: boolean;
        nextAction: {
            endpointId: string;
            instruction: string;
        } | undefined;
        generatedAt: string;
    }>;
    /** Replace one directional typed-relation or focus_supports list as a
     * complete, canonical set. Requiring the complete target set makes removal
     * of broken raw links explicit and avoids read-modify-write races hidden in
     * a generic metadata editor. */
    relationSetPreview(principal: ScopePrincipal | undefined, options: {
        sourcePath: string;
        relation: unknown;
        targetPaths: unknown;
        maxChars?: number;
    }): Promise<{
        purpose: string;
        relation: string;
        source: {
            path: string;
            revision: string;
            focusHorizon?: string;
        };
        current: {
            present: boolean;
            count: number;
            items: string[];
            truncated: boolean;
        };
        desired: {
            count: number;
            items: {
                path: string;
                link: string | undefined;
                revision: string;
            }[];
            truncated: boolean;
        };
        changes: {
            path: string;
            expectedRevision: string;
            frontmatter: {
                remove?: never;
                set: {
                    [x: string]: string[];
                };
            } | {
                set?: never;
                remove: string[];
            };
        }[];
        blockers: {
            path?: string;
            reason: string;
        }[];
        warnings: {
            path?: string;
            reason: string;
        }[];
        valid: boolean;
        alreadyApplied: boolean;
        nextAction: {
            endpointId: string;
            instruction: string;
        } | undefined;
        generatedAt: string;
    }>;
    /** Build a two-note reciprocal related/same_as repair without risking a
     * half-written graph edge. Existing malformed or ambiguous relation values
     * are blockers rather than data this planner silently normalizes. */
    reciprocalLinkPreview(principal: ScopePrincipal | undefined, options: {
        leftPath: string;
        rightPath: string;
        relation: unknown;
        maxChars?: number;
    }): Promise<{
        purpose: string;
        relation: string;
        left: {
            path: string;
            revision: string;
            hasReciprocalEdge: boolean;
        };
        right: {
            path: string;
            revision: string;
            hasReciprocalEdge: boolean;
        };
        changes: {
            path: string;
            expectedRevision: string;
            frontmatter: {
                set: Record<string, string[]>;
            };
        }[];
        blockers: {
            path?: string;
            reason: string;
        }[];
        valid: boolean;
        alreadyReciprocal: boolean;
        nextAction: {
            endpointId: string;
            instruction: string;
        } | undefined;
        generatedAt: string;
    }>;
    /**
     * Plan one coherent knowledge-lifecycle transition without mutating the
     * Vault. Retirement metadata and replacement lineage must change together,
     * so callers receive one revision-stamped notes.change_set instead of a
     * sequence of partially applied triage edits.
     */
    lifecycleTransitionPreview(principal: ScopePrincipal | undefined, options: {
        path: string;
        operation: unknown;
        reason: string;
        replacementPath?: string;
        targetLifecycle?: string;
        nextKnowledgeStatus?: string;
        maxChars?: number;
    }): Promise<{
        purpose: string;
        operation: string;
        source: {
            path: string;
            revision: string;
            lifecycle: string | undefined;
            knowledgeStatus: string | undefined;
        };
        replacement?: {
            path: string;
            revision: string;
            hasReverseSupersedes: boolean;
        };
        referenceImpact: Record<string, unknown>;
        changes: {
            path: string;
            expectedRevision: string;
            frontmatter: {
                set?: Record<string, unknown>;
                remove?: string[];
            };
        }[];
        blockers: {
            path?: string;
            reason: string;
        }[];
        warnings: {
            path?: string;
            reason: string;
        }[];
        valid: boolean;
        alreadyApplied: boolean;
        nextAction: {
            endpointId: string;
            instruction: string;
        } | undefined;
        generatedAt: string;
    }>;
    noteTemplate(noteKind?: string, maxChars?: number): {
        templateId: string;
        noteKind: NoteKind;
        purpose: string;
        properties: Record<string, unknown>;
        markdown: string;
        usage: string;
    } | {
        templateId: string;
        noteKind: NoteKind;
        purpose: string;
        properties: Record<string, unknown>;
        usage: string;
        markdown: string;
        truncated: boolean;
    };
    /**
     * Project-support projection for GTD-style planning. It keeps the
     * day-to-day next action separate from purpose, outcome, brainstorming, and
     * reference material, and never mutates the project note.
     */
    projectPacket(principal?: ScopePrincipal, limit?: number, maxChars?: number, options?: ProjectPacketOptions): Promise<Record<string, any>>;
    /**
     * Return executable GTD actions by context rather than burying them in
     * project-support material. The source remains ordinary Markdown
     * frontmatter on any actionable note; this is only a bounded derived view.
     */
    nextActions(principal?: ScopePrincipal, context?: string, limit?: number, maxChars?: number, options?: {
        maxMinutes?: unknown;
        energy?: unknown;
        effort?: unknown;
        prettyPrint?: boolean;
    }): Promise<Record<string, any>>;
    /**
     * Find notes where atomicity is a useful next outcome rather than an input
     * gate. This is deliberately a suggestion: the agent decides whether the
     * note should be split, expanded, or left as a composition/MOC.
     */
    compositionCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number, options?: {
        prettyPrint?: boolean;
    }): Promise<import("./organization-queue-packet.js").OrganizationQueuePacket>;
    /**
     * Preview-only Zettelkasten/Obsidian section extraction. The preview carries
     * the source revision so the caller can perform the actual write and patch
     * as one explicit optimistic-concurrency workflow.
     */
    previewSplit(params: {
        principal?: ScopePrincipal;
        path: string;
        heading: string;
        targetPath?: string;
        maxChars?: number;
    }): Promise<{
        mode: string;
        sourcePath: string;
        sourceRevision: string;
        heading: string;
        headingLevel: number;
        range: {
            startLine: number;
            endLine: number;
        };
        content: string;
        truncated: boolean;
        links: string[];
        targetPath?: string;
        targetExists?: boolean;
        targetUsable?: boolean;
        collision?: string;
        nextSteps: string[];
    }>;
    /**
     * Advance only the progressive projection of an existing note. The body is
     * never resubmitted or rewritten; triage supplies the current body digest
     * and optimistic revision check while preserving every unrelated property.
     */
    updateProjection(params: {
        principal?: ScopePrincipal;
        path: string;
        summary?: string;
        keyPoints?: unknown;
        openQuestions?: unknown;
        summaryLayer?: unknown;
        summaryHighlights?: unknown;
        expectedRevision: string;
    }): Promise<{
        projection: {
            summaryLayer: any;
            summaryFresh: boolean;
            summaryFingerprint: any;
            bodyChanged: boolean;
        };
        nextAction: string;
        success: boolean;
        path: string;
        revision: string;
        clearedProperties?: string[];
        inapplicableProperties?: string[];
        frontmatter: any;
    }>;
    triage(params: {
        tags?: unknown;
        timeEstimateMinutes?: unknown;
        energy?: unknown;
        effort?: unknown;
        principal?: ScopePrincipal;
        path: string;
        noteKind?: string;
        lifecycle?: string;
        decisionStatus?: unknown;
        primaryMoc?: string;
        moc?: string;
        mocs?: unknown;
        navOrder?: unknown;
        project?: string;
        reviewAt?: string;
        reviewIntervalDays?: unknown;
        volatilityClass?: unknown;
        nextAction?: string;
        waitingFor?: string;
        aliases?: unknown;
        summary?: string;
        keyPoints?: unknown;
        openQuestions?: unknown;
        summaryLayer?: unknown;
        summaryHighlights?: unknown;
        nextActions?: unknown;
        desiredOutcome?: string;
        projectPurpose?: string;
        projectSupport?: unknown;
        taskContext?: string;
        dueAt?: string;
        scheduledAt?: string;
        deferUntil?: string;
        serviceClass?: unknown;
        completionCriteria?: unknown;
        startedAt?: unknown;
        blockedSince?: unknown;
        waitingSince?: unknown;
        completedAt?: unknown;
        stableId?: string;
        canonicalPath?: string;
        recallPrompt?: string;
        recallIntervalDays?: unknown;
        lastRecalledAt?: string;
        recallQuality?: unknown;
        retentionPolicy?: unknown;
        retentionEvent?: unknown;
        retentionAt?: unknown;
        preserveUntil?: unknown;
        legalHold?: unknown;
        retentionReason?: string;
        archiveReason?: string;
        replacedBy?: string;
        reviewSnoozedUntil?: unknown;
        reviewSnoozeReason?: unknown;
        knowledgeRole?: unknown;
        termStatus?: string;
        termReplacedBy?: string;
        termScopeNote?: string;
        preferredTerm?: string;
        termLanguage?: string;
        authorityScheme?: string;
        authorityId?: string;
        disambiguation?: string;
        broaderTerms?: unknown;
        relatedTerms?: unknown;
        subjectTerms?: unknown;
        domain?: string;
        methods?: unknown;
        audience?: unknown;
        retrievalCues?: unknown;
        useWhen?: string;
        validFrom?: string;
        validUntil?: string;
        observedAt?: string;
        temporalScope?: string;
        seeAlso?: unknown;
        relations?: unknown;
        relationNotes?: unknown;
        relationEvidence?: unknown;
        taskStatus?: unknown;
        knowledgeNotes?: unknown;
        negativeKnowledgeNotes?: unknown;
        retrospective?: unknown;
        noReusableKnowledge?: unknown;
        knowledgeDispositionReason?: unknown;
        reviewPolicy?: unknown;
        reviewOutcome?: unknown;
        reviewedBy?: string;
        reviewedAt?: string;
        reviewNote?: string;
        reviewChecks?: unknown;
        reviewOpenItems?: unknown;
        interpretationStatus?: unknown;
        epistemicStatus?: unknown;
        polarity?: unknown;
        negativeType?: unknown;
        attempted?: string;
        observed?: string;
        failureCondition?: string;
        affectedScope?: string;
        reproduction?: string;
        whyRejected?: string;
        reusableLesson?: string;
        replacementPath?: string;
        clarifyDisposition?: unknown;
        clarifiedBy?: string;
        clarifiedAt?: string;
        clarifyNote?: string;
        triageTarget?: string;
        mocPurpose?: string;
        mocScope?: string;
        mocQuestions?: unknown;
        mocParent?: string;
        focusHorizon?: unknown;
        focusParent?: string;
        focusSupports?: unknown;
        clearInapplicable?: boolean;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        path: string;
        revision: string;
        clearedProperties?: string[];
        inapplicableProperties?: string[];
        nextAction?: {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string;
                clearInapplicable: boolean;
            };
            instruction: string;
        };
        frontmatter: any;
    }>;
    readProjection(params: {
        principal?: ScopePrincipal;
        path: string;
        view?: WikiProjectionView;
        section?: string;
        blockId?: string;
        contextBefore?: number;
        contextAfter?: number;
        maxChars?: number;
    }): Promise<{
        dateIssues?: string[];
        dateRepairAction?: {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string | undefined;
                maxChars: number;
            };
        };
        dateRepairGuidance?: string;
        dueAt: string | undefined;
        scheduledAt: string | undefined;
        deferUntil: string | undefined;
        lastRecalledAt: string | undefined;
        retentionAt: string | undefined;
        preserveUntil: string | undefined;
        reviewedAt: string | undefined;
        clarifiedAt: string | undefined;
        path: string;
        title: string;
        view: "full" | "key_points" | "outline" | "progressive" | "section" | "summary";
        revision: string;
        noteKind: any;
        lifecycle: any;
        redirect?: {
            state: string;
            replacement?: string;
            reason?: string;
            action: string;
            note: string;
        };
        navigation?: {
            primaryMoc?: string;
            moc?: string;
            mocs?: any[];
            project?: string;
            termStatus?: string;
            termScopeNote?: string;
            authority?: {
                preferredTerm: string;
                variantTerms?: any[];
                status?: string;
                disambiguation?: string;
                scopeNote?: string;
                useInstead?: string;
            };
            domain?: string;
            broaderTerms?: any[];
            relatedTerms?: any[];
            subjectTerms?: any[];
            relations?: {
                [k: string]: unknown[];
            };
            relationNotes?: {
                [k: string]: string;
            };
            relationEvidence?: {
                [k: string]: string[];
            };
        };
        status: any;
        confidence: any;
        temporal?: {
            state: TemporalValidityState;
            asOf: string;
            validFrom?: string;
            validUntil?: string;
            observedAt?: string;
            temporalScope?: string;
            reason?: string;
        };
        aliases?: any[];
        summary?: string;
        keyPoints?: any[];
        openQuestions?: any[];
        summaryLayer?: any;
        summaryHighlights?: any[];
        claims?: any[];
        nextActions?: any[];
        nextAction?: string;
        waitingFor?: string;
        desiredOutcome?: string;
        projectPurpose?: string;
        projectSupport?: any[];
        taskContext?: string;
        stableId?: string;
        canonicalPath?: string;
        recallPrompt?: string;
        recallIntervalDays?: any;
        recallQuality?: string;
        retentionPolicy?: string;
        retentionEvent?: string;
        legalHold?: boolean;
        retrievalCues?: any[];
        useWhen?: string;
        taskStatus?: string;
        reviewPolicy?: string;
        reviewOutcome?: string;
        reviewedBy?: string;
        reviewNote?: string;
        reviewChecks?: any[];
        reviewOpenItems?: any[];
        reviewedRevision?: string;
        reviewTrigger?: string;
        reviewCount?: any;
        reviewReopenCount?: any;
        interpretationStatus?: string;
        disposition?: string;
        clarifiedBy?: string;
        clarifyNote?: string;
        targetPath?: string;
        mocPurpose?: string;
        mocScope?: string;
        mocQuestions?: any[];
        mocParent?: string;
        focusHorizon?: string;
        focusParent?: string;
        focusSupports?: any[];
        epistemicStatus?: string;
        polarity?: string;
        negativeType?: string;
        attempted?: string;
        observed?: string;
        failureCondition?: string;
        affectedScope?: string;
        reproduction?: string;
        whyRejected?: string;
        reusableLesson?: string;
        replacementPath?: string;
        summaryFingerprint?: string;
        summaryFresh?: boolean;
        summaryStale?: boolean;
        relations: {
            [k: string]: any;
        };
        section?: {
            startLine: number;
            endLine: number;
            requested: string | undefined;
        };
        context?: {
            before: Array<{
                line: number;
                text: string;
            }>;
            target: {
                startLine: number;
                endLine: number;
            };
            after: Array<{
                line: number;
                text: string;
            }>;
        };
        contentSource?: string;
        excerptRange?: {
            startLine: number;
            endLine: number;
        };
        headings?: import("./types.js").NoteHeading[];
        content: string;
        truncated: boolean;
        references: string[];
        evidence: {
            heading?: string;
            blockId?: string;
            revision?: string;
            startLine?: number;
            endLine?: number;
            quoteHash?: string;
            path: string;
        }[];
    }>;
    impactReport(principal?: ScopePrincipal, limit?: number, maxChars?: number, maxCascadeDepth?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        generatedAt: string;
        cascade: {
            maxDepth: number;
            scanned: number;
            edgeCount: number;
            seedCount: number;
            truncated: boolean;
        };
    }>;
    exportBasesView(principal?: ScopePrincipal, noteKind?: string, lifecycle?: string, limit?: number, maxChars?: number, requestedView?: string): Promise<{
        format: string;
        suggestedPath: string;
        content: string;
        truncated: boolean;
        matchingNotes: any;
        matchingNotesExact: boolean;
        matchingNotesMeaning: string;
        actionScope?: string;
        dependencyAware?: boolean;
        recommendedEndpoint?: string;
        dependencyNote?: string;
        view: string;
        availableViews: {
            id: string;
            name: string;
            suggestedPath: string;
        }[];
        filter: {
            noteKind?: string;
            lifecycle?: string;
        };
        note: string;
    }>;
    /** Persist one generated Bases projection with an explicit file revision. */
    writeBasesView(params: {
        principal?: ScopePrincipal;
        view?: string;
        noteKind?: string;
        lifecycle?: string;
        limit?: number;
        maxChars?: number;
        path?: string;
        expectedRevision: string;
    }): Promise<{
        format: string;
        suggestedPath: string;
        content: string;
        truncated: boolean;
        matchingNotes: any;
        matchingNotesExact: boolean;
        matchingNotesMeaning: string;
        actionScope?: string;
        dependencyAware?: boolean;
        recommendedEndpoint?: string;
        dependencyNote?: string;
        view: string;
        availableViews: {
            id: string;
            name: string;
            suggestedPath: string;
        }[];
        filter: {
            noteKind?: string;
            lifecycle?: string;
        };
        persisted: boolean;
        path: string;
        previousRevision: string;
        revision: string;
        note: string;
    }>;
    private buildSpatialCanvasGraph;
    private fitSpatialCanvasGraph;
    /** Preview one bounded MOC or neighborhood as an Obsidian JSON Canvas. */
    canvasView(principal: ScopePrincipal | undefined, path: string, mode?: unknown, maxDepth?: unknown, limit?: unknown, maxChars?: unknown, includeSemantic?: boolean): Promise<Record<string, any>>;
    private assertCurrentCanvasSources;
    /** Persist a fresh derived Canvas after rechecking every included revision. */
    writeCanvasView(params: {
        principal?: ScopePrincipal;
        path: string;
        mode?: unknown;
        maxDepth?: unknown;
        limit?: unknown;
        maxChars?: unknown;
        includeSemantic?: boolean;
        outputPath?: string;
        expectedSourceRevision?: string;
        expectedSnapshotFingerprint?: string;
        expectedRevision: string;
    }): Promise<{
        persisted: boolean;
        path: string;
        previousRevision: string;
        revision: string;
        source: any;
        snapshotFingerprint: any;
        counts: any;
        truncated: any;
        note: string;
    }>;
    /** Inspect scope-visible derived Canvases for stale or missing source guards. */
    canvasHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        counts: {
            total: number;
            inspected: number;
            sourceChecks: number;
        };
        recommendations: string[];
        advisory: boolean;
        generatedAt: string;
        items: Record<string, any>[];
        truncated: boolean;
    }>;
    /**
     * Return a derived launchpad for an authorized scope. This is the
     * scope-local equivalent of an Obsidian Home note/JDex: it points at live
     * notes but never creates a competing index or grants access.
     */
    home(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        scope: string;
        purpose: string;
        routingRule: string;
        suggestedHomePath: string;
        suggestedIndexPath: string;
        entrypoints: {
            path: string;
            reason: string;
        }[];
        counts: {
            total: number;
            mocs: number;
            projects: number;
            actionableWork: number;
            openWork: number;
            inbox: number;
            review: number;
            decisions: number;
            archivedSources: number;
            stableIds: number;
        };
        nextAction: {
            requiredArguments?: never;
            endpointId: string;
            arguments: {
                query?: never;
                limit: number;
                maxChars: number;
            };
            reason: string;
        } | {
            endpointId: string;
            arguments: {
                query: string;
                limit: number;
                maxChars: number;
            };
            requiredArguments: string[];
            reason: string;
        };
        workflowRoutes: ({
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                expectedRevision?: never;
                query: string;
                limit: number;
                maxChars: number;
                intent?: never;
                maxDepth?: never;
                path?: never;
                mode?: never;
                context?: never;
                includeReadiness?: never;
            };
            requiredArguments: string[];
            mutating?: never;
            followUpEndpointId?: never;
        } | {
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                query?: never;
                expectedRevision: string;
                intent?: never;
                maxDepth?: never;
                path?: never;
                mode?: never;
                context?: never;
                includeReadiness?: never;
                limit?: never;
                maxChars?: never;
            };
            requiredArguments: string[];
            mutating: boolean;
            followUpEndpointId?: never;
        } | {
            mutating?: never;
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                expectedRevision?: never;
                query?: never;
                limit: number;
                maxChars: number;
                intent?: never;
                maxDepth?: never;
                path?: never;
                mode?: never;
                context?: never;
                includeReadiness?: never;
            };
            followUpEndpointId: string;
            requiredArguments?: never;
        } | {
            mutating?: never;
            followUpEndpointId?: never;
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                expectedRevision?: never;
                query?: never;
                path: string;
                intent: string;
                limit: number;
                maxChars: number;
                maxDepth?: never;
                mode?: never;
                context?: never;
                includeReadiness?: never;
            };
            requiredArguments: string[];
        } | {
            mutating?: never;
            followUpEndpointId?: never;
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                expectedRevision?: never;
                query?: never;
                intent?: never;
                limit: number;
                maxChars: number;
                maxDepth?: never;
                path?: never;
                mode?: never;
                context?: never;
                includeReadiness?: never;
            };
            requiredArguments?: never;
        } | {
            mutating?: never;
            followUpEndpointId?: never;
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                expectedRevision?: never;
                query?: never;
                intent?: never;
                path: string;
                maxDepth: number;
                limit: number;
                maxChars: number;
                mode?: never;
                context?: never;
                includeReadiness?: never;
            };
            requiredArguments: string[];
        } | {
            mutating?: never;
            followUpEndpointId?: never;
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                expectedRevision?: never;
                query?: never;
                intent?: never;
                maxDepth?: never;
                path: string;
                mode: string;
                limit: number;
                maxChars: number;
                context?: never;
                includeReadiness?: never;
            };
            requiredArguments: string[];
        } | {
            mutating?: never;
            followUpEndpointId?: never;
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                expectedRevision?: never;
                query?: never;
                intent?: never;
                maxDepth?: never;
                path?: never;
                mode?: never;
                context: string;
                limit: number;
                maxChars: number;
                includeReadiness?: never;
            };
            requiredArguments: string[];
        } | {
            mutating?: never;
            followUpEndpointId?: never;
            requiredArguments?: never;
            intent: string;
            useWhen: string;
            endpointId: string;
            arguments: {
                expectedRevision?: never;
                query?: never;
                intent?: never;
                maxDepth?: never;
                path?: never;
                mode?: never;
                context?: never;
                includeReadiness: boolean;
                limit: number;
                maxChars: number;
            };
        })[];
        mocs: {
            resolvedParent?: string;
            childTotal: number;
            depth: number;
            state: string;
            title: string;
            revision?: string;
            aliases?: unknown;
            preferredTerm?: unknown;
            stableId?: unknown;
            parent?: string;
            navOrder?: number;
            path: string;
            children: string[];
            childrenTruncated: boolean;
        }[];
        mocOrdering: string;
        mocOrderPlanner: {
            endpointId: string;
            requirement: string;
        };
        hierarchyPlanner: string;
        mocMembershipPlanner: string;
        relationSetPlanner: string;
        projects: Record<string, unknown>[];
        inbox: Record<string, unknown>[];
        review: Record<string, unknown>[];
        stableIds: Record<string, unknown>[];
        truncated: boolean;
    } | {
        scope: string;
        counts: {
            total: number;
            mocs: number;
            projects: number;
            actionableWork: number;
            openWork: number;
            inbox: number;
            review: number;
            decisions: number;
            archivedSources: number;
            stableIds: number;
        };
        nextAction: {
            requiredArguments?: never;
            endpointId: string;
            arguments: {
                query?: never;
                limit: number;
                maxChars: number;
            };
            reason: string;
        } | {
            endpointId: string;
            arguments: {
                query: string;
                limit: number;
                maxChars: number;
            };
            requiredArguments: string[];
            reason: string;
        };
        routingRule: string;
        truncated: boolean;
    }>;
    graphHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number, snapshotAccess?: (path: string) => boolean): Promise<{
        unresolvedLinks: {
            total: number;
            items: {
                target: string;
                line: number;
                link: string;
                context: string;
                heading?: string;
                targetHeading?: string;
                targetBlockId?: string;
                relation?: string;
                sourceClaimId?: string;
                propertyPath?: string;
                path: string;
            }[];
            truncated: boolean;
        };
        orphanNotes: {
            total: number;
            items: {
                incomingLinks: number;
                path: string;
            }[];
            truncated: boolean;
        };
        emptyMocs: {
            total: number;
            items: Record<string, unknown>[];
            truncated: boolean;
        };
        mocCount: number;
        mocCoverage: {
            knowledgeTotal: number;
            knowledgeLinkedFromMoc: number;
            ratio: number;
            uncoveredKnowledge: {
                total: number;
                items: {
                    path: string;
                }[];
                truncated: boolean;
            };
            mocs: Record<string, unknown>[];
            truncated: boolean;
        };
        mocQuestionCoverage: {
            total: number;
            linked: number;
            ratio: number;
            unlinked: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            mocs: Record<string, unknown>[];
            truncated: boolean;
        };
        mocSequenceHealth?: {
            mocsAnalyzed: number;
            needsAttention: number;
            ready: number;
            latePrerequisites: number;
            externalPrerequisites: number;
            unresolved: number;
            ambiguous: number;
            cycleOrBlockedEntries: number;
            dependencyCycles: number;
            cyclicEntries: number;
            blockedByCycleEntries: number;
            redundantPrerequisiteEdges: number;
            claimDependencyEdges: number;
            items: {
                [x: string]: unknown;
            }[];
            truncated: boolean;
            note: string;
        };
        mocHierarchy?: {
            total: number;
            explicitParentEdges: number;
            roots: {
                total: number;
                items: string[];
                truncated: boolean;
            };
            missingParents: {
                total: number;
                items: {
                    reason: string;
                    path: string;
                    parent: string;
                    repair: {
                        endpointId: string;
                        arguments: {
                            hierarchy: string;
                            childPath: string;
                        };
                        requiredArguments: string[];
                    };
                }[];
                truncated: boolean;
            };
            ambiguousParents: {
                total: number;
                items: {
                    reason: string;
                    path: string;
                    parent: string;
                    matches: string[];
                    matchesTruncated: boolean;
                    repair: {
                        endpointId: string;
                        arguments: {
                            hierarchy: string;
                            childPath: string;
                        };
                        requiredArguments: string[];
                    };
                }[];
                truncated: boolean;
            };
            cycles: {
                total: number;
                items: {
                    reason: string;
                    nodes: string[];
                    nodeTotal: number;
                    truncated: boolean;
                    repair: {
                        endpointId: string;
                        arguments: {
                            hierarchy: string;
                            operation: string;
                            childPath: string;
                        };
                    } | undefined;
                }[];
                truncated: boolean;
            };
            maxDepth: number;
            items: {
                resolvedParent?: string;
                childTotal: number;
                depth: number;
                state: string;
                title: string;
                aliases: unknown;
                preferredTerm: unknown;
                stableId: unknown;
                navOrder: number | undefined;
                parent: string | undefined;
                path: string;
                children: string[];
                childrenTruncated: boolean;
            }[];
            truncated: boolean;
            ordering: string;
        };
        evergreenQuality: {
            total: number;
            needsAttention: number;
            ready: number;
            items: Record<string, unknown>[];
            truncated: boolean;
        };
        focusHealth: {
            focusedNotes: number;
            declaredParentEdges?: number;
            parentEdges: number;
            supportEdges: number;
            horizonCounts: {
                [k: string]: number;
            };
            unresolved: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            ambiguous: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            horizonMismatches?: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            unparented: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            cycles: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            reverseMap: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
        };
        knowledgeConnectivity: {
            total: number;
            isolated: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            isolatedAtomic: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            atomicWithoutProjection: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            literatureWithoutPermanent: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            literatureWithoutInterpretation: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
        };
        epistemicConsistency: {
            total: number;
            needsAttention: number;
            consistent: number;
            items: Record<string, unknown>[];
            truncated: boolean;
        };
        knowledgeFlow: {
            stages: {
                unprocessed: number;
                interpreted: number;
                synthesized: number;
                unspecified: number;
            };
            literatureWithoutSource: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            synthesisWithoutInputs: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
        };
        knowledgeUsage: {
            total: number;
            used: number;
            unused: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            lifecycle: Record<string, number>;
            duplicateTerms: {
                total: number;
                items: {
                    term: string;
                    paths: string[];
                    reason: string;
                }[];
                truncated: boolean;
            };
            leastUsed: {
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            hubs?: {
                total: number;
                threshold: number;
                items: {
                    reason: string;
                    threshold: number;
                }[];
                truncated: boolean;
            };
            note: string;
        };
        typedRelations: {
            unresolved: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            ambiguous: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            self: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            kindMismatches: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
            reciprocityMissing: {
                total: number;
                items: Record<string, unknown>[];
                truncated: boolean;
            };
        };
        relationNavigation?: {
            targets: {
                path: string;
                total: number;
                incoming: {
                    relation: string;
                    meaning: string;
                    total: number;
                    paths: string[];
                }[];
            }[];
            totalTargets: number;
            truncated: boolean;
            note: string;
        };
    } | {
        truncated: boolean;
        note: string;
    }>;
    /** Suggest structure notes for knowledge that currently has no MOC path.
     * Suggestions are deliberately derived and bounded; this method never
     * creates a MOC or rewrites a note. */
    mocCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        candidates: never[];
        total: number;
        note: string;
        truncated: boolean;
        uncoveredKnowledgeTotal?: never;
    } | {
        note?: never;
        candidates: Record<string, unknown>[];
        total: number;
        uncoveredKnowledgeTotal: number;
        truncated: boolean;
    }>;
    /** Explain how an overloaded authored MOC could be split without changing
     * it. Existing sections remain the first organizing signal, followed by
     * explicit Obsidian/Properties structure. */
    mocRebalance(principal: ScopePrincipal | undefined, path: string, maxBranches?: number, limit?: number, maxChars?: number, saturationThreshold?: number): Promise<Record<string, any> | {
        mode: string;
        root: {
            path: string;
            revision: string;
        };
        memberTotal: number;
        saturationThreshold: number;
        rebalanceRecommended: boolean;
        mutates: boolean;
        truncated: boolean;
    }>;
    /** Render collection signals from the same verified lint note snapshots. */
    collectionHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number, basis?: WikiLintResult): Promise<import("./collection-health.js").CollectionReport>;
    organizationHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<any>;
    /**
     * Return a derived maintenance ledger.  It deliberately reports debt rather
     * than persisting another task database: Markdown, Properties, and Git stay
     * authoritative while agents get a small, explainable repair queue.
     */
    maintenanceDebt(principal?: ScopePrincipal, olderThanDays?: number, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        olderThanDays: number;
        scanned: number;
        debtTotal: number;
        counts: Record<string, number>;
        items: Record<string, unknown>[];
        truncated: boolean;
        generatedAt: string;
    } | {
        olderThanDays: number;
        debtTotal: number;
        counts: Record<string, number>;
        item?: {
            path: any;
            revision: any;
            reasons: any;
            priority: any;
        };
        nextAction?: any;
        then?: {
            endpointId: any;
        } | undefined;
        truncated: boolean;
    } | {
        debtTotal: number;
        path?: any;
        revision?: any;
        nextEndpoint?: any;
        truncated: boolean;
    }>;
    /**
     * Build one small answer-oriented context packet.  It keeps the source
     * projection authoritative, adds a few explainable neighbors, and reserves
     * room for a counterexample or negative knowledge instead of returning a
     * large semantic dump.
     */
    private evidenceDiversityFor;
    private evidenceDiversity;
    /**
     * Project claim-level evidence coverage without loading source bodies into the
     * response. Authored claim order remains stable; a separate attention list
     * prioritizes repair so the projection does not silently reorder the note.
     */
    claimMatrix(principal: ScopePrincipal | undefined, path: string, limit?: number, maxChars?: number): Promise<{
        path: string;
        revision: string;
        temporal: {
            state: TemporalValidityState;
            asOf: string;
            validFrom?: string;
            validUntil?: string;
            observedAt?: string;
            temporalScope?: string;
            reason?: string;
        };
        totalClaims: number;
        scannedClaims: number;
        returnedClaims: number;
        countsForReturnedClaims: Record<string, any>;
        authoredOrder: Record<string, any>[] | {
            order: any;
            claimId: any;
            status: any;
            signals: any;
        }[];
        attention: {
            claimId: any;
            signals: any;
            score: number;
        }[];
        nextAction?: {
            arguments?: never;
            endpointId: string;
            requiredArguments: string[];
            reason: string;
        } | {
            endpointId: string;
            arguments: {
                path: string;
                claimId: any;
                expectedRevision: string;
            };
            requiredArguments: string[];
            reason: string;
        };
        truncated: boolean;
        note: string;
    } | {
        path: string;
        revision: string;
        totalClaims: number;
        claim?: {
            claimId: any;
            status: any;
            signals: any;
        };
        truncated: boolean;
        note: string;
    }>;
    /**
     * Build a bounded claim-to-claim argument map from structured claim metadata.
     * Relations remain ordinary Obsidian block links; this projection verifies
     * that both the structured claim id and its Markdown block anchor exist.
     */
    argumentMap(principal: ScopePrincipal | undefined, path: string, claimIdFilter?: string, maxDepth?: number, limit?: number, maxChars?: number): Promise<{
        mode: string;
        path: string;
        revision: string;
        selectedClaimId?: string;
        maxDepth: number;
        scannedNotes: number;
        scannedClaims: number;
        nodes: ({
            path: string;
            claimId: string;
            depth: number | undefined;
            role?: string;
            anchorFound: boolean;
        } | {
            id: string;
            path: string;
            revision: string;
            claimId: string;
            depth: number | undefined;
            order: number;
            text: string;
            status: string;
            confidence: string;
            role?: string;
            locator: {
                blockId: string;
                line?: number;
                navigable: boolean;
            };
        })[];
        edges: {
            from: string;
            to: string;
            relation: string;
            authoredLink?: string;
            navigable: boolean;
        }[];
        issues: {
            countForReturnedNodes: number;
            items: {
                code: string;
                source: string;
                detail: string;
                target?: string;
            }[];
        };
        cycles?: {
            relation: string;
            nodes: string[];
        }[];
        truncated: boolean;
        note: string;
    } | {
        mode: string;
        path: string;
        revision: string;
        nodes: {
            claimId: string;
        }[];
        truncated: boolean;
        note: string;
    }>;
    private assertCurrentContextSources;
    answerPacket(principal: ScopePrincipal | undefined, path: string, maxChars?: number, includeSemantic?: boolean, intent?: AnswerPacketIntent): Promise<Record<string, any>>;
    /**
     * Turn an authored MOC outline into a bounded, dependency-aware reading
     * path. The Markdown order remains authoritative; the topological order is
     * returned separately as an advisory projection and never mutates notes.
     */
    learningPath(principal: ScopePrincipal | undefined, path: string, maxDepth?: number, limit?: number, maxChars?: number, checkpointOnly?: boolean, prettyPrint?: boolean): Promise<{
        nextAction?: never;
        mode: string;
        root: {
            path: string;
            revision: string;
        };
        sourceRevisionFingerprint: string;
        authoredOrder: {
            path: string;
            revision: string;
            title: string;
            noteKind: string;
            lifecycle?: string;
            knowledgeRole?: string;
            authoredPosition: number;
            depth: number;
            parentMoc: string;
            line: number;
            section?: string;
            targetHeading?: string;
            targetBlockId?: string;
        }[];
        recommendedOrder: string[];
        summary: {
            entries: number;
            omittedEntries: number;
        };
        truncated: boolean;
        navigationComplete: boolean;
        authoredOrderConsistent?: never;
        prerequisiteCoverageComplete?: never;
        detailsOmitted?: never;
        omittedEntries?: never;
        message?: never;
    } | {
        mode: string;
        purpose: string;
        root: {
            path: string;
            title: string;
            revision: string;
        };
        authoredOrder: {
            path: string;
            revision: string;
            title: string;
            noteKind: string;
            lifecycle?: string;
            knowledgeRole?: string;
            authoredPosition: number;
            depth: number;
            parentMoc: string;
            line: number;
            section?: string;
            targetHeading?: string;
            targetBlockId?: string;
        }[];
        recommendedOrder: string[];
        recommendedStages: {
            stage: number;
            entries: {
                path: string;
                revision: string;
                authoredPosition: number;
                internalPrerequisiteCount: number;
                externalPrerequisiteCount: number;
            }[];
        }[];
        orderChanged: boolean;
        authoredOrderConsistent: boolean;
        prerequisiteCoverageComplete: boolean;
        navigationComplete: boolean;
        prerequisiteEdges: Record<string, unknown>[];
        redundantPrerequisiteEdges: {
            prerequisite: string;
            prerequisiteRevision: string;
            dependent: string;
            dependentRevision: string;
            directDependencyTypes: ("claim" | "note")[];
            alternatePath: {
                path: string;
                revision: string;
            }[];
            guidance: string;
        }[];
        unlockPoints: {
            path: string;
            revision: string;
            stage: number | undefined;
            directDependents: number;
            downstreamDependents: number;
        }[];
        dependencyCycles: {
            cycleId: string;
            notes: {
                path: string;
                revision: string;
                authoredPosition: number;
            }[];
            edges: {
                prerequisite: string;
                dependent: string;
                dependencyType: "claim" | "note";
                sourceClaimId?: string;
                targetClaimId?: string;
            }[];
            truncated: boolean;
        }[];
        cycleBlockedDependents: {
            path: string;
            revision: string;
            blockedByCycleIds: string[];
            guidance: string;
        }[];
        externalPrerequisites: Record<string, unknown>[];
        orderIssues: Record<string, unknown>[];
        navigationIssues: Record<string, unknown>[];
        summary: {
            entries: number;
            mocsVisited: number;
            authoredLinksScanned: number;
            dependencyEdges: number;
            noteDependencyEdges: number;
            claimDependencyEdges: number;
            dependencyCycles: number;
            cyclicEntries: number;
            cycleBlockedDependents: number;
            recommendedStages: number;
            parallelStages: number;
            stagedEntries: number;
            redundantPrerequisiteEdges: number;
            unlockPoints: number;
            latePrerequisites: number;
            externalPrerequisites: number;
            orderIssues: number;
            navigationIssues: number;
            omittedEntries: number;
        };
        checkpointAction: {
            endpointId: string;
            learningProgress: {
                rootPath: string;
                order: string;
                maxDepth: number;
            };
        };
        guidance: string;
        truncated: boolean;
    } | {
        mode: string;
        root: {
            path: string;
            revision: string;
        };
        authoredOrder: {
            path: string;
            revision: string;
            targetHeading?: string;
            targetBlockId?: string;
        }[];
        recommendedOrder: string[];
        summary: {
            entries: number;
            omittedEntries: number;
            dependencyCycles: number;
            orderIssues: number;
        };
        authoredOrderConsistent: boolean;
        prerequisiteCoverageComplete: boolean;
        navigationComplete: boolean;
        nextAction: {
            arguments?: never;
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                maxChars: number;
                prettyPrint: boolean;
            };
        } | {
            reuseOriginalArguments?: never;
            overrides?: never;
            endpointId: string;
            arguments: {
                path: string;
                maxChars: number;
            };
        };
        detailsOmitted: boolean;
        truncated: boolean;
    } | {
        root?: never;
        sourceRevisionFingerprint?: never;
        mode: string;
        authoredOrder: never[];
        recommendedOrder: never[];
        navigationComplete: boolean;
        authoredOrderConsistent: boolean;
        prerequisiteCoverageComplete: boolean;
        summary: {
            entries: number;
            omittedEntries: number;
            dependencyCycles: number;
            orderIssues: number;
        };
        truncated: boolean;
        detailsOmitted: boolean;
        omittedEntries: number;
        message: string;
        nextAction: {
            arguments?: never;
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                maxChars: number;
                prettyPrint: boolean;
            };
        } | {
            reuseOriginalArguments?: never;
            overrides?: never;
            endpointId: string;
            arguments: {
                path: string;
                maxChars: number;
            };
        };
    }>;
    /**
     * Build a reusable shelf-like context projection without persisting a
     * second index.  The selected note remains the entry point; the existing
     * answer packet supplies the bounded supporting and counterpoint context.
     */
    contextPack(principal: ScopePrincipal | undefined, path: string, maxChars?: number, includeSemantic?: boolean, intent?: AnswerPacketIntent): Promise<{
        mode: string;
        root: {
            path: any;
            revision: any;
        };
        readOrder: any[];
        entrypoints: Array<Record<string, any>>;
        truncated: boolean;
    }>;
    /**
     * Present existing organization, graph, and quarantine findings as one
     * bounded visual-management board.  It is intentionally a projection:
     * Markdown, Properties, and Git remain authoritative.
     */
    exceptionBoard(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<import("./exception-board.js").ExceptionBoardResult>;
    /**
     * Check one note against a small role-specific quality rubric.  The rubric
     * is advisory and deliberately does not become a publication gate.
     */
    qualityCheck(principal: ScopePrincipal | undefined, path: string, maxChars?: number): Promise<{
        path: string;
        title: string;
        noteKind: string;
        knowledgeRole?: string;
        revision: string;
        score: {
            passed: number;
            total: number;
            ratio: number;
        };
        checks: {
            id: string;
            passed: boolean;
            detail: string;
            state?: string;
        }[];
        nextActions: string[];
        nextAction?: {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string;
                maxChars: number;
            };
        };
        assessment: string;
        advisory: boolean;
        note: string;
    } | {
        path: string;
        revision: string;
        score: {
            passed: number;
            total: number;
            ratio: number;
        };
        assessment: string;
        advisory: boolean;
        nextAction?: {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string;
                maxChars: number;
            };
        };
        checks: {
            id: string;
            passed: boolean;
            detail?: string;
            state?: string;
        }[];
        truncated: boolean;
    } | {
        advisory: boolean;
        assessment: string;
        truncated: boolean;
        retry: {
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                maxChars: number;
            };
        };
    }>;
    /**
     * Rediscover inactive notes only when current visible notes still point at
     * them.  This preserves PARA's “forget without deleting” behavior without
     * automatically reopening or moving archived knowledge.
     */
    resurfaceArchivedKnowledge(principal?: ScopePrincipal, limit?: number, maxChars?: number, afterPath?: string): Promise<{
        items: never[];
        truncated: boolean;
        retry: {
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                maxChars: number;
            };
        };
        reason: string;
    } | {
        totalInactive: number;
        probed: number;
        nextScan?: {
            endpointId: string;
            arguments: {
                afterPath: string;
                limit: number;
                maxChars: number;
            };
        };
        referenceScanTruncated?: boolean;
        referencesNextAction?: {
            endpointId: string;
            arguments: {
                path: string;
                offset: number;
                limit: number;
                maxChars: number;
            };
        };
        items: Record<string, any>[];
        selectionTruncated: boolean;
        truncated: boolean;
    } | {
        totalInactive: number;
        probed: number;
        nextScan?: {
            endpointId: string;
            arguments: {
                afterPath: string;
                limit: number;
                maxChars: number;
            };
        };
        referenceScanTruncated?: boolean;
        referencesNextAction?: {
            endpointId: string;
            arguments: {
                path: string;
                offset: number;
                limit: number;
                maxChars: number;
            };
        };
        items: {
            path: any;
            revision: any;
            nextAction: any;
            candidateTruncated: boolean;
        }[];
        selectionTruncated: boolean;
        truncated: boolean;
    }>;
    /**
     * Expose a small library-like authority view derived from note titles,
     * aliases, and stable IDs.  It suggests preferred access terms but never
     * renames notes or creates a second taxonomy.
     */
    authorityMap(principal?: ScopePrincipal, options?: {
        query?: unknown;
        scheme?: unknown;
        aroundAuthorityId?: unknown;
        includeUnclassified?: boolean;
        limit?: unknown;
        maxChars?: unknown;
    }): Promise<{
        purpose: string;
        scheme: string;
        order: string;
        query?: string;
        anchor: {
            requested?: string;
            matched: boolean;
            insertionIndex: number;
        };
        entries: {
            path: string;
            title: string;
            authorityId?: string;
            preferredTerm: string;
            revision: string;
            aliases?: string[];
            closeMatches?: string[];
        }[];
        collisions: {
            authorityId: string;
            paths: string[];
        }[];
        totalVisible: number;
        truncated: boolean;
    } | {
        purpose: string;
        query: string | undefined;
        entries: {
            term: string;
            preferred: string;
            address: string;
            canonicalPath: string | undefined;
            status: string;
            disambiguation?: string[];
            languages?: string[];
            authoritySchemes?: string[];
            authorityIds?: string[];
            replacedBy?: string[];
            broaderTerms?: string[];
            narrowerTerms?: string[];
            relatedTerms?: string[];
            primaryMocs?: string[];
            aliases?: string[];
            paths: string[];
            stableIds?: string[];
            collision?: string;
        }[];
        totalTerms: number;
        truncated: boolean;
    }>;
    /**
     * Return a bounded vocabulary and tag health projection.  This borrows the
     * useful part of library authority control without turning local tags into
     * a mandatory taxonomy: variants and unresolved subject terms are review
     * candidates, never automatic renames or redirects.
     */
    vocabularyHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        noteCount: number;
        tagCount: number;
        authorityTermCount: number;
        subjectTermCount: number;
        issueCounts: {
            tagVariants: number;
            unresolvedSubjectTerms: number;
            termCollisions: number;
            fragmentedFacets: number;
            lowSelectivityValues: number;
        };
        tagVariants: {
            key: string;
            variants: string[];
            count: number;
            noteCount: number;
            paths: string[];
            reason: string;
        }[];
        unresolvedSubjectTerms: {
            term: string;
            count: number;
            noteCount: number;
            paths: string[];
            reason: string;
            advisory: boolean;
        }[];
        termCollisions: {
            term: string;
            noteCount: number;
            paths: string[];
            reason: string;
        }[];
        facetHealth: {
            thresholds: {
                minimumVisibleNotes: number;
                fragmentationMinimumValues: number;
                fragmentationSingletonRatio: number;
                lowSelectivityCoverageRatio: number;
            };
            fragmentedTotal: number;
            lowSelectivityTotal: number;
            fragmentedFacets: {
                facet: string;
                distinctValues: number;
                singletonValues: number;
                singletonRatio: number;
                examples: string[];
                reason: string;
                guidance: string;
            }[];
            lowSelectivityValues: {
                facet: string;
                value: string;
                noteCount: number;
                coverageRatio: number;
                reason: string;
                guidance: string;
            }[];
            advisory: boolean;
        };
        facets: {
            [k: string]: {
                [k: string]: number;
            };
        };
        recommendations: string[];
        truncated: boolean;
        generatedAt: string;
    }>;
    /**
     * Resolve one human/agent-facing term without changing the vault.  This is
     * deliberately separate from authorityMap: callers usually need one
     * canonical destination, not a whole vocabulary dump.
     */
    resolveAuthorityTerm(principal: ScopePrincipal | undefined, query: string, limit?: number, maxChars?: number): Promise<{
        query: string;
        normalizedQuery: string;
        resolved: {
            canonicalTerm: unknown;
            path: unknown;
            replacementPath?: string;
        } | undefined;
        matches: {
            [x: string]: unknown;
        }[];
        ambiguous: boolean;
        totalMatches: number;
        truncated: boolean;
        note: string;
    }>;
    /**
     * Compare two visible notes before a deliberate consolidation.  The result
     * is a bounded plan; the caller must choose the canonical note and perform
     * ordinary revision-checked writes so Git remains the history.
     */
    previewMerge(params: {
        principal?: ScopePrincipal;
        sourcePath: string;
        targetPath: string;
        maxChars?: number;
    }): Promise<{
        truncated: boolean;
    }>;
    preflightPublish(params: {
        principal?: ScopePrincipal;
        path: string;
        title?: string;
        content: string;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        path: string;
        candidates: Record<string, unknown>[];
        recommendation: string;
        truncated: boolean;
    }>;
    publishDecisionRecord(params: {
        principal?: ScopePrincipal;
        path: string;
        title: string;
        context: string;
        decision: string;
        alternatives?: unknown;
        consequences?: unknown;
        status?: string;
        supersedes?: unknown;
        replacedBy?: string;
        evidencePaths: string[];
        references?: unknown;
        author: string;
        reviewAt?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        created: boolean;
        path: string;
        evidencePaths: string[];
        evidence: {
            heading?: string;
            blockId?: string;
            revision?: string;
            startLine?: number;
            endLine?: number;
            quoteHash?: string;
            path: string;
        }[];
        claims?: Record<string, unknown>[];
        revision: string;
        decisionStatus: "accepted" | "proposed" | "rejected" | "superseded";
    }>;
    /**
     * Return a bounded, live Decision Record register derived from Markdown.
     * decision_status is authoritative for new records. Older records are only
     * inferred for display and are never silently rewritten.
     */
    decisionRegister(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        counts: {
            total: number;
            issues: number;
        };
        nextAction: {
            endpointId: string;
        };
        automaticChanges: boolean;
        truncated: boolean;
    } | {
        counts: {
            total: number;
            issues: number;
        };
        truncated: boolean;
    }>;
    sourceTrust(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
    }>;
    /**
     * Project the source/knowledge citation network from ordinary frontmatter.
     * It is intentionally metadata-first and bounded: source Markdown and Git
     * remain authoritative, while this view helps agents find unsupported or
     * over-concentrated knowledge without creating a citation database.
     */
    citationGraph(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<Record<string, unknown>>;
    /**
     * Group immutable source snapshots into portable works and editions. The
     * existing source_family/source_version fields remain compatible; the
     * explicit source_work_id/source_edition_id fields make the model clear
     * when a publisher changes its label or a work has several editions.
     */
    sourceLineage(principal?: ScopePrincipal, sourceFamily?: string, limit?: number, maxChars?: number): Promise<{
        mode: string;
        sourceFamily: string | undefined;
        works: {
            workId: string;
            label: string;
            editionCount: number;
            editions: Record<string, unknown>[];
            nextAction: string;
        }[];
        totals: {
            sourceSnapshots: number;
            works: number;
        };
        truncated: boolean;
        note: string;
    }>;
    /**
     * Project archival provenance and original order without inventing another
     * source database. An overview lists collections; a collection/series drill
     * down returns revision-stamped source rows in authored archival order.
     * Source bodies are never hydrated by this endpoint.
     */
    archiveFindingAid(principal?: ScopePrincipal, collectionId?: string, series?: unknown, limit?: number, maxChars?: number): Promise<Record<string, any>>;
    /**
     * Find explicit organization clusters that have enough independently
     * addressable notes to merit a synthesis pass. This is deliberately not a
     * semantic clustering endpoint: MOC/project/domain/subject metadata is the
     * authored boundary, and the returned plan preserves every input note.
     */
    synthesisCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number, options?: SynthesisCandidatesOptions): Promise<{
        purpose: string;
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        groupingRule: string;
        attentionRouting?: {
            mode: string;
            candidateBand: number;
            exclusive: boolean;
        };
        generatedAt: string;
    }>;
    promotionCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number, prettyPrint?: boolean): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
    } | {
        identityState: {};
        suggestedPath: unknown;
        total: number;
        revision?: unknown;
        nextAction?: unknown;
        truncated: boolean;
    } | {
        identityState?: never;
        suggestedPath?: never;
        total: number;
        revision?: unknown;
        nextAction?: unknown;
        truncated: boolean;
    } | {
        total: number;
        truncated: boolean;
        detailsOmitted: boolean;
        message: string;
        nextAction: {
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                maxChars: number;
                limit: number;
                prettyPrint: boolean;
            };
        };
    }>;
    private currentMaintenanceCandidates;
    private maintenanceReplacement;
    summaryCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, any>[];
        total: number;
        truncated: boolean;
    } | {
        items: Record<string, any>[];
        total: number;
        truncated: boolean;
        metadataTruncated: boolean;
        retry?: never;
        instruction?: never;
    } | {
        items: {
            path: any;
            revision: any;
            nextAction: any;
            candidateTruncated: boolean;
        }[];
        total: number;
        truncated: boolean;
    } | {
        metadataTruncated?: never;
        items: never[];
        total: number;
        truncated: boolean;
        retry: {
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                limit: number;
                maxChars: number;
            };
        };
        instruction: string;
    }>;
    unusedKnowledge(principal?: ScopePrincipal, olderThanDays?: number, limit?: number, maxChars?: number): Promise<{
        items: Record<string, any>[];
        total: number;
        truncated: boolean;
        metadataTruncated: boolean;
        retry?: never;
        instruction?: never;
    } | {
        items: {
            path: any;
            revision: any;
            nextAction: any;
            candidateTruncated: boolean;
        }[];
        total: number;
        truncated: boolean;
    } | {
        metadataTruncated?: never;
        items: never[];
        total: number;
        truncated: boolean;
        retry: {
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                limit: number;
                maxChars: number;
            };
        };
        instruction: string;
    } | ({
        olderThanDays: number;
    } & {
        items: Record<string, any>[];
        total: number;
        truncated: boolean;
    })>;
    /** Advisory preservation queue; hold metadata never authorizes disposition. */
    retentionQueue(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, any>[];
        total: number;
        truncated: boolean;
        metadataTruncated: boolean;
        retry?: never;
        instruction?: never;
    } | {
        items: {
            path: any;
            revision: any;
            nextAction: any;
            candidateTruncated: boolean;
        }[];
        total: number;
        truncated: boolean;
    } | {
        metadataTruncated?: never;
        items: never[];
        total: number;
        truncated: boolean;
        retry: {
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                limit: number;
                maxChars: number;
            };
        };
        instruction: string;
    } | ({
        purpose: string;
        generatedAt: string;
    } & {
        items: Record<string, any>[];
        total: number;
        truncated: boolean;
    })>;
    /** Stateless daily rediscovery with bounded current-body context, not a recommendation database. */
    resurfaceKnowledge(principal?: ScopePrincipal, limit?: number, maxChars?: number, context?: string): Promise<{
        items: Record<string, any>[];
        total: number;
        truncated: boolean;
        metadataTruncated: boolean;
        retry?: never;
        instruction?: never;
    } | {
        items: {
            path: any;
            revision: any;
            nextAction: any;
            candidateTruncated: boolean;
        }[];
        total: number;
        truncated: boolean;
    } | {
        metadataTruncated?: never;
        items: never[];
        total: number;
        truncated: boolean;
        retry: {
            endpointId: string;
            reuseOriginalArguments: boolean;
            overrides: {
                limit: number;
                maxChars: number;
            };
        };
        instruction: string;
    } | ({
        purpose: string;
        rotationDate: string;
        context?: string;
    } & {
        items: Record<string, any>[];
        total: number;
        truncated: boolean;
    })>;
    orient(principal?: ScopePrincipal, maxChars?: number): Promise<{
        protocol: string;
        purpose: string;
        mission: string;
        access: {
            mode: string;
            commandCenterId: string;
            principal: {
                accountId: string;
                userId?: string;
                familyId?: string;
                modelId: string;
                agentId?: string;
                commandCenterId: string;
                role: "agent" | "model";
            } | null;
            note: string;
        };
        visibleScopes: {
            kind: "agent" | "community" | "global" | "model";
            uri: string;
        }[];
        primaryAction: {
            endpointId: string;
            via: 'direct_mcp';
            arguments: {
                path?: never;
                limit: number;
                maxChars: number;
                topic?: never;
            };
            reason: string;
        } | {
            endpointId: string;
            via: 'call_endpoint';
            arguments: {
                limit?: never;
                path: string;
                maxChars: number;
                topic?: never;
            };
            reason: string;
        } | {
            endpointId: string;
            via: 'call_endpoint';
            arguments: {
                path?: never;
                limit?: never;
                topic: string;
                maxChars: number;
            };
            reason: string;
        };
        actionBudget: {
            endpointCalls: number;
            stopAfterAction: boolean;
            instruction: string;
        };
        routing: string;
        participation: {
            why: string;
            invitation: string;
        };
        publicOnboarding: {
            welcomePath: string;
            welcomePresent: boolean;
            schemaPath: string | null;
            readableWithoutLogin: boolean;
            commandCenterId: string;
            note: string;
        };
        authentication: {
            status: string;
            identity: string;
            userId?: string;
            familyId?: string;
            commandCenterId: string;
            note: string;
        } | {
            status: string;
            note: string;
        };
        invariants: string[];
        nextActions: {
            tool: string;
            arguments: {
                path?: never;
                limit: number;
                maxChars: number;
                topic?: never;
            } | {
                limit?: never;
                path: string;
                maxChars: number;
                topic?: never;
            } | {
                path?: never;
                limit?: never;
                topic: string;
                maxChars: number;
            };
            reason: string;
        }[];
    } | {
        protocol: string;
        access: {
            mode: string;
            commandCenterId: string;
            principal: {
                accountId: string;
                userId?: string;
                familyId?: string;
                modelId: string;
                agentId?: string;
                commandCenterId: string;
                role: "agent" | "model";
            } | null;
            note: string;
        };
        primaryAction: {
            endpointId: string;
            via: 'direct_mcp';
            arguments: {
                path?: never;
                limit: number;
                maxChars: number;
                topic?: never;
            };
            reason: string;
        } | {
            endpointId: string;
            via: 'call_endpoint';
            arguments: {
                limit?: never;
                path: string;
                maxChars: number;
                topic?: never;
            };
            reason: string;
        } | {
            endpointId: string;
            via: 'call_endpoint';
            arguments: {
                path?: never;
                limit?: never;
                topic: string;
                maxChars: number;
            };
            reason: string;
        };
        actionBudget: {
            endpointCalls: number;
            stopAfterAction: boolean;
            instruction: string;
        };
        routing: string;
        authentication: {
            status: string;
            identity: string;
            userId?: string;
            familyId?: string;
            commandCenterId: string;
            note: string;
        } | {
            status: string;
            note: string;
        };
        nextActions: {
            tool: string;
            arguments: {
                path?: never;
                limit: number;
                maxChars: number;
                topic?: never;
            } | {
                limit?: never;
                path: string;
                maxChars: number;
                topic?: never;
            } | {
                path?: never;
                limit?: never;
                topic: string;
                maxChars: number;
            };
            reason: string;
        }[];
        truncated: boolean;
    } | {
        protocol: string;
        commandCenterId: string;
        nextActions: {
            tool: string;
            arguments: {
                path?: never;
                limit: number;
                maxChars: number;
                topic?: never;
            } | {
                limit?: never;
                path: string;
                maxChars: number;
                topic?: never;
            } | {
                path?: never;
                limit?: never;
                topic: string;
                maxChars: number;
            };
        }[];
        guidance: string;
        truncated: boolean;
    }>;
    validateCommitPaths(paths: string[], principal?: ScopePrincipal): Promise<{
        checked: boolean;
        relevantPaths: string[];
        errors: number;
        warnings: number;
    }>;
    lint(principal?: ScopePrincipal, limit?: number): Promise<WikiLintResult>;
    lintReport(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<import("./lint-report.js").LintReport>;
    private lintSnapshotMatches;
    private computeLint;
    proposeTermChange(params: {
        principal?: ScopePrincipal;
        scopeRoot: string;
        currentTerm: string;
        proposedTerm: string;
        rationale: string;
        affectedPath?: string;
        reportedBy: string;
    }): Promise<{
        success: boolean;
        issueId: string;
        path: string;
        revision: string;
    }>;
    /**
     * Show the bounded, visible impact of an authority-term change before an
     * agent proposes or applies it.  This is deliberately preview-only: the
     * Markdown files, wikilinks, aliases, and Git history are not changed.
     */
    termChangePreview(params: {
        principal?: ScopePrincipal;
        currentTerm: string;
        proposedTerm: string;
        limit?: number;
        maxChars?: number;
    }): Promise<Record<string, unknown>>;
    reportIssue(params: {
        scopeRoot: string;
        issueId?: string;
        kind: string;
        title: string;
        description: string;
        subjectPath?: string;
        evidencePaths?: string[];
        reportedBy: string;
        extraFrontmatter?: Record<string, unknown>;
    }): Promise<{
        success: boolean;
        issueId: string;
        path: string;
        revision: string;
    }>;
    resolveIssue(params: {
        path: string;
        actor: string;
        resolution: string;
        resolutionStatus?: string;
        retrospectiveStatus?: string;
        retrospective?: string;
        followUpPaths?: string[];
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        path: string;
        status: string;
        retrospectiveStatus: string;
        followUpPaths?: string[];
        revision: string;
    }>;
}
//# sourceMappingURL=llm-wiki.d.ts.map