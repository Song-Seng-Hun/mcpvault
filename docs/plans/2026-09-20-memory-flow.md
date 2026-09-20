---
id: memory-flow-plan
kind: implementation-plan
description: Connect memory roles to selective reads and verified reuse.
keywords: [memory, episodic, semantic, procedural, 기억, 회수]
use_when: Implementing or checking M1-M4 memory improvements.
position: Entry to contract, storage, grounding, retention and evidence chapters.
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
- [x] M2 code: local SQLite worker, paged candidates and inverse dependencies.
- [x] M2 code: incremental revisions/permissions; no foreground full inventory scan.
- [x] M2 scale: 100k/1M synthetic SQLite runs; not full NAS/ANN certification.
- [x] M3 code: grounded worksheet connected to existing compilation/evolution owners.
- [x] M3 code: managed apply/reread/rollback guards; no original or user-edit overwrite.
- [x] M4 code: no-memory route and confirmed-context-only reuse; behavioral comparison pending.
- [x] M1 historical publication: `be9673168` on the confirmed fork's existing main.
- [x] M2-M4 engine: build, same-source regression coverage and solo security review.
- [x] M2-M4 deployment: NAS reads, update/logout recall, continuity pins; rollback kept.
- [ ] Acceptance: live latency, corpus/model quality, retained host and later-session effect.

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

Chapters: [five layers](2026-09-20-memory-layers.md), [storage](2026-09-20-memory-storage.md),
[grounding](2026-09-20-memory-grounding.md),
[retention](2026-09-20-memory-retention.md),
[current evidence](2026-09-20-memory-completion-evidence.md),
[scale evidence](2026-09-20-memory-scale-evidence.md).
