---
id: memory-flow-plan
kind: implementation-plan
description: Connect memory roles to selective reads and verified reuse.
keywords: [memory, episodic, semantic, procedural, 기억, 회수]
use_when: Implementing or checking M1-M4 memory improvements.
position: Entry; two implementation chapters follow.
next: 2026-09-20-memory-flow-contract.md
---
# Memory flow implementation

Baseline: main `0772f7fc3`. Preserve unrelated research files.
Use existing authentication; no account/certificate binding or access expansion.
Roles and reading depth are separate. Do not load every role on every request.

## Delivery checklist

- [x] M1 code: memory/continuity observations with endpoint-specific receipts.
- [x] M1 code: optional task-aware routing, including no optional memory.
- [x] M1 targets: legacy reads, corrections, scope and output budgets preserved.
- [x] M1 delivery: synthetic regression and existing live checkpoint read recorded.
- [ ] M1 effect: actual subsequent session use and failure resolution.
- [ ] M2: local SQLite worker, paged candidates and inverse dependencies.
- [ ] M2: incremental revisions/permissions; no foreground full inventory scan.
- [ ] M2: 100k/1M logical-document measurements, units/chunks reported separately.
- [ ] M3: grounded derivative candidates through existing evolution owners.
- [ ] M3: apply/reread/rollback guards; no source or human-edit overwrite.
- [ ] M4: no-memory comparisons and confirmed-context-only reuse.
- [x] M1 engine: targets, build, one full regression and security/staging review.
- [x] M1 deployment: NAS runtime and live reads verified; rollback retained.
- [ ] M1 publication: existing-branch commit and confirmed fork push.

## Outcome evidence

Track implementation, deployment, delivery, reported use, linked result and effect
separately. A synthetic new session is not actual subsequent use.
Measure server work, returned context and actual model tokens separately.
Never infer model tokens from characters or account quota percentages.
Preserve fixed 80/100/180 evaluations; add 60 memory cases before tuning.
Target quality non-regression and 30% median cumulative input-token reduction.
Missing measurements remain unverified, not successful.
Last skill counts: metadata 186/1610 (11.55%); active 0/1610 (0.00%).
This plan does not reactivate quarantined skills.
