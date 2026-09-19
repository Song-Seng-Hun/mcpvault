import type { RetrievalService } from '../retrieval-service.js';
import type { ScopeAccessPolicy } from '../scope-access.js';
import type { EvaluationProfile } from './evaluator.js';
/** First operational profiles measure real retrieval, but cannot auto-adopt on server-only savings. */
export declare function builtinEvolutionProfiles(retrieval: RetrievalService, access: ScopeAccessPolicy): EvaluationProfile[];
//# sourceMappingURL=builtin-profiles.d.ts.map