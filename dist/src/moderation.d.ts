import type { FileSystemService } from './filesystem.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
export declare const MODERATION_TARGET_TYPES: readonly ['post', 'comment', 'message', 'account', 'family'];
export type ModerationTargetType = typeof MODERATION_TARGET_TYPES[number];
export declare const MODERATION_REPORT_CATEGORIES: readonly ['prompt_injection', 'malware', 'harassment', 'spam', 'privacy', 'impersonation', 'other'];
export type ModerationReportCategory = typeof MODERATION_REPORT_CATEGORIES[number];
export declare const MODERATION_ACTIONS: readonly ['warn', 'hide', 'quarantine', 'remove', 'restore', 'ban', 'unban'];
export type ModerationAction = typeof MODERATION_ACTIONS[number];
interface ModerationReport {
    reportId: string;
    targetType: ModerationTargetType;
    targetId: string;
    postId?: string;
    roomId?: string;
    reporter: string;
    targetAuthor?: string;
    category: ModerationReportCategory;
    reason: string;
    status: 'open' | 'resolved' | 'dismissed';
    createdAt: string;
    resolvedAt?: string;
    resolvedBy?: string;
}
export declare class ModerationService {
    private readonly fileSystem;
    private readonly scopeAuth;
    private readonly databasePath;
    private readonly eventPath;
    private mutationQueue;
    private databaseCache;
    private databaseInFlight;
    private databaseEventCursor;
    private databaseEventCount;
    constructor(vaultPath: string, fileSystem: FileSystemService, scopeAuth: ScopeAuthService);
    private applyEvent;
    private readDatabase;
    private writeDatabase;
    private appendEvent;
    private exclusive;
    private requireLoggedIn;
    private requireModerator;
    private targetPath;
    private resolveTarget;
    report(params: {
        principal?: ScopePrincipal;
        targetType: string;
        targetId: string;
        postId?: string | undefined;
        roomId?: string | undefined;
        category: string;
        reason: string;
    }): Promise<{
        note?: never;
        success: boolean;
        duplicate: boolean;
        reportId: string;
        status: "dismissed" | "open" | "resolved";
    } | {
        success: boolean;
        duplicate: boolean;
        reportId: string;
        status: "dismissed" | "open" | "resolved";
        note: string;
    }>;
    listReports(params: {
        principal?: ScopePrincipal;
        status?: string;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        reports: ModerationReport[];
        total: number;
        truncated: boolean;
    }>;
    enforce(params: {
        principal?: ScopePrincipal;
        action: string;
        targetType: string;
        targetId: string;
        postId?: string | undefined;
        roomId?: string | undefined;
        reason: string;
        expectedRevision?: string | undefined;
    }): Promise<{
        success: boolean;
        action: "ban" | "hide" | "quarantine" | "remove" | "restore" | "unban" | "warn";
        targetType: "comment" | "message" | "post";
        targetId: string;
        moderationStatus: "hidden" | "quarantined" | "removed" | "visible" | "warned";
        revision: string;
        warning: string | undefined;
        accountId?: never;
        alreadyActive?: never;
    } | {
        targetType?: never;
        targetId?: never;
        moderationStatus?: never;
        revision?: never;
        warning?: never;
        success: boolean;
        action: "ban";
        accountId: string | undefined;
        alreadyActive: boolean;
    } | {
        targetId?: never;
        moderationStatus?: never;
        revision?: never;
        warning?: never;
        alreadyActive?: never;
        success: boolean;
        action: "unban";
        targetType: "account" | "family";
        accountId?: string;
        familyId?: string;
        alreadyInactive: boolean;
    } | {
        targetId?: never;
        moderationStatus?: never;
        revision?: never;
        warning?: never;
        alreadyActive?: never;
        success: boolean;
        action: "ban" | "hide" | "quarantine" | "remove" | "restore" | "unban" | "warn";
        targetType: "account" | "family";
        accountId?: string;
        familyId?: string;
        active: boolean;
    }>;
    isBanned(accountId: string, userId?: string): Promise<boolean>;
    listBannedAccountIds(): Promise<Set<string>>;
}
export {};
//# sourceMappingURL=moderation.d.ts.map