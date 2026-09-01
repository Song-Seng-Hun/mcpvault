import type { FileSystemService } from './filesystem.js';
import type { SearchService } from './search.js';
export type ScopeKind = 'global' | 'model' | 'agent';
export declare function normalizeScopeId(value: string, field: string): string;
export declare function parseScopePath(value: string): {
    kind: ScopeKind;
    id?: string;
    logicalPath: string;
} | undefined;
/** Convert a durable scope URI into the ordinary vault path used by every existing tool. */
export declare function expandScopePath(value: string): string;
export declare function scopeRoot(kind: ScopeKind, id?: string): string;
export declare class CollaborationService {
    private fileSystem;
    private searchService;
    constructor(fileSystem: FileSystemService, searchService: SearchService);
    private inferModelId;
    getScopeContext(modelId?: string, agentId?: string): {
        precedence: string[];
        global: {
            uri: string;
            root: string;
        };
        model?: {
            id: string;
            uri: string;
            root: string;
        };
        agent?: {
            id: string;
            uri: string;
            root: string;
            identityPath: string;
        };
        access: string;
        note: string;
    };
    createAgentScope(params: {
        agentId: string;
        modelId: string;
        sessionId: string;
        displayName?: string;
        purpose?: string;
    }): Promise<{
        success: boolean;
        agentId: string;
        modelId: string;
        sessionId: string;
        generation: number;
        path: string;
        scopeUri: string;
    }>;
    handoffAgentScope(params: {
        agentId: string;
        fromSessionId: string;
        toSessionId: string;
        reason: string;
        expectedGeneration: number;
    }): Promise<{
        success: boolean;
        agentId: string;
        generation: number;
        currentSession: string;
        path: string;
    }>;
    resumeAgentScope(params: {
        agentId: string;
        newSessionId: string;
        reason: string;
        expectedGeneration: number;
    }): Promise<{
        success: boolean;
        agentId: string;
        generation: number;
        currentSession: string;
        recoveredFrom: string;
        path: string;
    }>;
    readScopedNote(params: {
        path: string;
        modelId?: string;
        agentId?: string;
    }): Promise<{
        scope: ScopeKind;
        logicalPath: string;
        physicalPath: string;
        fm: Record<string, any>;
        content: string;
        revision: string;
    }>;
    searchScopedNotes(params: {
        query: string;
        modelId?: string;
        agentId?: string;
        limit?: number;
        maxChars?: number;
        searchContent?: boolean;
        searchFrontmatter?: boolean;
        caseSensitive?: boolean;
        includeRevisions?: boolean;
    }): Promise<any[]>;
    createDiscussion(params: {
        discussionId?: string;
        title: string;
        createdBy: string;
        subjectPath?: string;
        initialPosition: string;
        evidence?: string[];
    }): Promise<{
        success: boolean;
        discussionId: string;
        path: string;
        status: string;
        revision: string;
    }>;
    addDiscussionArgument(params: {
        discussionId: string;
        actor: string;
        stance: string;
        argument: string;
        evidence?: string[];
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        discussionId: string;
        status: any;
        revision: string;
    }>;
    updateDiscussionStatus(params: {
        discussionId: string;
        actor: string;
        status: string;
        reason: string;
        expectedRevision: string;
    }): Promise<{
        success: boolean;
        discussionId: string;
        status: string;
        revision: string;
    }>;
    getDiscussion(discussionId: string): Promise<{
        discussionId: string;
        path: string;
        fm: Record<string, any>;
        content: string;
        revision: string;
    }>;
}
//# sourceMappingURL=scopes.d.ts.map