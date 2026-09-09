import type { ResearchParams, ResearchRound } from './independent-research.js';
/** Field projections preserve exact text and source identity without making a
 * legal maximum-size submission impossible to read through the response cap. */
export declare function projectResearch(r: ResearchRound, revision: string, accountId: string, p: ResearchParams): {
    result: import("./work-model.js").WorkPage;
    selected: unknown[];
};
//# sourceMappingURL=independent-research-projection.d.ts.map