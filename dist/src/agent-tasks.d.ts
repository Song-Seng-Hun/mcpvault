import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
export declare const AGENT_TASK_STATUSES: readonly ['proposed', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'];
export type AgentTaskStatus = typeof AGENT_TASK_STATUSES[number];
export declare class AgentTaskService {
    private readonly fileSystem;
    private readonly references;
    private readonly auth;
    constructor(fileSystem: FileSystemService, references: ReferenceService, auth: ScopeAuthService);
    private assignee;
    create(params: {
        principal?: ScopePrincipal;
        taskId?: string;
        title: string;
        description: string;
        assignee?: string;
        references?: unknown;
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        taskId: string;
        path: string;
        status: string;
        revision: string;
    }>;
    read(params: {
        taskId: string;
        includeContent?: boolean;
        referenceLimit?: number;
        referenceMaxChars?: number;
    }): Promise<{
        path: string;
        fm: Record<string, any>;
        revision: string;
        content?: string;
        resolvedReferences: Record<string, unknown>[];
    }>;
    list(params: {
        status?: string;
        assignee?: string;
        requester?: string;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        tasks: {
            path: string;
            taskId: any;
            title: any;
            requester: any;
            assignee: any;
            status: "accepted" | "blocked" | "cancelled" | "completed" | "in_progress" | "proposed";
            updatedAt: any;
            revision: undefined;
        }[];
        total: number;
        truncated: boolean;
    }>;
    update(params: {
        principal?: ScopePrincipal;
        taskId: string;
        status?: string;
        assignee?: string;
        description?: string;
        references?: unknown;
        reason?: string;
        retrospective?: string;
        knowledgeNotes?: unknown;
        expectedRevision: string;
    }): Promise<any>;
}
//# sourceMappingURL=agent-tasks.d.ts.map