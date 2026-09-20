---
id: curation-retirement-guide
kind: procedure
description: Duplicate archive and lossless passage union with exact ownership and recovery guards.
keywords: [archive_duplicate, merge_duplicates, merge_passages, rollback, 보관]
use_when: Consolidating managed derivatives; not free-text synthesis or deletion.
position: Second execution chapter; reference capture is a bounded compatibility path.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-c2-status.md
next: 2026-09-20-curation-contract.md
---
# Duplicate retirement

Use evolution.cycle, kind=curation. No host grant is created by an MCP request.
Both source and replacement need exact host operation/path grants and managed receipts.
No original, source_only, preserved, service-owned or manually changed input is admitted.

## Prepare and inspect

Read both current revisions; select the replacement explicitly.
prepare requires cycleId, requestId, expectedRevision=missing, path, sourceRevision,
replacementPath, replacementRevision and operation.
archive_duplicate archives only the source; merge_duplicates adds reciprocal lineage.
merge_passages appends distinct source passages verbatim and returns revision-bound ranges.
Example: identical A.md and B.md; choose B.md as the explicit retained canonical.
Counterexample: same title but different condition/version/basis is review_required.
Titles, aliases and provenance are semantic; cross-directory retirement needs reference review.
Active duties and mandatory warnings are excluded from this automatic proof.
The source must have no other inbound dependency or ambiguous/hidden reference.
Inspect the returned fingerprint; it binds both input revisions and proposed outputs.

## Apply and recover

apply uses a fresh requestId, current job expectedRevision and preview fingerprint.
The existing owner service creates the lifecycle plan; the existing writer applies it.
Bodies/history remain; source memory records become archived, not deleted. Rollback restores them.
Lost completion stays applying. Reconcile re-reads every planned output.
All outputs present: applied. All inputs restored: prepared, with the attempt count kept.
Only canonical-after/source-before can reconcile to resumable; apply writes just the source.
Other mixed orders or external edits require review; no blind patch replay.
revert restores recorded bytes only after current authority and output ownership checks.
Any manually edited input/output is preserved, never forcibly overwritten.

## Limits

Discovery stops after bounded entries, at most 200 files and 4 MiB of source reads.
This is not the million-document index path or a complete semantic merge algorithm.
Unresolved HTML, anchors, metadata differences, relative self-links and lineage cycles require review.
Applied is not next-use verified. Search and effect evidence remain separate.
No new model, scheduler, account, certificate, installation or endpoint family is added.
