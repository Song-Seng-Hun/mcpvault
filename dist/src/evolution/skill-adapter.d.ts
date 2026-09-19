import type { SkillEvolutionService } from '../skill-evolution.js';
import type { ReviewedSkillService } from '../skill-release-service.js';
import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionAdapter, Cycle } from './model.js';
export interface PreparedSkillDelivery {
    releaseRevision: string;
    contentHash: string;
    bindingHash: string;
}
/** Host-only bridge to existing reviewed admission. No automatic review, privileges or quarantine bypass. */
export interface SkillEvolutionDelivery {
    read(skillId: string, principal: ScopePrincipal): Promise<{
        releaseRevision: string;
        contentHash: string;
    }>;
    prepare(cycle: Readonly<Cycle>, contentHash: string, principal: ScopePrincipal): Promise<PreparedSkillDelivery>;
    apply(prepared: Readonly<PreparedSkillDelivery>, cycle: Readonly<Cycle>, principal: ScopePrincipal): Promise<void>;
}
type Credentials = (principal: ScopePrincipal) => Promise<{
    accessToken: string;
}>;
/** Exact currently reviewed procedure read, never legacy resolve's original fallback. */
export declare function reviewedDeliveryReader(service: ReviewedSkillService, credentials: Credentials): SkillEvolutionDelivery['read'];
export declare function skillEvolutionAdapter(service: SkillEvolutionService, credentials: Credentials, delivery: SkillEvolutionDelivery): EvolutionAdapter;
export {};
//# sourceMappingURL=skill-adapter.d.ts.map