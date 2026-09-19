import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionService } from './service.js';
interface Progress {
    status: string;
    attempts?: number;
    revision?: string;
    [key: string]: unknown;
}
export interface EvolutionSession {
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
    private busy;
    run(request: {
        cycleId: string;
        newEvidence: boolean;
        planMode?: boolean;
        signal?: AbortSignal;
    }, session?: EvolutionSession): Promise<Progress>;
}
export declare function evolutionSessionBridge(service: EvolutionService, principal: ScopePrincipal, host: Pick<EvolutionSession, 'authorize' | 'generate'>): EvolutionSession;
export {};
//# sourceMappingURL=opportunity.d.ts.map