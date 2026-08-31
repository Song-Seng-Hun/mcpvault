import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare class LlmWikiService {
    private readonly fileSystem;
    private readonly access;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy);
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
        path: string;
        content: string;
        evidencePaths: string[];
        author: string;
        confidence?: string;
        status?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        created: boolean;
        path: string;
        evidencePaths: string[];
        revision: string;
    }>;
    catalog(principal?: ScopePrincipal): Promise<{
        counts: Record<string, number>;
        entries: {
            path: string;
            type: any;
            title: any;
            status: any;
            confidence: any;
            updatedAt: any;
        }[];
        total: number;
        truncated: boolean;
    }>;
    orient(principal?: ScopePrincipal): Promise<{
        protocol: string;
        purpose: string;
        access: {
            mode: string;
            principal: {
                accountId: string;
                modelId: string;
                agentId?: string;
                role: "agent" | "model";
            } | null;
            note: string;
        };
        visibleScopes: {
            kind: "agent" | "global" | "model";
            uri: string;
        }[];
        workflow: string[];
        invariants: string[];
        catalog: {
            counts: Record<string, number>;
            entries: {
                path: string;
                type: any;
                title: any;
                status: any;
                confidence: any;
                updatedAt: any;
            }[];
            total: number;
            truncated: boolean;
        };
        lint: {
            healthy: boolean;
            errors: number;
            warnings: number;
            issues: {
                severity: 'error' | 'warning';
                code: string;
                path: string;
                detail: string;
            }[];
            truncated: boolean;
        };
        nextActions: {
            tool: string;
            reason: string;
        }[];
    }>;
    validateCommitPaths(paths: string[], principal?: ScopePrincipal): Promise<{
        checked: boolean;
        relevantPaths: string[];
        errors: number;
        warnings: number;
    }>;
    lint(principal?: ScopePrincipal, limit?: number): Promise<{
        healthy: boolean;
        errors: number;
        warnings: number;
        issues: {
            severity: 'error' | 'warning';
            code: string;
            path: string;
            detail: string;
        }[];
        truncated: boolean;
    }>;
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
//# sourceMappingURL=llm-wiki.d.ts.map