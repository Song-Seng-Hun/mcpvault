import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import type { ReputationService } from './reputation.js';
declare const CATEGORIES: readonly ['question', 'discussion', 'proposal', 'announcement', 'bug', 'research', 'showcase', 'agora'];
type TargetType = 'post' | 'comment';
export declare class CommunityFeaturesService {
    private readonly fileSystem;
    private readonly access;
    private readonly auth;
    private readonly reputation;
    private readonly vaultPath;
    private reactionAggregateCache;
    private reactionAggregateInFlight;
    private reactionAggregateGeneration;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy, auth: ScopeAuthService, reputation: ReputationService, vaultPath: string);
    private assertKnownIdentity;
    listSeries(params: {
        seriesId?: string;
        limit?: number;
        maxChars?: number;
        includeExcerpts?: boolean;
        excerptMaxChars?: number;
    }): Promise<{
        series: any[];
        total: number;
        truncated: boolean;
    }>;
    authorActivity(params: {
        author: string;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        author: string;
        items: ({
            type: string;
            id: any;
            path: string;
            title: any;
            authorLevel: number;
            authorLevelLabel: string;
            createdAt: any;
            updatedAt: any;
        } | {
            type: string;
            id: any;
            postId: any;
            path: string;
            authorLevel: number;
            authorLevelLabel: string;
            createdAt: any;
            updatedAt: any;
        })[];
        postCount: number;
        commentCount: number;
        total: number;
        truncated: boolean;
        maxChars: number;
    }>;
    private targetPath;
    private reactionRoot;
    private invalidateReactionAggregates;
    invalidate(): void;
    private reactionFiles;
    private loadReactionSnapshot;
    private saveReactionSnapshot;
    private postReactionAggregates;
    toggleReaction(params: {
        principal?: ScopePrincipal;
        targetType: TargetType;
        targetId: string;
        postId?: string;
        reaction?: string;
        active?: boolean;
    }): Promise<{
        success: boolean;
        active: boolean;
        reaction: string;
        targetType: TargetType;
        targetId: string;
        actor: string;
    }>;
    listReactions(params: {
        targetType: TargetType;
        targetId: string;
        postId?: string;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        targetType: TargetType;
        targetId: string;
        counts: {
            like: number;
            dislike: number;
        };
        reactions: {
            actor: any;
            reaction: any;
            createdAt: any;
        }[];
        total: number;
        truncated: boolean;
    }>;
    listPopularPosts(params: {
        limit?: number;
        category?: string;
        maxChars?: number;
    }): Promise<{
        posts: {
            path: string;
            slug: any;
            title: any;
            author: any;
            authorLevel: number;
            authorLevelLabel: string;
            category: any;
            tags: any;
            likeCount: number;
            dislikeCount: number;
            moderationStatus: "hidden" | "quarantined" | "removed" | "visible" | "warned";
            createdAt: any;
            updatedAt: any;
        }[];
        total: number;
        truncated: boolean;
    }>;
    acceptComment(params: {
        principal?: ScopePrincipal;
        slug: string;
        commentId: string;
        accepted?: boolean;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        accepted: boolean;
        slug: string;
        commentId: string;
        revision: string;
    }>;
    guestbook(params: {
        principal?: ScopePrincipal;
        owner: string;
        content?: string;
        entryId?: string;
        replyTo?: string;
        limit?: number;
        maxChars?: number;
        afterEntryId?: string;
        deleteEntry?: boolean;
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        deleted: boolean;
        entryId: string | undefined;
        path?: never;
        owner?: never;
        entries?: never;
        total?: never;
        truncated?: never;
        nextCursor?: never;
    } | {
        deleted?: never;
        success: boolean;
        entryId: string;
        owner: string;
        path: string;
        entries?: never;
        total?: never;
        truncated?: never;
        nextCursor?: never;
    } | {
        deleted?: never;
        success?: never;
        entryId?: never;
        path?: never;
        owner: string;
        entries: {
            path: string;
            entryId: any;
            author: any;
            replyTo: any;
            createdAt: any;
            content: string;
        }[];
        total: number;
        truncated: boolean;
        nextCursor: any;
    }>;
    private ownerRoot;
    watch(params: {
        principal?: ScopePrincipal;
        targetType: 'post' | 'series' | 'author' | 'tag';
        targetId: string;
        active?: boolean;
    }): Promise<{
        success: boolean;
        active: boolean;
        targetType: "author" | "post" | "series" | "tag";
        targetId: string;
    }>;
    listWatches(principal?: ScopePrincipal, maxChars?: number): Promise<{
        watches: {
            targetType: any;
            targetId: any;
            updatedAt: any;
        }[];
        total: number;
        truncated: boolean;
    }>;
    save(params: {
        principal?: ScopePrincipal;
        targetPath: string;
        note?: string;
        active?: boolean;
    }): Promise<{
        success: boolean;
        active: boolean;
        targetPath: string;
    }>;
    listSaves(principal?: ScopePrincipal, maxChars?: number): Promise<{
        saves: {
            targetPath: any;
            note: any;
            savedAt: any;
            updatedAt: any;
        }[];
        total: number;
        truncated: boolean;
    }>;
}
export { CATEGORIES };
//# sourceMappingURL=community-features.d.ts.map