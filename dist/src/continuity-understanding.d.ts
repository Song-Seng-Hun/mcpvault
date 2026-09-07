import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type UnderstandingEntry } from './continuity-understanding-model.js';
export declare const UNDERSTANDING_READ_BYTES: number;
export declare const UNDERSTANDING_UNAVAILABLE = "Understanding checkpoint or references unavailable or changed; resume current context before retrying.";
export declare function prepareUnderstanding(fs: FileSystemService, access: ScopeAccessPolicy, principal: ScopePrincipal, container: string, value: unknown): Promise<{
    entries: UnderstandingEntry[];
    guards: {
        path: string;
        expectedRevision: string;
    }[];
    assertAccess: () => void;
}>;
export declare function inspectUnderstanding(fs: FileSystemService, access: ScopeAccessPolicy, principal: ScopePrincipal, container: string, value: unknown, validate: boolean, onRead?: (path: string) => void): Promise<{
    projection: Record<string, any>;
    revalidate: () => Promise<void>;
    assertAccess?: () => void;
}>;
//# sourceMappingURL=continuity-understanding.d.ts.map