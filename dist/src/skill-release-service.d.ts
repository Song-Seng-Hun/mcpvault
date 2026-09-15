import { type ReviewedSkillHost, type ReviewedSkillDeliveryFence } from './skill-release-reader.js';
import type { SkillSourceInspection } from './skill-release-source.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import type { OwnerActivityRuntime } from './owner-activity-runtime.js';
export interface ReviewedSkillInspector {
    inspect(sourceName: string): Promise<SkillSourceInspection | null>;
}
/** Shared read service. Original PathFilter quarantine remains untouched.
 * Raw bytes are inspected only by the host-owned verifier, never returned here. */
export declare class ReviewedSkillService {
    private readonly host;
    private readonly source;
    private readonly access;
    private readonly auth;
    private readonly owner;
    private readonly options;
    constructor(host: ReviewedSkillHost, source: ReviewedSkillInspector, access: ScopeAccessPolicy, auth: ScopeAuthService, owner: OwnerActivityRuntime, options?: {
        assertActor?: (p: ScopePrincipal) => Promise<void>;
        refreshAccess?: () => Promise<void>;
    });
    resolve(p: Record<string, any>, captureDeliveryFence?: (fence: ReviewedSkillDeliveryFence) => void): Promise<Record<string, any>>;
    discover(p: Record<string, any>, captureDeliveryFence?: (fence: ReviewedSkillDeliveryFence) => void): Promise<import("./skill-release-discovery.js").ReviewedProcedureDiscovery>;
    private identity;
    private read;
}
//# sourceMappingURL=skill-release-service.d.ts.map