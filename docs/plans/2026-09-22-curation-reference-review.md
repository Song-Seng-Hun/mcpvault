---
id: curation-reference-index-review
kind: review-record
description: Solo source review and evidence limits for indexed retirement checks.
keywords: [curation, review, reference integrity, security, 검토]
use_when: Interpreting the reference-index release and remaining C1-C3 requirements.
position: Review supplement to the private reference-index chapter.
parent: 2026-09-22-curation-reference-index.md
previous: 2026-09-22-curation-reference-index.md
next: 2026-09-20-curation-contract.md
---
# Review scope

Main-agent review; no independent reviewer or model evaluation claimed.
Base 89bdae3a2; current source/build basis is pinned in the full-run receipt.
Read extraction, SQLite transactions, background state, filesystem resolution,
catalog events, server wiring and curation writer guards; compare the plan.

## Checked boundaries

- Separate integrity postings include snapshots omitted from navigational edges.
- Private keys/revisions do not enter public search or memory candidates.
- Explicit host cache configuration does not grant account or mutation authority.
- Existing filesystem and protected-document checks remain before/after reads.
- Candidate limits, unreadable scopes and extraction overflow fail incomplete.
- Restart requires a fresh full scan; failed scans cannot sweep existing rows.
- Failed refreshes cannot be hidden by a subsequent successful event.
- Raw watcher fences include discovery-excluded guidance and lost watchers.
- Read current candidate bytes with existing link and Property semantics.
- Target-only resolution conservatively over-selects possible collisions.
- An issued preview's fence is held in a WeakMap, not in client JSON.
- Curation passes that fence to the writer's final synchronous dispatch guard.
- Existing managed receipts, exact grants and revision-safe rollback still apply.

## Evidence and limitations

Target suite: 8 files / 131 tests passed; build passed; UML contract valid.
Tests use real SQLite and isolated filesystem services. Attack/race fixtures
include a new reference after async authorization, which prevents the write.
Actual NAS curation and next-use effects remain unverified; do not infer them.
Deployed runtime passes normal-account reads; later status-only probes observed ready.
Full same-source run: 563 files; 7,408 passed, 4 skipped, zero failed.
Unknown filesystem events force background reconciliation, not a full request scan.
Conservative collisions/overflow may require review; they do not authorize deletion.
This fence covers observed changes, not atomic NAS transactions or direct-write
protection. Watcher loss disables indexed integrity; no unrestricted fallback.
Synthetic integrity ingestion/query measurements are separate from NAS operation.
Retrieved quality, semantic merge/split coverage and real next-use outcomes remain
separate acceptance requirements. Prior graph benchmarks do not discharge them.
