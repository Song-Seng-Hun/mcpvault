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
type WikiProjectionView = 'summary' | 'key_points' | 'outline' | 'section' | 'full';
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
        nextActions?: unknown;
        nextAction?: string;
        waitingFor?: string;
        desiredOutcome?: string;
        taskContext?: string;
        dueAt?: string;
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
        nextActions?: unknown;
        desiredOutcome?: string;
        taskContext?: string;
        dueAt?: string;
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
    }): Promise<any>;
    impactReport(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        generatedAt: string;
    }>;
    exportBasesView(principal?: ScopePrincipal, noteKind?: string, lifecycle?: string, limit?: number, maxChars?: number): Promise<{
        format: string;
        suggestedPath: string;
        content: string;
        truncated: boolean;
        matchingNotes: any;
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
    } | {
        truncated: boolean;
        note: string;
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