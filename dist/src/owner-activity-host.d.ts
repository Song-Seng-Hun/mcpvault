import { OwnerActivityPolicy } from './owner-activity.js';
/** Reloadable host consent data only. This file cannot attest a model runtime,
 * create execution identities or relax independent document permissions. */
export declare function loadOwnerActivityHostConfig(path: string, expectedVault: string): Promise<{
    policy: () => OwnerActivityPolicy;
    refresh: () => Promise<void>;
}>;
//# sourceMappingURL=owner-activity-host.d.ts.map