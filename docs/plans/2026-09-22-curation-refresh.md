---
id: curation-reference-refresh
kind: execution-record
description: Reconciliation coalescing and exact missing-file handling for reference integrity.
keywords: [curation, reference index, reconciliation, deletion event, 색인 갱신]
use_when: Diagnosing prolonged preparation or resuming reference-index retirement checks.
position: Operational correction after initial indexed deployment; not C1-C3 completion.
parent: 2026-09-20-curation.md
previous: 2026-09-22-curation-reference-index.md
next: 2026-09-22-curation-reference-measurement.md
---
# Reference refresh (참조 갱신)

Baseline c677d6b68. Prior release passed local tests but live readiness was unproven.
Live diagnostics repeatedly returned preparing; a 15-second NAS watch saw no events.
Do not infer that the NAS is empty, that the index is ready or that curation ran.
Later, a status-only authenticated session observed ready four times, 20 seconds apart.
The prior runtime was not permanently stuck; complete impact coverage remains separate.

## Reproduced defects and correction

- A periodic catalog census requested another full reference census during an active one.
- Deterministic real-filesystem/SQLite reproduction read the unchanged corpus four times.
- Periodic nudges now join an ongoing whole census instead of rescheduling it.
- Actual file/policy invalidation still fences captures and queues required work.
- Reads remain unavailable during an incomplete census; no stale-result fallback.
- Periodic reconciliation while idle still starts a fresh census.
- A normal missing-file read wraps ENOENT in Error.cause; incremental removal missed it.
- Removal now accepts that exact cause only, after current root/access confirmation.
- A delete hint for an existing document retains its reference postings.
- Disconnection and permission failures are not interpreted as deletion.

## Verification boundary

Failing reproductions were observed before fixes; source changes remain narrowly scoped.
Tests cover periodic nudges, explicit invalidation, incremental removal and NAS loss.
The periodic reproduction proves a scheduling defect, not its sole causality on NAS.
No schema migration, watcher, scheduler, principal, execution grant or binding added.
Solo source review; no independent reviewer/model evaluation claimed.
No original, user knowledge, world or economy data changed by these source edits.
Targets: 8 files / 134 passed; build passed. No source edits during the full run.
Full: 563 files; 7,411 passed, 4 platform-limited skips, zero failed; basis 844d10ea.
Release 20260922-curation-refresh-final deployed; existing-account read diagnostics pass.
Original/world/economy bytes and checkpoints preserved; prior runtime retained for rollback.
Eight authenticated status-only polls remained preparing; new-runtime ready is unverified.
Compilation host policy remains unconfigured; no execution grant or binding added.
Actual NAS curation applied / restored / next-use effects remain 0 / 0 / 0.
