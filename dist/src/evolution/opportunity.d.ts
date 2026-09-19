import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionService } from './service.js';
import type { EvolutionBudget } from './budget.js';
interface Progress {
    status: string;
    attempts?: number;
    revision?: string;
    [key: string]: unknown;
}
export interface EvolutionSession {
    /** Host-verified cumulative input+output usage, including every evaluator and failed call.
     * maximumTokens must also be enforced by the host's model caller. */
    metering?: {
        maximumTokens: number;
        totalTokens(): Promise<number | undefined>;
    };
    /** Trusted host code attests the existing approved session; client parameters cannot construct this callback. */
    authorize(signal: AbortSignal): Promise<void>;
    current(cycleId: string, signal: AbortSignal): Promise<Progress>;
    generate(progress: Readonly<Progress>, signal: AbortSignal): Promise<{
        candidate: Record<string, unknown>;
    }>;
    evaluate(cycleId: string, progress: Progress, candidate: Record<string, unknown>, signal: AbortSignal): Promise<Progress>;
    apply(cycleId: string, progress: Progress, signal: AbortSignal): Promise<Progress>;
}
/** No timer schedules new work. This bounds one explicitly supplied existing-session opportunity. */
export declare class EvolutionOpportunity {
    private readonly budget?;
    private busy;
    constructor(budget?: EvolutionBudget | undefined);
    run(request: {
        cycleId: string;
        newEvidence: boolean;
        planMode?: boolean;
        signal?: AbortSignal;
        explicit?: boolean;
    }, session?: EvolutionSession, accountId?: string): Promise<Progress>;
}
export declare function evolutionSessionBridge(service: EvolutionService, principal: ScopePrincipal, host: Pick<EvolutionSession, 'authorize' | 'generate' | 'metering'>): EvolutionSession;
export {};
//# sourceMappingURL=opportunity.d.ts.map