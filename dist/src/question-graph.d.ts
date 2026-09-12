import type { FileSystemService } from './filesystem.js';
import type { QueryNote } from './types.js';
export type GraphRelation = 'evidence' | 'supports' | 'contradicts' | 'depends_on' | 'derived_from';
export type GraphLocator = {
    path: string;
    revision?: string;
    heading?: string;
    blockId?: string;
    startLine?: number;
    endLine?: number;
    quoteHash?: string;
    propertyPath?: string;
    malformed?: true;
};
export type GraphEdge = {
    from: string;
    fromRevision: string;
    to: string;
    toRevision: string;
    relation: GraphRelation;
    direction: 'incoming' | 'outgoing';
    locator?: GraphLocator;
    authorLocator?: GraphLocator;
    sourceClaimId?: string;
};
export type GraphCandidate = {
    path: string;
    note: QueryNote;
    paths: GraphEdge[][];
    reasons: Set<string>;
    locators: GraphLocator[];
    root: boolean;
};
type Context = {
    fs: FileSystemService;
    roots: Array<{
        path: string;
        note: QueryNote;
    }>;
    metadata: (path: string) => Promise<QueryNote | undefined>;
    allowed: (path: string) => boolean;
    referenceAllowed: (from: string, to: string) => boolean;
    eligible: (path: string, note: QueryNote) => boolean;
    metadataExhausted: () => boolean;
    gap: (reason: string, path?: string, revision?: string) => void;
};
export declare const isPacketCounterpoint: (fm: Record<string, any>) => boolean;
/** Discover authored paths without hydrating bodies. Multiple edge kinds and
 * per-path direction survive; neither degree nor distance is a truth score. */
export declare function discoverQuestionGraph(ctx: Context): Promise<GraphCandidate[]>;
export declare function graphBodyPriority(candidate: GraphCandidate): number;
export {};
//# sourceMappingURL=question-graph.d.ts.map