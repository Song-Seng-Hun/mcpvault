/** Pure, data-only optional-activity consent. Host integration supplies trusted
 * human-owner configuration, authenticated account/target identity and time.
 * This module cannot prove that a human approved a grant or verify a runtime.
 * Preferences (including model family), feature flags, account capabilities,
 * room membership and locality labels are never sources of owner consent.
 */
export type Activity = 'collaboration' | 'ideation-research' | 'explanation-translation' | 'benchmarks' | 'economy' | 'roleplay' | 'skill-evolution';
export type OwnerActivityAction = 'discover' | 'read' | 'claim' | 'execute';
export type OwnerActivityReason = 'granted' | 'owner_unknown' | 'consent_required' | 'expired' | 'revoked' | 'execution_target_mismatch' | 'data_scope_mismatch';
export interface OwnerActivityGrant {
    id: string;
    ownerId: string;
    accountIds: string[];
    activities: Activity[];
    actions: OwnerActivityAction[];
    /** Nonempty canonical, case-sensitive relative prefixes. '.' explicitly
     * consents to all paths, but does not grant document access permissions. */
    dataPrefixes: string[];
    executionTargets: string[];
    expiresAt: string;
    revoked?: boolean;
}
export interface OwnerActivityConfig {
    version: 1;
    owners: Record<string, string>;
    grants: OwnerActivityGrant[];
}
export interface OwnerActivityRequest {
    accountId: string;
    executionTarget: string;
    activity: Activity;
    action: OwnerActivityAction;
    /** Omission is allowed ONLY for discover activity eligibility. That result
     * does not authorize enumerating or reading unrestricted candidate data.
     * Before each candidate is exposed/read, the host MUST call decision with
     * its canonical path and apply the independent document access predicate.
     * [] explicitly represents an operation with no document paths (metadata
     * only), never a way to authorize a body read. Every real body read MUST
     * supply its path. Include every touched path in one operation; do not split
     * a multi-path operation to combine grants. Maximum 32 supplied paths. */
    paths?: readonly string[];
    /** Trusted host epoch milliseconds. Missing/invalid time fails closed;
     * there is no ambient clock. Recheck immediately before execution. */
    now?: number;
}
export interface OwnerActivityDecision {
    allowed: boolean;
    reason: OwnerActivityReason;
    grantId?: string;
    permissionsGranted: false;
}
/** Immutable snapshot of validated host policy. The host must replace this
 * instance after revocation/config changes and use the CURRENT instance for
 * discovery, candidate reads, claim and execution. A previous decision is not
 * a reusable authorization token. This is only an additional consent gate;
 * normal document ACLs, PathFilter and execution verification still apply.
 * Main work/personal memory classification is the host's responsibility.
 */
export declare class OwnerActivityPolicy {
    #private;
    readonly fingerprint: string;
    constructor(input: unknown);
    /** Directory-walk hint for one host-selected grant. This never authorizes
     * the directory, a child, body, output or action. Exact children must still
     * pass decision() with the same grant selected by the runtime. */
    canTraverse(grantId: string, directoryPath: string): boolean;
    /** Opaque generation of every currently usable grant for one catalog
     * activity/action. IDs and expiries never leave the trusted host boundary. */
    availabilityGeneration(request: Omit<OwnerActivityRequest, 'paths'>): string;
    /** After request validation, bounded grant stages are activity/action, target,
     * paths, revocation and expiry. A valid alternative wins; no other account's
     * grants are diagnosed.
     * The returned grantId identifies only the single successful whole grant. */
    decision(request: OwnerActivityRequest): OwnerActivityDecision;
}
//# sourceMappingURL=owner-activity.d.ts.map