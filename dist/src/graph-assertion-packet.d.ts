import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type GraphAssertion } from './graph-assertion.js';
export interface GraphAssertionPacketOptions {
    path: string;
    limit?: number;
    maxChars?: number;
    prettyPrint?: boolean;
}
export interface PublicAssertion {
    id: string;
    source: GraphAssertion['source'];
    relation: string;
    direction: 'source_to_target';
    target: {
        path: string;
        revision: string;
        blockId?: string;
        heading?: string;
    };
    locator: GraphAssertion['locator'];
    kind: GraphAssertion['kind'];
    extraction: GraphAssertion['extraction'];
    evidenceState: 'not_verified';
    validation: {
        state: 'current_locators' | 'review_required' | 'not_checked';
        reasons: string[];
    };
}
/** One-note outgoing occurrence view. No raw candidates/labels, aggregate hidden
 * counts, model calls, writes, inference or global-integrity claim. */
export declare function buildGraphAssertionPacket(fs: FileSystemService, access: ScopeAccessPolicy, principal: ScopePrincipal | undefined, options: GraphAssertionPacketOptions): Promise<{
    view: string;
    assertions: PublicAssertion[];
    coverage: {
        globalIntegrity: boolean;
    };
    partial: boolean;
    nextAction: {
        endpointId: string;
        arguments: {
            path: string;
            expectedRevision: string;
            maxChars: number;
        };
    };
}>;
//# sourceMappingURL=graph-assertion-packet.d.ts.map