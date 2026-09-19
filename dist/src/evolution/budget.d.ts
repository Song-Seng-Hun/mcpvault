import type { HostWorkStorage } from '../host-work-storage.js';
import type { EvolutionConfig } from './model.js';
/** Per-account/per-host-storage ledger. Evolution is never part of its own denominator.
 * Only trusted host usage counters call this API; model text is not metering.
 * Preserve unknown/in-flight charges across restarts, including after the 24h window.
 */
export declare class EvolutionBudget {
    private readonly storage;
    private readonly authorize;
    private readonly now;
    private tail;
    constructor(storage: HostWorkStorage<EvolutionConfig>, authorize: (accountId: string) => Promise<void>, now?: () => number);
    private transact;
    recordForeground(account: string, eventId: string, tokens: number): Promise<undefined>;
    reserve(account: string, requestId: string, maximumTokens: number): Promise<undefined>;
    settle(account: string, requestId: string, tokens: number | undefined): Promise<undefined>;
}
//# sourceMappingURL=budget.d.ts.map