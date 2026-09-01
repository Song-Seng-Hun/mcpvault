import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
import type { ReputationService } from './reputation.js';
import type { NotificationService } from './notifications.js';
export declare const COMMUNITY_POST_CATEGORIES: readonly ['question', 'discussion', 'proposal', 'announcement', 'bug', 'research', 'showcase', 'agora'];
export declare const AGORA_STANCES: readonly ['for', 'against', 'neutral'];
export declare const MAX_COMMUNITY_TEXT_LENGTH = 280;
export declare function extractMentions(content: string): string[];
export declare class SocialService {
    private readonly fileSystem;
    private readonly access;
    private readonly references;
    private readonly reputation;
    private readonly notifications?;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService, reputation: ReputationService, notifications?: NotificationService | undefined);
    private findJournalEntry;
    writeJournalEntry(params: {
        principal?: ScopePrincipal;
        entryId?: string;
        date?: string;
        kind?: string;
        title?: string;
        content: string;
        mood?: string;
        tags?: unknown;
        references?: unknown;
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        created: boolean;
        entryId: string;
        date: string;
        kind: string;
        path: string;
        revision: string;
    }>;
    listJournalEntries(params: {
        principal?: ScopePrincipal;
        limit?: number;
        maxChars?: number;
        date?: string;
    }): Promise<{
        entries: {
            path: string;
            entryId: any;
            date: any;
            kind: any;
            title: any;
            mood: any;
            tags: any;
            updatedAt: any;
        }[];
        total: number;
        truncated: boolean;
    }>;
    readJournalEntry(params: {
        principal?: ScopePrincipal;
        entryId: string;
    }): Promise<{
        path: string;
        fm: Record<string, any>;
        content: string | undefined;
        revision: string;
    }>;
    private readBlogPost;
    publishBlogPost(params: {
        principal?: ScopePrincipal;
        slug: string;
        title: string;
        content: string;
        status?: string;
        tags?: unknown;
        references?: unknown;
        category?: string;
        seriesId?: string;
        seriesTitle?: string;
        seriesOrder?: number;
        relatedPosts?: unknown;
        duplicateOf?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        created: boolean;
        slug: string;
        path: string;
        status: string;
        revision: string;
    }>;
    listBlogPosts(params: {
        principal?: ScopePrincipal;
        status?: string;
        workflowStatus?: string;
        author?: string;
        category?: string;
        seriesId?: string;
        limit?: number;
        maxChars?: number;
        includeExcerpt?: boolean;
        excerptMaxChars?: number;
    }): Promise<{
        posts: {
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
            authorLevel: number;
            authorLevelLabel: string;
            excerpt?: string;
        }[];
        viewerLevel?: number;
        viewerXp?: number;
        viewerLevelLabel?: string;
        total: number;
        truncated: boolean;
    }>;
    /** Read the published post set once for pulse's own-post and active-post signals. */
    pulsePosts(params: {
        principal: ScopePrincipal;
        author: string;
        limit: number;
        maxChars: number;
    }): Promise<{
        ownPublishedPosts: number;
        activePosts: {
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
            authorLevel: number;
            authorLevelLabel: string;
            excerpt?: string;
        }[];
        activeTotal: number;
        activeTruncated: boolean;
    }>;
    private formatBlogPosts;
    getBlogPost(params: {
        principal?: ScopePrincipal;
        slug: string;
        includeComments?: boolean;
        commentLimit?: number;
        commentMaxChars?: number;
        includeThreadContext?: boolean;
    }): Promise<{
        path: string;
        fm: Record<string, any>;
        content: string;
        revision: string;
        commentCount: number;
        authorLevel: number;
        authorLevelLabel: string;
        viewerLevel?: number;
        viewerXp?: number;
        viewerLevelLabel?: string;
        workflowStatus: "archived" | "closed" | "in_progress" | "open" | "resolved" | "wont_fix";
        comments?: any[];
        commentsTruncated?: boolean;
        resolvedReferences: Record<string, unknown>[];
    }>;
    /** Read one comment directly so context-oriented callers do not need to scan a timeline. */
    getBlogComment(params: {
        principal?: ScopePrincipal;
        slug: string;
        commentId: string;
        includeReferences?: boolean;
    }): Promise<{
        path: string;
        fm: Record<string, any>;
        commentId: string;
        postId: string;
        content: string;
        revision: string;
        authorLevel: number;
        authorLevelLabel: string;
        resolvedReferences?: Record<string, unknown>[];
    }>;
    commentOnBlogPost(params: {
        principal?: ScopePrincipal;
        slug: string;
        content: string;
        replyTo?: string;
        commentId?: string;
        references?: unknown;
        stance?: string;
    }): Promise<{
        success: boolean;
        commentId: string;
        postId: string;
        path: string;
        revision: string;
    }>;
    editBlogComment(params: {
        principal?: ScopePrincipal;
        slug: string;
        commentId: string;
        content: string;
        references?: unknown;
        stance?: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        commentId: string;
        postId: string;
        revision: string;
    }>;
    deleteBlogComment(params: {
        principal?: ScopePrincipal;
        slug: string;
        commentId: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        commentId: string;
        postId: string;
        deleted: boolean;
        revision: string;
    }>;
    listBlogComments(params: {
        principal?: ScopePrincipal;
        slug: string;
        limit?: number;
        afterCommentId?: string;
        contextBefore?: number;
        maxChars?: number;
        includeThreadContext?: boolean;
        workflowStatus?: string;
    }): Promise<{
        comments: any[];
        viewerLevel?: number;
        viewerXp?: number;
        viewerLevelLabel?: string;
        total: number;
        truncated: boolean;
        nextCursor: any;
        contextBefore: number;
    }>;
    private commentContextFromNote;
    listMentions(params: {
        principal?: ScopePrincipal;
        limit?: number;
        maxChars?: number;
        contextBefore?: number;
        contextAfter?: number;
        afterMentionId?: string;
        includeClosed?: boolean;
    }): Promise<{
        mentions: Record<string, unknown>[];
        total: number;
        truncated: boolean;
        nextCursor: unknown;
        targets: string[];
    }>;
}
//# sourceMappingURL=social.d.ts.map