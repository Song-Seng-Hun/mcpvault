import type { ScopePrincipal } from './scope-auth.js';
import type { Activity, OwnerActivityAction, OwnerActivityPolicy } from './owner-activity.js';
export interface OwnerActivityExecution {
    accountId: string;
    executionTarget: string;
}
export interface OwnerActivityRuntimeOptions {
    refresh?: () => Promise<void>;
    policy: () => OwnerActivityPolicy;
    execution: (principal?: ScopePrincipal) => OwnerActivityExecution | undefined;
}
export interface OwnerActivityOperation {
    readonly grantId: string;
    canAccessPath(path: string): boolean;
    canTraversePath(path: string): boolean;
    assertFresh(): void;
    revalidate(): Promise<void>;
    beforeWrite(path: string): Promise<void>;
}
/** Additional consent boundary for optional activities. This runtime accepts
 * authority only through trusted host construction options. Request fields,
 * principal labels, feature selection and document ACLs cannot create it. */
export declare class OwnerActivityRuntime {
    private readonly options?;
    constructor(options?: OwnerActivityRuntimeOptions | undefined);
    begin(activity: Activity, action: OwnerActivityAction, paths?: readonly string[], principal?: ScopePrincipal): Promise<OwnerActivityOperation>;
}
//# sourceMappingURL=owner-activity-runtime.d.ts.map