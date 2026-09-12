import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ExceptionBoardItem } from './exception-board.js';
export declare const MAINTENANCE_REVIEW_RULE_VERSION = "maintenance-review-v1";
type Priority = 'integrity' | 'evidence' | 'navigation' | 'tidying';
export declare const MAINTENANCE_REVIEW_LIMITS: Readonly<{
    candidates: 240;
    owners: 20;
    reads: 256;
    bytesPerRead: number;
    graphQueries: 40;
    backlinksPerQuery: 64;
    dependenciesPerOwner: 32;
}>;
export interface MaintenanceReviewGroup {
    path: string;
    revision?: string;
    sourceState: 'snapshot_matched' | 'recheck_required';
    ruleVersion: typeof MAINTENANCE_REVIEW_RULE_VERSION;
    issueId: string;
    reviewBasis: string;
    priority: Priority;
    reviewState: 'open' | 'snoozed' | 'recheck_required';
    dependenciesComplete: boolean;
    affectedEvidence: Array<{
        path: string;
        revision: string;
    }>;
    issues: Array<{
        code: string;
        severity: 'error' | 'warning';
        explanation: string;
    }>;
    reviewGuidance: string;
    nextAction: {
        endpointId: 'notes.read' | 'wiki.canvas_health';
        arguments: {
            path?: string;
            expectedRevision?: string;
            maxChars: number;
            limit?: number;
        };
    };
}
export interface MaintenanceReviewResult {
    advisory: true;
    coverage: 'partial';
    countScope: 'validated_candidates';
    groups: MaintenanceReviewGroup[];
    truncated: boolean;
    retry?: {
        endpointId: 'wiki.exception_board';
        reuseOriginalArguments: true;
        overrides: {
            maxChars: 16000;
        };
    };
}
/** Read-only projection over already selected findings, not a new linter or a
 * Vault census. A successful write/review is never interpreted as resolution. */
export declare class MaintenanceReviewService {
    private readonly fs;
    private readonly access;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy);
    private path;
    private read;
    private dependencies;
    private canvasGroup;
    group(items: ExceptionBoardItem[], principal?: ScopePrincipal, limit?: number, maxChars?: number, sourceTruncated?: boolean): Promise<MaintenanceReviewResult>;
}
export {};
//# sourceMappingURL=maintenance-review.d.ts.map