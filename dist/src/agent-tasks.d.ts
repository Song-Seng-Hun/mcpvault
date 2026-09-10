import { ScopeAccessPolicy } from './scope-access.js';
import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import type { NoteWriteParams } from './types.js';
import { type WorkResponsibility } from './work-responsibility.js';
export interface WorkArtifact {
    path?: string;
    revision?: string;
    repository?: string;
    branch?: string;
    commit?: string;
    files?: string[];
}
export interface AgentTaskWorkFields {
    changeContext?: import('./work-review.js').WorkChangeContext;
    migrateReviewContract?: boolean;
    responsibility?: WorkResponsibility;
    projectId?: string;
    parentTaskId?: string;
    dependsOn?: string[];
    completionCriteria?: string[];
    artifacts?: WorkArtifact[];
    workKind?: 'general' | 'security' | 'permissions' | 'shared_policy' | 'destructive';
    discussionSlug?: string;
    verification?: string;
    expectedGeneration?: number;
    requestId?: string;
}
export interface AgentTaskWriteContext {
    frontmatter: Record<string, any>;
    removeFields?: string[];
    authorize: boolean;
    write(params: NoteWriteParams, guards?: Array<{
        path: string;
        expectedRevision: string;
    }>): Promise<{
        revision: string;
    }>;
}
export interface AgentTaskExtension {
    run(action: 'create' | 'update', params: any, proceed: (context?: AgentTaskWriteContext, parameters?: any) => Promise<any>): Promise<any>;
}
export declare const AGENT_TASK_STATUSES: readonly ['proposed', 'accepted', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled'];
export type AgentTaskStatus = typeof AGENT_TASK_STATUSES[number];
export declare function taskStatus(value: unknown, fallback?: AgentTaskStatus): AgentTaskStatus;
export declare class AgentTaskService {
    private readonly fileSystem;
    private readonly references;
    private readonly auth;
    private readonly access;
    private workExtension?;
    attachWorkExtension(extension: AgentTaskExtension): void;
    constructor(fileSystem: FileSystemService, references: ReferenceService, auth: ScopeAuthService, access?: ScopeAccessPolicy);
    private validatedKnowledgeNotes;
    private assignee;
    private assigneeAccount;
    create(params: AgentTaskWorkFields & {
        principal?: ScopePrincipal;
        taskId?: string;
        title: string;
        description: string;
        assignee?: string;
        references?: unknown;
        expectedRevision?: string;
    }): Promise<any>;
    private createCore;
    read(params: {
        taskId: string;
        includeContent?: boolean;
        referenceLimit?: number;
        referenceMaxChars?: number;
    }): Promise<{
        path: string;
        fm: {
            [x: string]: any;
        };
        revision: string;
        workContext?: {
            projectId: string;
            expectedGeneration?: any;
            mutationRequires: string[];
        };
        nextAction?: {
            tool: string;
            arguments: {
                taskId: string;
            };
        };
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
            status: "accepted" | "blocked" | "cancelled" | "completed" | "in_progress" | "in_review" | "proposed";
            updatedAt: any;
            revision: undefined;
        }[];
        total: number;
        truncated: boolean;
    }>;
    listAssignedOpen(params: {
        assignee: string;
        limit?: number;
        maxChars?: number;
        excludeProjectBacked?: boolean;
    }): Promise<{
        tasks: {
            taskId: string;
            status: "accepted" | "blocked" | "in_progress" | "in_review" | "proposed";
        }[];
        statusCounts: {
            accepted: number;
            blocked: number;
            in_progress: number;
            proposed: number;
        };
        total: number;
        truncated: boolean;
    }>;
    update(params: AgentTaskWorkFields & {
        knowledgeApplications?: unknown;
        principal?: ScopePrincipal;
        taskId: string;
        status?: string;
        assignee?: string;
        description?: string;
        references?: unknown;
        reason?: string;
        retrospective?: string;
        knowledgeNotes?: unknown;
        negativeKnowledgeNotes?: unknown;
        noReusableKnowledge?: boolean;
        knowledgeDispositionReason?: string;
        expectedRevision: string;
    }): Promise<any>;
    private updateCore;
}
//# sourceMappingURL=agent-tasks.d.ts.map