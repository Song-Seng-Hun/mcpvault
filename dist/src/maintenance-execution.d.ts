import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ModerationService } from './moderation.js';
/** A fresh host execution, never an inherited model/session's authority.
 * Protected derivatives require the dedicated classification workflow and stay
 * manual in this release; maintenance must not silently declassify them. */
export declare function maintenanceExecution(auth: ScopeAuthService, access: ScopeAccessPolicy, moderation: ModerationService, refreshPolicy: () => Promise<void>): {
    authorize: (accountId: string) => Promise<ScopePrincipal | undefined>;
    runAs: <T>(principal: ScopePrincipal, operation: () => Promise<T>) => Promise<T>;
};
//# sourceMappingURL=maintenance-execution.d.ts.map