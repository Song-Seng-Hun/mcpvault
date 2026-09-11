import type { WorkExecutionProfile } from './work-staffing.js';
/** Shared state eligibility only. WIP, recommendation ordering, family preference
 * and explicit-read policy remain at their distinct service call sites. */
export declare function explanationEligibility(record: {
    status: string;
    author: string;
    authorProfileFingerprint?: string;
} | undefined, approved: boolean, accountId: string | undefined, profiles: WorkExecutionProfile[]): {
    status: string;
    claim: boolean;
    draft: boolean;
    review: boolean;
    continuing: boolean;
    waiting: boolean;
};
//# sourceMappingURL=explanation-eligibility.d.ts.map