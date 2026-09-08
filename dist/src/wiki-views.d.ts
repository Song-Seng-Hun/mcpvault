import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { QueryNotesCursor } from './types.js';
export interface SavedView {
    version: 1;
    filters: Record<string, string | number | boolean>;
    columns: string[];
    pathPrefix?: string;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    limit: number;
}
export interface ViewReadOptions {
    path: string;
    expectedRevision?: string;
    after?: QueryNotesCursor;
    limit?: number;
    maxChars?: number;
    prettyPrint?: boolean;
}
export declare function parseSavedView(value: unknown): SavedView;
/** Uses the existing metadata index. There is no script evaluator or second index. */
export declare class WikiViewService {
    private readonly fs;
    private readonly access;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy);
    private definition;
    read(principal: ScopePrincipal | undefined, options: ViewReadOptions): Promise<{
        definition: {
            path: string;
            revision: string;
        };
        items: {
            path: string;
            revision?: string;
            properties: Record<string, unknown>;
            propertiesTruncated?: boolean;
        }[];
        truncated: boolean;
        nextAction?: {
            endpointId: string;
            arguments: ViewReadOptions;
        };
        freshness: string;
    }>;
    bases(principal: ScopePrincipal | undefined, options: ViewReadOptions): Promise<{
        definition: {
            path: string;
            revision: string;
        };
        yaml: string;
        permissionBoundary: boolean;
        warning: "Host-only projection: Bases sees the host vault, not MCP account permissions.";
    }>;
}
//# sourceMappingURL=wiki-views.d.ts.map