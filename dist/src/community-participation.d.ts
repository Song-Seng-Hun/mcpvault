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
    emptyDiscussion?: true;
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
    emptyDiscussion?: boolean;
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
type RevisionGuard = {
    path: string;
    expectedRevision: string;
};
type ParticipationWrite = {
    path: string;
    expectedRevision: string;
    content: string;
    frontmatter: Record<string, unknown>;
};
type ParticipationWritePolicy = {
    maxBytes: number;
    maxGuards: number;
    assertAccess: () => void;
};
export interface OwnerParticipationProjection {
    runs: number;
    initiations: number;
    activeRun: boolean;
}
interface OwnerParticipationUsage extends OwnerParticipationProjection {
    commit: (write: ParticipationWrite, guards: RevisionGuard[], policy: ParticipationWritePolicy) => Promise<unknown>;
}
export interface ParticipationEconomyContext {
    goals: ParticipationGoal[];
    topics: string[];
    now: number;
    seen: Array<ParticipationTarget & {
        handledAt: string;
        deferUntil?: string;
    }>;
}
export interface ParticipationEconomySnapshot {
    revision: string;
    activityRevision: string;
    frontmatter: Record<string, unknown>;
}
export declare function participationPath(principal: ScopePrincipal): string;
/** Host-only projection for cross-account owner limits. It deliberately omits
 * goals, history, seen targets, receipts, and all other private state. */
export declare function participationOwnerUsage(frontmatter: Record<string, unknown>, now: number): OwnerParticipationProjection;
/** Host-injected verified peers only. The privileged closure exposes counters
 * and a write to the requesting account, never peer paths or private bodies. */
export declare function aggregateParticipationOwnerUsage(fs: FileSystemService, principal: ScopePrincipal, peers: ScopePrincipal[], now: number): Promise<OwnerParticipationUsage>;
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
        /** Host-only verified owner map. Never read owner aliases from user notes. */
        ownerUsage?: (principal: ScopePrincipal) => Promise<OwnerParticipationUsage | undefined>;
        /** Read-only ledger projection; only host-selected public candidates leave this adapter. */
        economyCandidates?: (principal: ScopePrincipal, input: ParticipationEconomyContext) => Promise<ParticipationCandidate[]>;
        economyTargetSnapshot?: (principal: ScopePrincipal, path: string, input: ParticipationEconomyContext) => Promise<ParticipationEconomySnapshot>;
    });
    private actor;
    private fresh;
    private load;
    private day;
    private view;
    private validateSettings;
    private publicPath;
    private target;
    private activitySnapshot;
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