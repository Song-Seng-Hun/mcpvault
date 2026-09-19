import type { ScopePrincipal } from '../scope-auth.js';
import type { HostWorkStorage } from '../host-work-storage.js';
import type { Cycle, EvolutionConfig } from './model.js';
import { type FeedbackProof } from './policy.js';
import { type HarnessProfile } from './harness.js';
export interface DeliveryObservation {
    taskId: string;
    sessionId: string;
    cycleId: string;
    revision: string;
    representationHash: string;
    basis: string;
}
export interface OutcomeCheck {
    method: 'static' | 'synthetic' | 'agent_behavior' | 'operational';
    checkId: string;
    /** Code-owned observer. Never deserialize a checker or a success flag from MCP/Vault data. */
    evaluate(observation: Readonly<DeliveryObservation>): Promise<{
        used: boolean;
        success: boolean;
        resultHash: string;
    }>;
}
export interface PinnedHarness {
    cycleId: string;
    revision: string;
    profile: HarnessProfile;
}
export interface RuntimeEvidenceOptions {
    storage: HostWorkStorage<EvolutionConfig>;
    authorize(principal: ScopePrincipal): Promise<string>;
    now?: () => number;
}
/** Host-only capture surface; MCP only consumes opaque, byte-bound receipts.
 * Records contain identities/hashes and typed verdicts, never tool bodies or credentials.
 * A delivery receipt is NOT an acknowledgement of retention, understanding or success.
 */
export declare class EvolutionRuntimeEvidence {
    private readonly options;
    private tail;
    constructor(options: RuntimeEvidenceOptions);
    private current;
    private key;
    private read;
    private save;
    private serial;
    pinHarness(p: ScopePrincipal, context: Record<string, unknown>, harness?: PinnedHarness): Promise<PinnedHarness | undefined>;
    captureFeedback(p: ScopePrincipal, input: unknown, origin: FeedbackProof['origin'], eventId: string): Promise<string>;
    attest(token: string, p: ScopePrincipal, raw: unknown): Promise<FeedbackProof | undefined>;
    captureDelivery(p: ScopePrincipal, input: DeliveryObservation): Promise<string>;
    verifyUse(deliveryToken: string, p: ScopePrincipal, check: OutcomeCheck): Promise<string>;
    proveUse(token: string, cycle: Readonly<Cycle>, p: ScopePrincipal): Promise<Cycle['effect']>;
}
//# sourceMappingURL=runtime-evidence.d.ts.map