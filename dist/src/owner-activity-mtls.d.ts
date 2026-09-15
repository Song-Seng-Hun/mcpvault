import type { ScopePrincipal } from './scope-auth.js';
import type { OwnerActivityExecution } from './owner-activity-runtime.js';
/** Optional host-only bridge for existing authenticated accounts. It reuses the
 * HTTP layer's CA-verified peer context, never headers, JSON or localhost labels.
 * Mapping a certificate grants NO activity/document permission and does not attest
 * local inference. Existing owner policy and current account/document checks apply.
 * Call execution only with a current principal produced by ScopeAuthService. */
export declare function loadOwnerMtlsBindings(path: string, expectedVault: string): Promise<{
    refresh: () => Promise<void>;
    execution: (principal?: ScopePrincipal) => OwnerActivityExecution | undefined;
}>;
//# sourceMappingURL=owner-activity-mtls.d.ts.map