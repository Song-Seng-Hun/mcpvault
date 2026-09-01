import type { ScopePrincipal } from './scope-auth.js';
import type { NotificationService } from './notifications.js';
import type { SocialService } from './social.js';
import type { ChatService } from './chat.js';
import type { AgentTaskService } from './agent-tasks.js';
import type { ContinuityService } from './continuity.js';
/**
 * Produces one bounded, actionable community pulse without adding a second
 * index or history database. The caller still decides whether to act.
 */
export declare class AgentPulseService {
    private readonly notifications;
    private readonly social;
    private readonly chat;
    private readonly tasks;
    private readonly continuity;
    constructor(notifications: NotificationService, social: SocialService, chat: ChatService, tasks: AgentTaskService, continuity: ContinuityService);
    get(params: {
        principal?: ScopePrincipal;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        protocol: string;
        state: string;
        identity: null;
        authentication: {
            requiredFor: string[];
            registration: {
                tool: string;
                accountId: string;
                modelId: string;
                agentId: string;
                password: string;
                capabilities: string;
                result: string;
            };
            then: string[];
        };
        nextAction: {
            tool: string;
            reason: string;
        };
        signals: {
            unreadNotifications: number;
            ownPublishedPosts: number;
            activeRooms: number;
            assignedTasks: number;
            activePosts?: never;
            assignedInProgressTasks?: never;
        };
        context: never[];
        cadence?: never;
        cursors?: never;
        guardrails?: never;
    } | {
        authentication?: never;
        protocol: string;
        state: string;
        identity: {
            accountId: string;
            modelId: string;
            agentId?: string;
            role: "agent" | "model";
        };
        cadence: string;
        nextAction: {
            tool?: never;
            reason: string;
        };
        signals: {
            assignedTasks?: never;
            unreadNotifications: number;
            ownPublishedPosts: number;
            activePosts: number;
            activeRooms: number;
            assignedInProgressTasks: number;
        };
        context: ({
            kind: string;
            event: import("./notifications.js").NotificationEvent;
        } | {
            kind: string;
            state: {
                exists: boolean;
                path: string;
                fm?: never;
                content?: never;
                truncated?: never;
                revision?: never;
            } | {
                exists: boolean;
                path: string;
                fm: Record<string, any>;
                content: string;
                truncated: boolean;
                revision: string;
            };
        } | {
            path: string;
            slug: any;
            title: any;
            author: any;
            status: any;
            tags: any;
            category: any;
            seriesId: any;
            seriesTitle: any;
            seriesOrder: any;
            relatedPosts: any;
            duplicateOf: any;
            createdAt: any;
            updatedAt: any;
            workflowStatus: "archived" | "closed" | "in_progress" | "open" | "resolved" | "wont_fix";
            workflowStatusBy: any;
            workflowStatusReason: any;
            workflowStatusUpdatedAt: any;
            moderationStatus: "hidden" | "quarantined" | "removed" | "visible" | "warned";
            excerpt?: string;
            kind: string;
        })[];
        cursors: {
            notification: string | undefined;
        };
        guardrails: string[];
    }>;
}
//# sourceMappingURL=agent-pulse.d.ts.map