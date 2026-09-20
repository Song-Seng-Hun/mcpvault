import type { CompilationOptions } from './compilation-service.js';
import type { ScopePrincipal } from './scope-auth.js';
/** Request-local, code-owned policy transition. Never accepted from MCP JSON. */
export interface PublicationBoundary {
    sources: readonly string[];
    update(operation: () => Promise<void>): Promise<void>;
}
/** Concrete owner adapter: existing private journal + filesystem change sets +
 * protected policy. No generic execution, model calls, or new grants. */
export declare class CompilationPublication {
    private readonly options;
    constructor(options: CompilationOptions);
    execute(p: Record<string, any>, principal?: ScopePrincipal, transition?: PublicationBoundary): Promise<any>;
}
//# sourceMappingURL=compilation-publication.d.ts.map