import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
import type { GuidanceCatalog, GuidanceSettings } from './guidance-catalog.js';
export interface NoticeEntry {
    id: string;
    path: string;
    title: string;
    priority: number;
    topics: string[];
    editors: string[];
}
interface NoticeConfig {
    version: 1;
    vaultPath: string;
    notices: NoticeEntry[];
    guidance?: GuidanceSettings;
}
/** Trusted host configuration only. Never derive editors or registration from Markdown. */
export declare class NoticeRegistry {
    private readonly vaultPath;
    private readonly configPath?;
    readonly guidance?: GuidanceCatalog | undefined;
    private readonly grant;
    constructor(vaultPath: string, configPath?: string | undefined, guidance?: GuidanceCatalog | undefined);
    load(): NoticeConfig;
    assertMutation(path: string): void;
    lookup(id: unknown): NoticeEntry | undefined;
    write<T>(path: string, fingerprint: string, operation: () => Promise<T>, assertFresh: () => void): Promise<T>;
    assertCanonical(path: string): void;
}
export declare class NoticeService {
    private readonly registry;
    private readonly fs;
    private readonly access;
    private readonly references;
    constructor(registry: NoticeRegistry, fs: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService);
    private entry;
    private current;
    private fresh;
    read(args: any, principal?: ScopePrincipal): Promise<any>;
    list(args?: any, principal?: ScopePrincipal): Promise<any>;
    priority(args: any, principal?: ScopePrincipal): Promise<any>;
    feedbackReview(id: unknown, path: string, revision: string, principal?: ScopePrincipal): Promise<{
        decision: any;
        reason: string;
        noticeId: string;
        noticePath: string;
        noticeRevision: string;
        feedbackRevision: string;
    } | undefined>;
    feedback(id: unknown, revision: unknown, principal?: ScopePrincipal): Promise<{
        noticeId: string;
        noticeRevision: string;
        noticePath: string;
    }>;
    private prepare;
    preview(args: any, principal?: ScopePrincipal): Promise<{
        id: string;
        path: string;
        expectedRevision: string;
        fingerprint: string;
        changedFrom: number;
        before: string;
        after: string;
        previewTruncated: boolean;
        decision: any;
        reason: any;
        nextAction: {
            endpointId: string;
            requires: string[];
        };
    }>;
    revise(args: any, principal: ScopePrincipal | undefined, assertActor: () => Promise<unknown>, assertActorFresh: () => void): Promise<any>;
}
export {};
//# sourceMappingURL=notices.d.ts.map