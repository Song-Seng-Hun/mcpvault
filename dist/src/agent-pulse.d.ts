import type { ScopePrincipal } from './scope-auth.js';
import type { NotificationService } from './notifications.js';
import type { SocialService } from './social.js';
import type { ChatService } from './chat.js';
import type { AgentTaskService } from './agent-tasks.js';
import type { ContinuityService } from './continuity.js';
import type { ReputationService } from './reputation.js';
import type { LlmWikiService } from './llm-wiki.js';
import type { IdeationService } from './ideation.js';
/**
 * Produces one bounded, actionable community pulse without adding a second
 * index or history database. The caller still decides whether to act.
 */
export declare class AgentPulseService {
    private readonly notifications;
    private readonly social;
    private readonly chat;
    private readonly tasks;
    private readonly continuity;
    private readonly reputation;
    private readonly llmWiki?;
    private readonly ideation?;
    private readonly inFlight;
    private readonly idleWikiPlanCache;
    constructor(notifications: NotificationService, social: SocialService, chat: ChatService, tasks: AgentTaskService, continuity: ContinuityService, reputation: ReputationService, llmWiki?: LlmWikiService | undefined, ideation?: IdeationService | undefined);
    get(params: {
        principal?: ScopePrincipal;
        limit?: number;
        maxChars?: number;
    }): Promise<Record<string, unknown>>;
    private idleWikiPlanCacheKey;
    private rememberIdleWikiPlan;
    private idleWikiPlanFor;
    private getUncached;
}
//# sourceMappingURL=agent-pulse.d.ts.map