import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { RetrievalService } from './retrieval-service.js';
import { type ResearchWorkPacket } from './research-bridge-work.js';
export interface ResearchBridgeRequest {
    focusPath: string;
    comparePath?: string;
    query?: string;
    principal?: ScopePrincipal;
    expectedRevision?: string;
    compareRevision?: string;
    limit?: number;
    maxChars?: number;
    semantic?: boolean;
    projectId?: string;
    revisit?: boolean;
    publicRequestId?: string;
}
export interface BridgeCandidate {
    target: string;
    lane: 'near' | 'distant';
    status: 'unverified_hypothesis';
    researchKey: string;
    inputPaths: string[];
    observations: string[];
    gaps: string[];
    work?: ResearchWorkPacket;
}
/** Bounded discovery material, never an inference engine or an evidence verdict. */
export declare class ResearchBridgeService {
    private readonly fs;
    private readonly access;
    private readonly retrieval?;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, retrieval?: Pick<RetrievalService, 'retrieve' | 'physical'> | undefined);
    candidates(params: ResearchBridgeRequest): Promise<{
        status: string;
        mode: string;
        interpretation: string;
        candidates: BridgeCandidate[];
        sources: {
            path: string;
            revision: string;
            authoredSignals: {
                [k: string]: string[];
            };
            propertiesLineRange: number[];
            excerpt?: {
                text: any;
                startLine: any;
                endLine: any;
                headingPath: never[];
                truncated: boolean;
            };
            nextAction: {
                endpointId: string;
                arguments: {
                    path: string;
                    startLine: number;
                    endLine: number;
                    expectedRevision: string;
                    maxChars: number;
                };
            } | {
                endpointId: string;
                arguments: {
                    path: string;
                    expectedRevision: string;
                    maxChars: number;
                };
            };
        }[];
        semantic: {
            state: string;
        };
        coverage: {
            partial: boolean;
            metadataRetained: number;
            bodyReads: number;
            totalUnknown: boolean;
        };
        notice: string;
        nextAction: {
            endpointId: string;
            arguments: {
                path: string;
                startLine: number;
                endLine: number;
                expectedRevision: string;
                maxChars: number;
            };
        } | {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string;
                maxChars: number;
            };
        } | undefined;
    }>;
    private discover;
}
//# sourceMappingURL=research-bridge.d.ts.map