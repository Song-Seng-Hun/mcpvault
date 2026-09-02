import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
export declare const SOURCE_TRUST_LEVELS: readonly ['unrated', 'low', 'medium', 'high', 'verified'];
export interface WikiCatalogOptions {
    summaryOnly?: boolean;
    noteKind?: string;
    lifecycle?: string;
    limit?: number;
    maxChars?: number;
}
export interface WikiClaimInput {
    id?: string;
    text: string;
    evidencePaths?: string[];
    evidence?: WikiEvidenceInput[];
    confidence?: string;
    status?: string;
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
type WikiProjectionView = 'summary' | 'progressive' | 'key_points' | 'outline' | 'section' | 'full';
interface WikiLintIssue {
    severity: 'error' | 'warning';
    code: string;
    path: string;
    detail: string;
}
interface WikiLintResult {
    healthy: boolean;
    errors: number;
    warnings: number;
    issues: WikiLintIssue[];
    truncated: boolean;
}
export declare class LlmWikiService {
    private readonly fileSystem;
    private readonly access;
    private readonly references;
    private generation;
    private readonly catalogSummaryCache;
    private readonly catalogSummaryInFlight;
    private readonly lintCache;
    private readonly lintInFlight;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService);
    invalidate(): void;
    private principalKey;
    /**
     * Capture the revisions of notes linked by the current body/metadata. This
     * is a derived review baseline: Markdown and Git remain authoritative.
     */
    private collectReviewBasisLinks;
    private reviewChangeSignals;
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
        noteKind: "area" | "assumption" | "atomic" | "decision" | "fleeting" | "hypothesis" | "journal" | "knowledge" | "literature" | "moc" | "project" | "question" | "resource" | "task";
        distilledFrom: {
            path: string;
            revision: string;
        };
        nextAction: string;
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
        moc?: string;
        project?: string;
        reviewAt?: string;
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
        stableId?: string;
        relations?: unknown;
        taskStatus?: unknown;
        reviewPolicy?: unknown;
        reviewOutcome?: unknown;
        reviewedBy?: string;
        reviewedAt?: string;
        reviewNote?: string;
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
    reviewQueue(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
    }>;
    inbox(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
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
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        path: string;
        title: string;
        noteKind: string;
        lifecycle: string;
        revision: string;
        nextAction: string;
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
        taskStatus?: unknown;
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
        recommendedPath: unknown;
        recommendedLifecycle: unknown;
        nextAction: string;
        success: boolean;
        path: string;
        revision: string;
        frontmatter: any;
    }>;
    review(params: {
        principal?: ScopePrincipal;
        path: string;
        reviewOutcome: unknown;
        reviewedBy: string;
        reviewAt?: string;
        reviewNote?: string;
        nextLifecycle?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        path: string;
        revision: string;
        reviewOutcome: "confirmed" | "disputed" | "rescheduled" | "revised" | "superseded";
        reviewedBy: any;
        reviewedAt: any;
        reviewAt?: string;
        nextLifecycle?: "active" | "archived" | "evergreen" | "inbox" | "review" | "superseded";
        followUpRequired?: true;
        followUp?: string;
    }>;
    reviewDashboard(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        sections: {
            inbox: {
                items: Record<string, unknown>[];
                total: number;
                truncated: boolean;
            };
            projectsAndTasks: {
                items: Record<string, unknown>[];
                total: number;
                truncated: boolean;
            };
            projectReadiness: {
                items: Record<string, unknown>[];
                total: number;
                truncated: boolean;
            };
            due: {
                items: Record<string, unknown>[];
                total: number;
                truncated: boolean;
            };
            scheduled: {
                items: Record<string, unknown>[];
                total: number;
                truncated: boolean;
            };
            waiting: {
                items: Record<string, unknown>[];
                total: number;
                truncated: boolean;
            };
            someday: {
                items: Record<string, unknown>[];
                total: number;
                truncated: boolean;
            };
            epistemic: {
                questions: {
                    items: Record<string, unknown>[];
                    total: number;
                    truncated: boolean;
                };
                hypotheses: {
                    items: Record<string, unknown>[];
                    total: number;
                    truncated: boolean;
                };
                assumptions: {
                    items: Record<string, unknown>[];
                    total: number;
                    truncated: boolean;
                };
            };
            knowledge: {
                items: Record<string, unknown>[];
                total: number;
                truncated: boolean;
            };
            graph: {
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
                evergreenQuality: {
                    total: number;
                    needsAttention: number;
                    ready: number;
                    items: Record<string, unknown>[];
                    truncated: boolean;
                };
                unresolvedLinks: {
                    total: number;
                    items: {
                        target: string;
                        line: number;
                        link: string;
                        context: string;
                        relation?: string;
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
                focusHealth: {
                    focusedNotes: number;
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
                truncated?: never;
                note?: never;
            } | {
                truncated: boolean;
                note: string;
            };
        };
        nextActions: string[];
        generatedAt: string;
    } | {
        purpose: string;
        nextActions: string[];
        generatedAt: string;
        sections: {
            inbox: {
                total: number;
                truncated: boolean;
                items: Record<string, unknown>[];
            };
            projectsAndTasks: {
                total: number;
                truncated: boolean;
                items: Record<string, unknown>[];
            };
            projectReadiness: {
                total: number;
                truncated: boolean;
                items: Record<string, unknown>[];
            };
            due: {
                total: number;
                truncated: boolean;
                items: Record<string, unknown>[];
            };
            scheduled: {
                total: number;
                truncated: boolean;
                items: Record<string, unknown>[];
            };
            waiting: {
                total: number;
                truncated: boolean;
                items: Record<string, unknown>[];
            };
            someday: {
                total: number;
                truncated: boolean;
                items: Record<string, unknown>[];
            };
            epistemic: {
                questions: {
                    total: number;
                    truncated: boolean;
                    items: Record<string, unknown>[];
                };
                hypotheses: {
                    total: number;
                    truncated: boolean;
                    items: Record<string, unknown>[];
                };
                assumptions: {
                    total: number;
                    truncated: boolean;
                    items: Record<string, unknown>[];
                };
            };
            knowledge: {
                total: number;
                truncated: boolean;
                items: Record<string, unknown>[];
            };
            graph: {
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
                evergreenQuality: {
                    total: number;
                    needsAttention: number;
                    ready: number;
                    items: Record<string, unknown>[];
                    truncated: boolean;
                };
                unresolvedLinks: {
                    total: number;
                    items: {
                        target: string;
                        line: number;
                        link: string;
                        context: string;
                        relation?: string;
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
                focusHealth: {
                    focusedNotes: number;
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
                truncated?: never;
                note?: never;
            } | {
                truncated: boolean;
                note: string;
            };
        };
        truncated: boolean;
    }>;
    /**
     * A small action-oriented packet for agents that need to decide what to do
     * next. It is a projection over the existing Reflect/graph reports, not a
     * new task or history store.
     */
    reviewPacket(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        priorities: Record<string, unknown>[];
        counts: {
            inbox: number;
            knowledgeReview: number;
            due: number;
            projectNeedsAction: number;
            unlinkedMocQuestions: number;
            evergreenNeedsAttention: number;
        };
        supportingViews: {
            inbox: any;
            knowledge: any;
            mocQuestions: any;
            evergreenQuality: any;
            graph: {
                unresolvedLinks: any;
                orphanNotes: any;
            };
        };
        nextActions: string[];
        sourceTruncated: boolean;
        generatedAt: string;
    } | {
        purpose: string;
        counts: {
            inbox: number;
            knowledgeReview: number;
            due: number;
            projectNeedsAction: number;
            unlinkedMocQuestions: number;
            evergreenNeedsAttention: number;
        };
        nextActions: string[];
        sourceTruncated: boolean;
        generatedAt: string;
        priorities: Record<string, unknown>[];
        supportingViews: {
            inbox: {
                total: any;
                items: any;
                truncated: boolean;
            } | undefined;
            knowledge: {
                total: any;
                items: any;
                truncated: boolean;
            } | undefined;
            mocQuestions: {
                total: any;
                linked: any;
                ratio: any;
                unlinked: any;
            } | undefined;
            evergreenQuality: {
                total: any;
                needsAttention: any;
                ready: any;
                items: any;
                truncated: boolean;
            } | undefined;
            graph: {
                unresolvedLinks: {
                    total: any;
                    items: any;
                    truncated: boolean;
                } | undefined;
                orphanNotes: {
                    total: any;
                    items: any;
                    truncated: boolean;
                } | undefined;
            };
        };
        truncated: boolean;
    }>;
    /**
     * Project-support projection for GTD-style planning. It keeps the
     * day-to-day next action separate from purpose, outcome, brainstorming, and
     * reference material, and never mutates the project note.
     */
    projectPacket(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        purpose: string;
        items: {
            [x: string]: unknown;
        }[];
        total: number;
        needsPlanning: number;
        truncated: boolean;
        generatedAt: string;
    }>;
    triage(params: {
        principal?: ScopePrincipal;
        path: string;
        noteKind?: string;
        lifecycle?: string;
        moc?: string;
        project?: string;
        reviewAt?: string;
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
        stableId?: string;
        relations?: unknown;
        taskStatus?: unknown;
        reviewPolicy?: unknown;
        reviewOutcome?: unknown;
        reviewedBy?: string;
        reviewedAt?: string;
        reviewNote?: string;
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
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        path: string;
        revision: string;
        frontmatter: any;
    }>;
    readProjection(params: {
        principal?: ScopePrincipal;
        path: string;
        view?: WikiProjectionView;
        section?: string;
        maxChars?: number;
    }): Promise<{
        path: string;
        title: string;
        view: WikiProjectionView;
        revision: string;
        noteKind: any;
        lifecycle: any;
        status: any;
        confidence: any;
        aliases?: any[];
        summary?: string;
        keyPoints?: any[];
        openQuestions?: any[];
        summaryLayer?: any;
        summaryHighlights?: any[];
        nextActions?: any[];
        nextAction?: string;
        waitingFor?: string;
        desiredOutcome?: string;
        projectPurpose?: string;
        projectSupport?: any[];
        taskContext?: string;
        dueAt?: string;
        scheduledAt?: string;
        deferUntil?: string;
        stableId?: string;
        taskStatus?: string;
        reviewPolicy?: string;
        reviewOutcome?: string;
        reviewedBy?: string;
        reviewedAt?: string;
        reviewNote?: string;
        disposition?: string;
        clarifiedBy?: string;
        clarifiedAt?: string;
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
    impactReport(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        generatedAt: string;
    }>;
    exportBasesView(principal?: ScopePrincipal, noteKind?: string, lifecycle?: string, limit?: number, maxChars?: number, requestedView?: string): Promise<{
        format: string;
        suggestedPath: string;
        content: string;
        truncated: boolean;
        matchingNotes: any;
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
    /**
     * Return a derived launchpad for an authorized scope. This is the
     * scope-local equivalent of an Obsidian Home note/JDex: it points at live
     * notes but never creates a competing index or grants access.
     */
    home(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        scope: string;
        purpose: string;
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
            inbox: number;
            review: number;
            stableIds: number;
        };
        mocs: Record<string, unknown>[];
        projects: Record<string, unknown>[];
        inbox: Record<string, unknown>[];
        review: Record<string, unknown>[];
        stableIds: Record<string, unknown>[];
        truncated: boolean;
    }>;
    graphHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        unresolvedLinks: {
            total: number;
            items: {
                target: string;
                line: number;
                link: string;
                context: string;
                relation?: string;
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
        evergreenQuality: {
            total: number;
            needsAttention: number;
            ready: number;
            items: Record<string, unknown>[];
            truncated: boolean;
        };
        focusHealth: {
            focusedNotes: number;
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
    /**
     * One-pass organization quality projection. It reuses lint's authoritative
     * scan instead of running separate folder/property scans, and never mutates
     * notes or treats organization hints as security boundaries.
     */
    organizationHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        healthy: boolean;
        organizationIssueTotal: number;
        byCode: Record<string, number>;
        issues: WikiLintIssue[];
        recommendations: string[];
        mocCoverage?: Record<string, unknown>;
        mocQuestionCoverage?: Record<string, any>;
        evergreenQuality?: Record<string, any>;
        focusHealth?: Record<string, any>;
        knowledgeConnectivity?: Record<string, any>;
        advisoryIssueTotal: number;
        truncated: boolean;
        generatedAt: string;
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
    }>;
    sourceTrust(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
    }>;
    promotionCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
    }>;
    summaryCandidates(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
    }>;
    unusedKnowledge(principal?: ScopePrincipal, olderThanDays?: number, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        olderThanDays: number;
    }>;
    orient(principal?: ScopePrincipal): Promise<{
        protocol: string;
        purpose: string;
        mission: string;
        access: {
            mode: string;
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
        workflow: string[];
        firstSessionProtocol: string[];
        participation: {
            why: string;
            invitation: string;
        };
        publicOnboarding: {
            welcomePath: string;
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
            why?: never;
            beforeRegister?: never;
            steps?: never;
        } | {
            status: string;
            why: string;
            beforeRegister: string[];
            steps: string[];
            note: string;
        };
        invariants: string[];
        catalog: any;
        lint: WikiLintResult;
        nextActions: {
            tool: string;
            arguments?: Record<string, string>;
            reason: string;
        }[];
    }>;
    validateCommitPaths(paths: string[], principal?: ScopePrincipal): Promise<{
        checked: boolean;
        relevantPaths: string[];
        errors: number;
        warnings: number;
    }>;
    lint(principal?: ScopePrincipal, limit?: number): Promise<WikiLintResult>;
    private computeLint;
    reportIssue(params: {
        scopeRoot: string;
        issueId?: string;
        kind: string;
        title: string;
        description: string;
        subjectPath?: string;
        evidencePaths?: string[];
        reportedBy: string;
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
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        path: string;
        status: string;
        revision: string;
    }>;
}
export {};
//# sourceMappingURL=llm-wiki.d.ts.map