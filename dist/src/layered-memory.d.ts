import type { FileSystemService } from './filesystem.js';
import type { RetrievalService } from './retrieval-service.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type MemoryTaskContext } from './retrieval/memory-plan.js';
import type { MemoryReadIndex } from './memory/read-index.js';
import { MemoryExposure, type MemoryReuse } from './memory/exposure.js';
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
    taskContext?: MemoryTaskContext;
    reuse?: MemoryReuse;
}
/** Read-time projections; optional disk index stores disposable discovery metadata. */
export declare class LayeredMemoryService {
    private readonly fs;
    private readonly retrieval;
    private readonly access;
    private readonly disk?;
    readonly exposure: MemoryExposure;
    constructor(fs: FileSystemService, retrieval: RetrievalService, access: ScopeAccessPolicy, disk?: MemoryReadIndex | undefined);
    read(mode: 'recall' | 'brief' | 'consolidate', params: MemoryRequest): Promise<any>;
}
//# sourceMappingURL=layered-memory.d.ts.map