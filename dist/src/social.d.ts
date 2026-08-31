import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare class SocialService {
    private readonly fileSystem;
    private readonly access;
    constructor(fileSystem: FileSystemService, access: ScopeAccessPolicy);
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
        limit?: number;
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
        }[];
        total: number;
        truncated: boolean;
    }>;
    getBlogPost(params: {
        principal?: ScopePrincipal;
        slug: string;
    }): Promise<{
        path: string;
        fm: Record<string, any>;
        content: string;
        revision: string;
        commentCount: number;
    }>;
    commentOnBlogPost(params: {
        principal?: ScopePrincipal;
        slug: string;
        content: string;
        replyTo?: string;
        commentId?: string;
    }): Promise<{
        success: boolean;
        commentId: string;
        postId: string;
        path: string;
        revision: string;
    }>;
    listBlogComments(params: {
        slug: string;
        limit?: number;
    }): Promise<{
        comments: {
            path: string;
            commentId: any;
            postId: any;
            author: any;
            replyTo: any;
            createdAt: any;
            content: string | undefined;
        }[];
        total: number;
        truncated: boolean;
    }>;
}
//# sourceMappingURL=social.d.ts.map