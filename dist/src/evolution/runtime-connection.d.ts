import type { ScopeAuthService } from '../scope-auth.js';
import type { ScopeAccessPolicy } from '../scope-access.js';
import type { FileSystemService } from '../filesystem.js';
import type { ModerationService } from '../moderation.js';
import type { HostWorkStorage } from '../host-work-storage.js';
import type { EvolutionAdapter, EvolutionConfig, EvolutionOptions } from './model.js';
import { EvolutionService } from './service.js';
import { type EvaluationProfile } from './evaluator.js';
import { type OutcomeCheck } from './runtime-evidence.js';
import { type FeedbackProof, type TargetKind } from './policy.js';
import { EvolutionBudget } from './budget.js';
import { EvolutionOperations } from './operations.js';
import type { RetrievalService } from '../retrieval-service.js';
import { EvolutionDirectReview } from './direct-review.js';
import type { CompilationService } from '../compilation-service.js';
import type { LlmWikiService } from '../llm-wiki.js';
export interface EvolutionRuntimeConfig {
    storage: HostWorkStorage<EvolutionConfig>;
    /** Reviewed code-owned checks only; no remote code or MCP-defined grading. */
    profiles?: readonly EvaluationProfile[];
}
interface Services {
    auth: ScopeAuthService;
    access: ScopeAccessPolicy;
    fs: FileSystemService;
    moderation: ModerationService;
    refreshPolicy(): Promise<void>;
    readOnly: boolean;
    retrieval: RetrievalService;
    compilation?: CompilationService;
    wiki?: LlmWikiService;
    adapters?: Partial<Record<TargetKind, EvolutionAdapter>>;
}
/** Concrete existing-account connection. No registration, certificate binding or owner inference. */
export declare function connectEvolutionRuntime(config: EvolutionRuntimeConfig, services: Services): {
    service: EvolutionService;
    options: EvolutionOptions;
    host: Readonly<{
        /** Only the host transport may attest a verified human message. Not an MCP endpoint. */
        captureFeedback: (token: string, raw: unknown, origin: FeedbackProof['origin'], eventId: string) => Promise<string>;
        deliverContext: (token: string, args: Record<string, unknown>) => Promise<{
            packet: any;
            receipts: {
                cycleId: string;
                token: string;
            }[];
            retention: 'unknown';
        }>;
        verifyUse: (token: string, receipt: string, check: OutcomeCheck) => Promise<string>;
        recordForegroundUsage: (token: string, eventId: string, tokens: number) => Promise<void>;
        runTask: <T>(token: string, args: Record<string, unknown>, operation: () => Promise<T>, observe?: (selected: {
            cycleId: string;
            revision: string;
        } | undefined) => void) => Promise<T>;
    }>;
    budget: EvolutionBudget;
    operations: EvolutionOperations;
    review: EvolutionDirectReview;
    close: () => Promise<void>;
};
export type EvolutionRuntimeHost = ReturnType<typeof connectEvolutionRuntime>['host'];
export {};
//# sourceMappingURL=runtime-connection.d.ts.map