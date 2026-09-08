import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import { type Properties, type WorkBaseParams } from './work-model.js';
export interface WorkGroupParams extends WorkBaseParams {
    op?: 'read' | 'create' | 'update' | 'join' | 'leave' | 'archive';
    groupId: string;
    title?: string;
    purpose?: string;
    topics?: string[];
    references?: string[];
    maxChars?: number;
    field?: 'members' | 'topics' | 'references';
    limit?: number;
    cursor?: string;
}
export declare class WorkGroupService {
    private readonly fs;
    private readonly refs;
    private readonly auth;
    private readonly options;
    private readonly access;
    constructor(fs: FileSystemService, refs: ReferenceService, auth: ScopeAuthService, options?: {
        assertActor?: (principal: ScopePrincipal) => Promise<void>;
    });
    group(params: WorkGroupParams): Promise<Properties>;
    private actor;
    private visible;
    private validateRecord;
    private read;
    private visibleReferences;
    private validateReferences;
    private project;
    private request;
    private retry;
    private mutate;
    private write;
}
export type { WorkBaseParams } from './work-model.js';
//# sourceMappingURL=work-groups.d.ts.map