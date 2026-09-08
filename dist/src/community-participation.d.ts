import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { NotificationService } from './notifications.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { type CommunityActivityTemplateId } from './community-participation-activities.js';
export type ParticipationAction = 'respond' | 'explore' | 'initiate';
export interface ParticipationTarget {
    path: string;
    revision: string;
    activityRevision?: string;
}
export interface ParticipationGoal {
    id: string;
    question: string;
    nextCondition: string;
    links?: string[];
}
export interface ParticipationSettings {
    enabled: boolean;
    paused: boolean;
    pauseUntil?: string;
    allowedTopics: string[];
    allowedActions: ParticipationAction[];
    dailyLimit: number;
    dailyInitiationLimit: number;
}
export interface ParticipationRun {
    id: string;
    publicRequestId: string;
    action: ParticipationAction;
    topic: string;
    startedAt: string;
    target?: ParticipationTarget;
    publicAttempt?: {
        operation: string;
        payloadHash: string;
        path: string;
    };
}
interface Base {
    principal?: ScopePrincipal | undefined;
    expectedRevision?: string | undefined;
    requestId?: string | undefined;
    maxChars?: number | undefined;
    authorize?: (() => void) | undefined;
}
export interface ParticipationSettingsParams extends Base {
    op?: 'read' | 'update' | undefined;
    templateId?: CommunityActivityTemplateId;
    settings?: Partial<ParticipationSettings> | undefined;
    goals?: ParticipationGoal[] | undefined;
    deferred?: Array<{
        path: string;
        until: string;
    }>;
}
export interface ParticipationRecordParams extends Base {
    op: 'start' | 'finish' | 'skip';
    runId?: string;
    action?: ParticipationAction;
    topic?: string;
    target?: ParticipationTarget;
    result?: ParticipationTarget;
    hostBusy?: boolean;
    noMutation?: boolean;
    reconcileAbsent?: boolean;
    deferUntil?: string;
    reason?: string;
}
export interface ParticipationCandidate extends ParticipationTarget {
    lane: 'follow_up' | 'interest' | 'discovery';
    title: string;
    reason: string;
    changedAt: string;
    changes: Array<{
        path: string;
        revision: string;
        kind: string;
        contributor: string;
    }>;
    nextAction: {
        endpointId: string;
        arguments: Record<string, unknown>;
    };
}
export declare function participationPath(principal: ScopePrincipal): string;
/** All authority remains in one revision-safe, account-private Markdown file.
 * Reads are pure; the host, not the server, runs models and enforces wall time.
 */
export declare class CommunityParticipationService {
    private readonly fileSystem;
    private readonly options;
    private readonly access;
    private readonly now;
    constructor(fileSystem: FileSystemService, options?: {
        access?: ScopeAccessPolicy;
        now?: () => number;
        notifications?: NotificationService;
    });
    private actor;
    private fresh;
    private load;
    private day;
    private view;
    private validateSettings;
    private publicPath;
    private target;
    private publicNote;
    private change;
    settings(params: ParticipationSettingsParams): Promise<{
        path: string;
        revision: string;
        settings: ParticipationSettings;
        goals: ParticipationGoal[];
        activeRun: ParticipationRun | undefined;
        daily: {
            day: string;
            runs: number;
            initiations: number;
        };
        deferred: {
            path: string;
            deferUntil: string | undefined;
        }[];
        recent: {
            runId: string;
            action: ParticipationAction;
            outcome: string;
            at: string;
            result?: ParticipationTarget;
        }[];
        activityTemplate?: import("./community-participation-activities.js").CommunityActivityTemplate;
        truncated: boolean;
    }>;
    private gate;
    record(params: ParticipationRecordParams): Promise<{
        path: string;
        revision: string;
        settings: ParticipationSettings;
        goals: ParticipationGoal[];
        activeRun: ParticipationRun | undefined;
        daily: {
            day: string;
            runs: number;
            initiations: number;
        };
        deferred: {
            path: string;
            deferUntil: string | undefined;
        }[];
        recent: {
            runId: string;
            action: ParticipationAction;
            outcome: string;
            at: string;
            result?: ParticipationTarget;
        }[];
        activityTemplate?: import("./community-participation-activities.js").CommunityActivityTemplate;
        truncated: boolean;
    }>;
    pulse(params: {
        principal?: ScopePrincipal;
        limit?: number;
        maxChars?: number;
        hostBusy?: boolean;
    }): Promise<Record<string, unknown>>;
}
export {};
//# sourceMappingURL=community-participation.d.ts.map