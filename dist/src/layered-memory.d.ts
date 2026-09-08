import type { FileSystemService } from './filesystem.js';
import type { RetrievalService } from './retrieval-service.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export interface MemoryRequest {
    principal?: ScopePrincipal;
    scope?: 'personal' | 'user' | 'community' | 'global';
    query?: string;
    role?: string;
    dateFrom?: string;
    dateTo?: string;
    pathPrefix?: string;
    includeHistory?: boolean;
    semantic?: boolean;
    cursor?: {
        snapshot: string;
        offset: number;
    };
    limit?: number;
    maxChars?: number;
}
/** Read-time projections over the existing metadata and search indexes. No memory DB. */
export declare class LayeredMemoryService {
    private readonly fs;
    private readonly retrieval;
    private readonly access;
    constructor(fs: FileSystemService, retrieval: RetrievalService, access: ScopeAccessPolicy);
    read(mode: 'recall' | 'brief' | 'consolidate', params: MemoryRequest): Promise<{
        scope: "community" | "global" | "personal" | "user";
        mode: "brief" | "consolidate" | "recall";
        interpretation: string;
        status: string;
        items: any[];
        snapshot: string;
        truncated: boolean;
        nextCursor?: {
            snapshot: string;
            offset: number;
        };
        search?: {
            usedQuery: string;
            expanded: boolean;
            semantic: "available" | "disabled" | "filtered" | "unavailable";
        };
        warnings: string[];
        nextAction: any;
    } | {
        scope: "community" | "global" | "personal" | "user";
        mode: "brief" | "consolidate" | "recall";
        status: string;
        items: never[];
        truncated: boolean;
        reason: string;
        retry: {
            maxChars: number;
        };
        hint: string;
    } | {
        scope: "community" | "global" | "personal" | "user";
        mode: "brief" | "consolidate" | "recall";
        status: string;
        items: never[];
        truncated: boolean;
        reason: string;
        nextAction: {
            endpointId: string;
            arguments: {
                scope: "community" | "global" | "personal" | "user";
                includeHistory: boolean;
                limit: number;
                maxChars: number;
            };
        };
        hint: string;
    }>;
}
//# sourceMappingURL=layered-memory.d.ts.map