import type { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type ContinuityPinSelection, type ContinuityValidation } from './continuity-pins.js';
type LearningOrder = 'authored' | 'recommended';
type LearningPathBuilder = (principal: ScopePrincipal, path: string, maxDepth: number, limit: number, maxChars: number) => Promise<Record<string, any>>;
export type ContinuityServiceOptions = {
    access?: ScopeAccessPolicy;
    buildLearningPath?: LearningPathBuilder;
};
type ResumeState = {
    exists: true;
    path: string;
    revision?: string;
    fm: Record<string, any>;
    content: string;
    truncated: boolean;
    learningProgress?: Record<string, any>;
    understanding?: Record<string, any>;
    validation: ContinuityValidation;
    route?: {
        kind: 'verified_resume';
        reason: string;
        skipped: string[];
    };
    nextAction?: {
        endpointId: string;
        arguments: Record<string, unknown>;
    };
};
export declare class ContinuityService {
    private readonly fileSystem;
    private readonly access;
    private readonly buildLearningPath;
    constructor(fileSystem: FileSystemService, options?: ContinuityServiceOptions);
    private physicalLearningPath;
    private prepareLearningProgress;
    previewLearningConfiguration(params: {
        principal?: ScopePrincipal;
        rootPath: string;
        configuration: unknown;
        mappings: unknown;
        order?: string;
        maxDepth?: number;
        maxChars?: number;
    }): Promise<{
        root: {
            path: string;
            revision: string;
        };
        fingerprint: string;
        mappings: {
            nodeId: string;
            path: string;
            revision: string;
        }[];
        executable: boolean;
        permissionsGranted: boolean;
        competencyCertified: boolean;
        checkpointAction: {
            endpointId: string;
            requiredArguments: string[];
            learningProgress: {
                rootPath: string;
                order: LearningOrder;
                maxDepth: number;
                configuration: {
                    definition: Record<string, unknown>;
                    mappings: {
                        nodeId: string;
                        path: string;
                    }[];
                    expectedFingerprint: string;
                };
            };
        };
    }>;
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
        understanding?: unknown;
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
            configuration?: {
                fingerprint: string;
                mappedNodes: number;
                competencyCertified: boolean;
            };
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
        validatePins?: ContinuityPinSelection;
        prettyPrint?: boolean;
    }): Promise<ResumeState | {
        exists: boolean;
        path: string;
        legacyCheckpointPolicy?: string;
    }>;
}
export {};
//# sourceMappingURL=continuity.d.ts.map