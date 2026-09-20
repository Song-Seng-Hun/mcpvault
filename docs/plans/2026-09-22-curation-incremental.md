---
id: curation-incremental-connection
kind: implementation-record
description: Incremental candidate discovery, observed usage and bounded owner-service execution.
keywords: [curation, candidates, usage, SQLite, incremental, 정리 후보]
use_when: Completing the approved C3 operational connection; not evidence of live changes.
position: C3 work after reference-index deployment.
parent: 2026-09-20-curation.md
previous: 2026-09-22-curation-refresh.md
---
# Incremental curation (증분 정리)

Baseline: main 6157b72a2. Existing account, branch and owner services only.
Reuse the memory SQLite worker for private candidate read models.
Keep durable execution and observations in the existing evolution host records.

## Discovery and authority

- Index exact repeated relations and exact-body groups during existing document updates.
- Page by indexed keys; do not compare every document pair or load whole metadata maps.
- Same bytes are a candidate, not equal meaning, managed ownership or merge permission.
- Recheck both documents, current ACL, source revisions and generation before disclosure.
- Never expose hidden group members, counts or raw cursor paths.
- Changes and reconciliation refresh only affected read-model entries and groups.
- Cache loss requires reconstruction, not invented usage history or approval.

## Usage and execution connection

- Distinguish server delivery, reported use, verified outcome and observation coverage.
- Unknown or intermittent coverage cannot prove 90 days of disuse.
- Age, retrieval count and authored managed labels never authorize retirement.
- Bounded execution uses existing exact curation grants, receipts and change-set guards.
- One bundle per opportunity; no new scheduler, model or execution permission.
- Stable requests and durable receipts prevent replay after response loss or restart.
- Recheck unexpected outputs; never overwrite manual changes or reset damaged history.
- Existing manual preview/apply/revert remains available; actual effect requires next use.
- `evolution.cycle(kind=curation,op=list)` returns bounded current candidate cards.
- Exact grants plus managed receipts expose an `advance` validation action, not approval.
- `advance` reuses prepare, preview, apply and reread; uncertain writes require reconcile.
- Read-only and ungranted users receive read/review actions, never implicit execution.
- Actual observed body reads feed a per-account, per-document last-result index.
- Revision, time and hashed identity are retained; no body, transcript or raw path.
- Missing cache/history means unknown. Result delivery is not retained context or use.
- Duplicate event delivery does not count again; older events cannot replace newer facts.
- Canonical host completion precedes advisory indexing; cache faults never rerun reads.
- Discovery and delivery indexes are disposable; cache loss cannot authorize retirement.

## Evidence pending

See [review](2026-09-22-curation-discovery-review.md) for verification and open limits.
