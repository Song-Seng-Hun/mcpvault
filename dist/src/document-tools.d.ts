import type { Tool } from '@modelcontextprotocol/server';
import type { DocumentService } from './document-service.js';
import type { DocumentSearch } from './document-search.js';
import type { ScopePrincipal } from './scope-auth.js';
export declare const DOCUMENT_TOOL_ENDPOINTS: Record<string, string>;
export declare function getDocumentTools(): Tool[];
export declare function dispatchDocumentTool(name: string, input: Record<string, any>, principal: ScopePrincipal | undefined, service: DocumentService, search: DocumentSearch): Promise<import("./document-service.js").ReadResult | import("./work-model.js").WorkPage | {
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
} | {
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
//# sourceMappingURL=document-tools.d.ts.map