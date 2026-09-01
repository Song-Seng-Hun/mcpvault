import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
export declare const MAX_COMMUNITY_TEXT_LENGTH = 280;
export declare function extractMentions(content: string): string[];
export declare class SocialService {
    private readonly fileSystem;
    private readonly access;
    private readonly references;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService);
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
        limit?: number;
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
            createdAt: any;
            updatedAt: any;
            workflowStatus: "archived" | "closed" | "in_progress" | "open" | "resolved" | "wont_fix";
            workflowStatusBy: any;
            workflowStatusReason: any;
            workflowStatusUpdatedAt: any;
            excerpt?: string;
        }[];
        total: number;
        truncated: boolean;
    }>;
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
        workflowStatus: "archived" | "closed" | "in_progress" | "open" | "resolved" | "wont_fix";
        comments?: any[];
        commentsTruncated?: boolean;
        resolvedReferences: Record<string, unknown>[];
    }>;
    commentOnBlogPost(params: {
        principal?: ScopePrincipal;
        slug: string;
        content: string;
        replyTo?: string;
        commentId?: string;
        references?: unknown;
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
        slug: string;
        limit?: number;
        afterCommentId?: string;
        contextBefore?: number;
        maxChars?: number;
        includeThreadContext?: boolean;
        workflowStatus?: string;
    }): Promise<{
        comments: any[];
        total: number;
        truncated: boolean;
        nextCursor: any;
        contextBefore: number;
    }>;
    private readCommentContext;
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