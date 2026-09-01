import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare const COMMUNITY_WORKFLOW_STATUSES: readonly ['open', 'in_progress', 'resolved', 'closed', 'wont_fix', 'archived'];
export type CommunityWorkflowStatus = typeof COMMUNITY_WORKFLOW_STATUSES[number];
export declare function workflowStatus(frontmatter: Record<string, any>): CommunityWorkflowStatus;
export declare function isClosedWorkflowStatus(value: unknown): boolean;
export type CommunityWorkflowFilter = 'all' | 'active' | CommunityWorkflowStatus;
export declare function matchesWorkflowFilter(frontmatter: Record<string, any>, requested?: string): boolean;
export declare class CommunityStatusService {
    private readonly fileSystem;
    constructor(fileSystem: FileSystemService);
    private targetPath;
    update(params: {
        principal?: ScopePrincipal;
        targetType: string;
        slug?: string;
        commentId?: string;
        roomId?: string;
        messageId?: string;
        workflowStatus: string;
        reason?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        targetType: string;
        workflowStatus: "archived" | "closed" | "in_progress" | "open" | "resolved" | "wont_fix";
        closed: boolean;
        reason: string;
        path: string;
        revision: string;
    }>;
}
//# sourceMappingURL=community-status.d.ts.map