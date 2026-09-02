import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
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
    confidence?: string;
    status?: string;
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
        claims?: WikiClaimInput[];
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        created: boolean;
        path: string;
        evidencePaths: string[];
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
        section?: {
            startLine: number;
            endLine: number;
            requested: string | undefined;
        };
        headings?: import("./types.js").NoteHeading[];
        content: string;
        truncated: boolean;
        references: string[];
    }>;
    impactReport(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        items: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        generatedAt: string;
    }>;
    graphHealth(principal?: ScopePrincipal, limit?: number, maxChars?: number): Promise<{
        unresolvedLinks: {
            total: number;
            items: {
                target: string;
                line: number;
                link: string;
                context: string;
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
    } | {
        truncated: boolean;
        note: string;
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