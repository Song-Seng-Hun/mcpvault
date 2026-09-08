import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
interface Action {
    endpointId: string;
    arguments: Record<string, unknown>;
}
export interface ResearchWorkPacket {
    state: string;
    taskId?: string;
    revision?: string;
    nextAction?: Action;
    createAction?: Action;
    workshopAction?: Action;
}
export declare function researchWorkIds(researchKey: string): {
    taskId: string;
    taskPath: string;
    workshopId: string;
    workshopPath: string;
};
/** Read-only drafts. Research workshop writes must atomically guard the attached claim snapshot. */
interface ResearchWorkRequest {
    researchKey: string;
    query: string;
    inputs: {
        path: string;
        revision: string;
    }[];
    principal?: ScopePrincipal;
    projectId?: string;
    publicRequestId?: string;
}
export declare function researchWorkPacket(fs: FileSystemService, access: ScopeAccessPolicy, params: ResearchWorkRequest): Promise<ResearchWorkPacket>;
export {};
//# sourceMappingURL=research-bridge-work.d.ts.map