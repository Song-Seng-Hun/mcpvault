import type { ScopePrincipal } from './scope-auth.js';
import type { AgentTaskService } from './agent-tasks.js';
import type { ContinuityService } from './continuity.js';
import type { LlmWikiService } from './llm-wiki.js';
import type { WorkService } from './work-service.js';
/**
 * Produces one bounded, actionable pulse without adding a second
 * index or history database. The caller still decides whether to act.
 */
interface RetainedOwnerBoundary {
    revalidate(): Promise<void>;
    assertFresh(): void;
}
export declare class AgentPulseService {
    private readonly tasks;
    private readonly continuity;
    private readonly llmWiki?;
    private readonly work?;
    private readonly skills?;
    private readonly ownerActivity?;
    private readonly inFlight;
    private readonly idleWikiPlanCache;
    constructor(tasks: AgentTaskService | undefined, continuity: ContinuityService, llmWiki?: LlmWikiService | undefined, work?: Pick<WorkService, 'pulse'> | undefined, skills?: {
        nextAction(params: {
            principal: ScopePrincipal;
            skillId: string;
        }): Promise<{
            endpointId: string;
            arguments: Record<string, unknown>;
        } | undefined>;
    } | undefined, ownerActivity?: ((activity: 'skill-evolution', principal: ScopePrincipal) => Promise<{
        run<T>(reader: () => Promise<T>): Promise<T>;
        revalidate(): Promise<void>;
        assertFresh(): void;
    } | undefined>) | undefined);
    get(params: {
        principal?: ScopePrincipal;
        limit?: number;
        maxChars?: number;
        hostBusy?: boolean;
        skillId?: string;
    }, retainOwnerValidator?: (validator: RetainedOwnerBoundary) => void): Promise<Record<string, unknown>>;
    private idleWikiPlanCacheKey;
    private rememberIdleWikiPlan;
    private idleWikiPlanFor;
    private getUncached;
}
export {};
//# sourceMappingURL=agent-pulse.d.ts.map