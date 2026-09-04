import type { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
type LearningOrder = 'authored' | 'recommended';
type LearningPathBuilder = (principal: ScopePrincipal, path: string, maxDepth: number, limit: number, maxChars: number) => Promise<Record<string, any>>;
export type ContinuityServiceOptions = {
    access?: ScopeAccessPolicy;
    buildLearningPath?: LearningPathBuilder;
};
export declare class ContinuityService {
    private readonly fileSystem;
    private readonly access;
    private readonly buildLearningPath;
    constructor(fileSystem: FileSystemService, options?: ContinuityServiceOptions);
    private physicalLearningPath;
    private prepareLearningProgress;
    private compactLearningProgress;
    private validateLearningProgress;
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
        pendingEdits?: unknown;
        researchTrail?: unknown;
        learningProgress?: unknown;
        expectedRevision?: string;
    }): Promise<{
        success: boolean;
        path: string;
        updatedAt: string;
        revision: string;
        learningProgress?: {
            state: "complete" | "ready" | "saved_unchecked" | "stale";
            root: {
                path: string;
                revision: string;
            };
            order: LearningOrder;
            maxDepth: number;
            entriesTracked: number;
            completedCount: number;
            completedThrough?: string;
            next?: {
                path: string;
                revision: string;
                endpointId: string;
                arguments: {
                    path: string;
                    maxChars: number;
                };
            };
            drift?: Record<string, unknown>;
            canResume?: boolean;
            nextAction?: {
                endpointId: string;
                arguments: {
                    path: string;
                    maxDepth: number;
                    limit: number;
                    maxChars: number;
                };
            };
            complete?: boolean;
            revalidateWith?: string;
        };
    }>;
    read(params: {
        principal?: ScopePrincipal;
        maxChars?: number;
        validateLearningProgress?: boolean;
    }): Promise<{
        exists: boolean;
        path: string;
    } | {
        exists: boolean;
        path: string;
        fm: {
            [x: string]: any;
        };
        content: string;
        truncated: boolean;
        revision: string;
        learningProgress?: {
            state: "complete" | "ready" | "saved_unchecked" | "stale";
            root: {
                path: string;
                revision: string;
            };
            order: LearningOrder;
            maxDepth: number;
            entriesTracked: number;
            completedCount: number;
            completedThrough?: string;
            next?: {
                path: string;
                revision: string;
                endpointId: string;
                arguments: {
                    path: string;
                    maxChars: number;
                };
            };
            drift?: Record<string, unknown>;
            canResume?: boolean;
            nextAction?: {
                endpointId: string;
                arguments: {
                    path: string;
                    maxDepth: number;
                    limit: number;
                    maxChars: number;
                };
            };
            complete?: boolean;
            revalidateWith?: string;
        } | {
            state: string;
            canResume: boolean;
            reason: string;
        };
    }>;
}
export {};
//# sourceMappingURL=continuity.d.ts.map