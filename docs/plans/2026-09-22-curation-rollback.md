---
id: curation-rollback-continuation
kind: implementation-record
description: Direction-bound partial rollback with persisted retry budgets and unchanged authority.
keywords: [curation, rollback, restart, revision, 복구]
use_when: Recovering a journaled partial merge or reviewing rollback admission.
position: Recovery follow-up to incremental discovery; not whole-plan completion.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-retirement.md
next: 2026-09-22-curation-discovery-review.md
---
# Partial rollback (부분 복구)

Baseline: main ee5ca35a8. Existing evolution journal and guarded change-set writer. No account, grant, certificate, model, scheduler or live document is created.

## Contract

- Forward order: publish canonical, then supersede source.
- Rollback order: restore source, then restore canonical.
- Both partial orders yield source-before/canonical-after; durable state determines direction.
- Reconcile rereads both documents. A known reverse prefix becomes revert_resumable.
- Revert writes only the remaining canonical and revision-guards the restored source.
- Apply cannot consume reverse continuation. Advance cannot turn rollback into new application.
- Current account, exact grants, managed receipts and both revisions are rechecked.
- A third revision, unknown order, changed authority or guard race stops writes.
- A lost final receipt reconciles to withdrawn without another physical write.
- Independent rollbackAttempts is persisted before writes; maximum three across restarts.
- Legacy records without a count remain readable; no fresh retry budget is inferred.
- Only legacy prepared records with zero forward attempts can establish a zero rollback count.
- Exhausted or unknown budgets require review, not automatic reset.
- Snapshots remain private; public responses expose remaining attempts, not original bytes.

## Validation

Pre-fix: a known rollback prefix returned review_required; fourth rollback and corrupt/unknown counters allowed writes.
After correction, 8 target files / 95 tests pass; npm run build passes.
Coverage includes one-write continuation, exact bytes, replay, restart and manual edits.
Grant revocation, authority loss, concurrent restored-source edits and wrong direction are tested.
Fixtures use real temporary filesystem/change-set services and synthetic crash prefixes.
Solo review used the review checklist; no independent reviewer or live crash test claimed.
Integrated coverage: 566 files / 7,457 pass / 4 allowed skips; reviewed doc-only correction kept older receipts distinct.
Feature-diet NAS release and authenticated read probe pass; source/roleplay/economy bytes unchanged. Git records publication.

## Completion boundary

Actual NAS curation applications and next-use effects remain zero at this checkpoint.
Current live discovery found no eligible candidates; compilation lacks managed-output policy.
No user document is silently adopted as managed or rewritten to fabricate a test result.
Other semantic curation, usage coverage and next-use evaluation remain open.
Skills: last metadata 186/1610 (11.55%); active 0/1610 (0%); not recounted.
