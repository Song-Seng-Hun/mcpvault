import type { CompilationOptions } from './compilation-service.js';
import type { ScopePrincipal } from './scope-auth.js';
/** Private preservation only. No generation, publication, or Vault writes.
 * A journal receipt is not a grant. Every return rechecks current admission. */
export declare class CompilationBundleService {
    private readonly options;
    private tail;
    constructor(options: CompilationOptions);
    execute(params: Record<string, any>, principal?: ScopePrincipal): Promise<any>;
    private actor;
    private admission;
    private summary;
    private run;
}
//# sourceMappingURL=compilation-bundle-service.d.ts.map