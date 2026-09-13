---
id: context-chapter-candidates
kind: implementation-record
description: P1d private chapter plans and candidates; no public cutover or semantic pass.
keywords: [chapters, candidates, source ranges, revision, 복구]
parent: README.md
previous: 12-expression-profile.md
next: 14-next-gates.md
---
# Chapter candidates — P1d

Use after original preservation. No model invocation or Vault body writes.

## Plan and context

- Read a paged plan from the preserved original and current admission basis.
- Bind chapter IDs to document identity and unambiguous source content, not order.
- Give repeated/ambiguous units new bundle-scoped identities; never guess a merge.
- Pin plan revision, compiler rule, ranges and derived navigation server-side.
- Submit one candidate per chapter through the existing compilation endpoint.
- Persist private plan/request restrictions before candidate bodies; reread both.
- Keep candidates outside the Vault and normal search until trusted cutover exists.
- Preserve the v1 original/manifest format; use separate bounded record types.
- Reject source_only generation, stale bases, revoked access and unrecognized fields.
- Equal requests are idempotent; changed candidate bytes require review, not overwrite.
- Render at most50physical lines. Literal/semantic acceptance remains separate.

## Required checks

- [x] RED tests for absent plans/candidates and unsafe replacement.
- [x] Stable IDs, exact range coverage, duplicate content, fences and Unicode.
- [x] Private persistence, restart, request binding, source/authority drift.
- [x] Read-only operation checks and bounded whole-JSON continuation.
- [x] Targets/build/solo review; full500files:6933passed,4skipped,0failed.
- [x] NAS deployment/live verification; [fork delivery evidence](16-candidate-delivery.md).

## Boundaries and decisions

Plan cards are discovery data, not executable rules or verified English prose.
No candidate is truth, publication approval, or a completed document conversion.
No same-label identity merge or source-family count inflation is allowed.
The original read route remains separate from candidate text and revision.
Connected MCP remains anonymous; a separate [operating account](15-operating-account.md) is verified.
Use its host credential, never a guessed admin or client-claimed permission.
Real storage exposed callback reentry deadlock; guards no longer read their own queue.
The same integration then completed in9s; its30s limit is retained.
Targets11files/192tests and build passed; final1 stopped at a10s native setup hook.
Unchanged semantic-reuse27tests and the same20files/261tests then passed.
The intermittent setup cause is unconfirmed; no assertion or timeout was weakened.
Final2 resumed after the1.975GiB guard stop; semantic-reuse27tests passed at batch281.
