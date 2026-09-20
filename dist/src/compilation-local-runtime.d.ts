import type { CompilationOptions } from './compilation-service.js';
import type { CompilationBundleGrant, CompilationSourcePolicy, CompilationOperation } from './compilation-policy.js';
/** Server-owned structural execution, never attestation of the calling model. */
export declare const builtinVerbatimRuntime: NonNullable<CompilationOptions['runtime']>;
export declare function bundleExecution(options: CompilationOptions, grant: CompilationBundleGrant, mode: CompilationSourcePolicy['mode']): {
    operation: "index" | "synthesize";
    runtime: ((principal: import("./scope-auth.js").ScopePrincipal, operation: CompilationOperation, paths: readonly string[]) => Promise<import("./compilation-policy.js").CompilationRuntime | undefined>) | undefined;
};
//# sourceMappingURL=compilation-local-runtime.d.ts.map