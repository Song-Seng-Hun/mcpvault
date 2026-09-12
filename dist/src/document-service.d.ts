import type { DocumentIndex } from './document-index.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { DocumentFragment } from './document-structure.js';
import { type DocumentRangeRequest, type DocumentRange } from './document-ranges.js';
import { pdfRangeProvenance } from './document-pdf.js';
export interface DocumentParams {
    path: string;
    expectedRevision?: string;
    principal?: ScopePrincipal;
    maxChars?: number;
}
export interface DocumentOutlineParams extends DocumentParams {
    parentId?: string;
    limit?: number;
    cursor?: string;
}
export interface DocumentReadParams extends DocumentParams, DocumentRangeRequest {
    ranges?: DocumentRangeRequest[];
    cursor?: string;
    knownReads?: string[];
    forceRead?: boolean;
}
export interface DocumentExportParams extends DocumentParams {
    startByte?: number;
    byteLength?: number;
}
export interface ResourceManifestParams extends DocumentParams {
    limit?: number;
    cursor?: string;
}
export interface ReadPart extends DocumentRange {
    text: string;
    startLine: number;
    endLine: number;
    receipt?: string;
    pdfProvenance?: ReturnType<typeof pdfRangeProvenance>;
    provenanceOmitted?: number;
}
export interface ReadResult {
    path: string;
    revision: string;
    profile: string;
    locator: string;
    context: string;
    parts: ReadPart[];
    skippedRanges: number;
    truncated: boolean;
    pendingRanges: number;
    gaps?: string[];
    gapsOmitted?: number;
    nextAction?: {
        endpointId: string;
        arguments: Omit<DocumentReadParams, 'principal'>;
    };
}
export declare function documentFragmentDescriptor(f: DocumentFragment): {
    id: string;
    kind: string;
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
    headingPath: string;
    description: string;
    parent: string | undefined;
    previous: string | undefined;
    next: string | undefined;
    childrenCount: number;
    references: string[];
    referencesOmitted: number;
};
/** Read-only projection shared by MCP and REST. Every call revalidates source and scope. */
export declare class DocumentService {
    readonly index: DocumentIndex;
    private readonly signingKey;
    constructor(index: DocumentIndex);
    private binding;
    private sign;
    private verify;
    outline(params: DocumentOutlineParams): Promise<import("./work-model.js").WorkPage>;
    private outlineWithinWork;
    read(params: DocumentReadParams): Promise<ReadResult>;
    private readWithinWork;
    manifest(params: ResourceManifestParams): Promise<import("./work-model.js").WorkPage | {
        path: string;
        revision: string;
        sha256: string;
        byteLength: number;
        mediaType: string;
        execution: string;
        provenance: string;
        license: string;
        exportAction: {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string;
            };
        };
    }>;
    private manifestWithinWork;
    export(params: DocumentExportParams): Promise<{
        path: string;
        revision: string;
        mediaType: string;
        encoding: string;
        startByte: number;
        endByte: number;
        totalBytes: number;
        data: string;
        nextAction?: {
            endpointId: string;
            arguments: {
                path: string;
                expectedRevision: string;
                startByte: number;
                byteLength: number;
                maxChars: number;
            };
        };
    }>;
    private exportWithinWork;
}
//# sourceMappingURL=document-service.d.ts.map