import type { FileSystemService } from '../filesystem.js';
import type { ScopeAccessPolicy } from '../scope-access.js';
import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionConfig } from '../evolution/model.js';
import type { CurationReadIndex } from './read-index.js';
interface Options {
    fs: FileSystemService;
    access: ScopeAccessPolicy;
    readIndex?: CurationReadIndex | undefined;
    config(): Promise<EvolutionConfig>;
    managedProof(path: string, revision: string, principal: ScopePrincipal): Promise<string | undefined>;
    advanceAction?(path: string, revision: string, context: Context): Promise<Record<string, unknown> | undefined>;
}
interface Context {
    principal: ScopePrincipal;
    current(): Promise<void>;
}
/** Bounded, live-validated discovery. Opaque, process-local continuation never
 * exposes hidden paths or turns a cached match into permission to mutate. */
export declare class CurationDiscovery {
    private readonly options;
    private readonly cursors;
    constructor(options: Options);
    list(p: Record<string, any>, c: Context): Promise<{
        status: string;
        partial: boolean;
        reason: string;
        candidates: never[];
        effectVerified: boolean;
        usage: {
            coverage: string;
        };
        nextAction: {
            endpointId: string;
            arguments: {
                kind: string;
                op: string;
                candidateKind: "duplicate_content" | "relations";
            };
        };
    } | {
        status: string;
        basis: string;
        candidates: Record<string, unknown>[];
        partial: boolean;
        effectVerified: boolean;
        usage: {
            coverage: string;
        };
        nextAction: {
            endpointId: string;
            arguments: {
                kind: string;
                op: string;
                candidateKind: "duplicate_content" | "relations";
                cursor: string;
                limit: any;
                maxChars: any;
            };
        } | null;
    }>;
}
export {};
//# sourceMappingURL=discovery.d.ts.map