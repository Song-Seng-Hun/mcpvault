import type { ScopePrincipal } from './scope-auth.js';
import type { NotificationService } from './notifications.js';
import type { SocialService } from './social.js';
import type { ChatService } from './chat.js';
import type { AgentTaskService } from './agent-tasks.js';
import type { ContinuityService } from './continuity.js';
import type { ReputationService } from './reputation.js';
import type { LlmWikiService } from './llm-wiki.js';
import type { IdeationService } from './ideation.js';
import type { WorkService } from './work-service.js';
import type { CommunityParticipationService } from './community-participation.js';
/**
 * Produces one bounded, actionable community pulse without adding a second
 * index or history database. The caller still decides whether to act.
 */
interface RetainedOwnerBoundary {
    revalidate(): Promise<void>;
    assertFresh(): void;
}
export declare class AgentPulseService {
    private readonly notifications;
    private readonly social;
    private readonly chat;
    private readonly tasks;
    private readonly continuity;
    private readonly reputation;
    private readonly llmWiki?;
    private readonly ideation?;
    private readonly work?;
    private readonly participation?;
    private readonly skills?;
    private readonly engagement?;
    private readonly ownerActivity?;
    private readonly inFlight;
    private readonly idleWikiPlanCache;
    constructor(notifications: NotificationService | undefined, social: SocialService | undefined, chat: ChatService | undefined, tasks: AgentTaskService | undefined, continuity: ContinuityService, reputation: ReputationService | undefined, llmWiki?: LlmWikiService | undefined, ideation?: IdeationService | undefined, work?: Pick<WorkService, 'pulse'> | undefined, participation?: Pick<CommunityParticipationService, 'pulse'> | undefined, skills?: {
        nextAction(params: {
            principal: ScopePrincipal;
            skillId: string;
        }): Promise<{
            endpointId: string;
            arguments: Record<string, unknown>;
        } | undefined>;
    } | undefined, engagement?: {
        explanation?: (principal: ScopePrincipal) => Promise<{
            endpointId: string;
            arguments: Record<string, unknown>;
            reason: string;
        } | undefined>;
        benchmark?: (principal: ScopePrincipal) => Promise<{
            endpointId: string;
            arguments: Record<string, unknown>;
            reason: string;
        } | undefined>;
    } | undefined, ownerActivity?: ((activity: 'collaboration' | 'ideation-research' | 'explanation-translation' | 'benchmarks' | 'skill-evolution', principal: ScopePrincipal) => Promise<{
        run<T>(reader: () => Promise<T>): Promise<T>;
        revalidate(): Promise<void>;
        assertFresh(): void;
    } | undefined>) | undefined);
    get(params: {
        principal?: ScopePrincipal;
        limit?: number;
        maxChars?: number;
        purpose?: 'work' | 'community';
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