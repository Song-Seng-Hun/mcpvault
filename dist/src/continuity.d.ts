import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare class ContinuityService {
    private readonly fileSystem;
    constructor(fileSystem: FileSystemService);
    save(params: {
        principal?: ScopePrincipal;
        topic: string;
        summary: string;
        nextAction: string;
        openQuestions?: unknown;
        references?: unknown;
        cursors?: unknown;
        focusQuestions?: unknown;
        focusProjects?: unknown;
        focusNotes?: unknown;
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        path: string;
        updatedAt: string;
        revision: string;
    }>;
    read(params: {
        principal?: ScopePrincipal;
        maxChars?: number;
    }): Promise<{
        truncated?: never;
        exists: boolean;
        path: string;
        fm?: never;
        content?: never;
        revision?: never;
    } | {
        exists: boolean;
        path: string;
        fm: Record<string, any>;
        content: string;
        truncated: boolean;
        revision: string;
    }>;
}
//# sourceMappingURL=continuity.d.ts.map