import type { WorkExecutionProfile } from './work-staffing.js';
import { explanationProfileFingerprint, verifiedExplanationProfile } from './explanation-model.js';

/** Shared state eligibility only. WIP, recommendation ordering, family preference
 * and explicit-read policy remain at their distinct service call sites. */
export function explanationEligibility(record: { status: string; author: string; authorProfileFingerprint?: string } | undefined,
  approved: boolean, accountId: string | undefined, profiles: WorkExecutionProfile[]) {
  const status = record?.status === 'approved' && !approved ? 'review_required' : record?.status ?? 'queued';
  const own = accountId ? verifiedExplanationProfile(profiles, accountId) : undefined;
  const author = record ? verifiedExplanationProfile(profiles, record.author) : undefined;
  const basis = Boolean(record?.authorProfileFingerprint && record.authorProfileFingerprint === explanationProfileFingerprint(profiles, record.author));
  const isAuthor = Boolean(own && record?.author === accountId);
  return {
    status, claim: Boolean(own && !approved && ['queued', 'released'].includes(status)),
    draft: Boolean(isAuthor && !approved && (['claimed', 'changes_requested', 'review_required'].includes(status) || status === 'draft' && !basis)),
    review: Boolean(own && author && !isAuthor && !approved && basis && own.family !== author.family && ['draft', 'changes_requested', 'review_required'].includes(status)),
    continuing: Boolean(isAuthor && ['claimed', 'draft', 'changes_requested', 'review_required'].includes(status)),
    waiting: Boolean(isAuthor && status === 'draft' && basis),
  };
}
