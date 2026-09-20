---
id: curation-physical-split
kind: execution-record
description: Verbatim chapter publication, hidden staging, recovery and current limitations.
keywords: [split, chapters, publication, recovery, 분리, 원문]
use_when: Publishing an explicitly admitted ordinary document as physical chapters.
position: C2 continuation; not completion of the whole curation plan.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-c2-status.md
next: 2026-09-20-curation-operation.md
---
# Physical split

Starting commit: e8e9eddbd. Release 20260920-curation-publication-final is live.

## Contract

- Existing compilation bundle preserves exact original bytes in private storage.
- Host chapter grant additionally requires `publication: verbatim`; omission stays OFF.
- `wiki.compilation` uses `kind: document_bundle` and `split_preview/apply/revert`.
- Apply requires preview fingerprint, bundle revision, publication revision and request ID.
- Split one ordinary source into 2-4 exact chapters; every physical file is <=50 lines.
- Original metadata stays on the outline; chapters do not duplicate knowledge ownership.
- Chapter IDs, source offsets, family, previous/next and original heading landings persist.
- Source language remains unchanged; no translation or semantic approval is claimed.
- Root restrictions and publication hold persist before any chapter body.
- Ordinary reads, search predicates and directory navigation hide pending outputs.
- Owner staging is exact-path, request-local and cannot bypass inherited restrictions.
- Reread all chapters before the original-path change-set preview and cutover.
- Publish only after reread; a release-boundary edit re-hides the bundle without overwriting.
- Restart reconciles only matching revisions; lost acknowledgements do not replay writes.
- Revert restores exact original; derivative chapters remain hidden for recovery, not deleted.
- Historical original reads remain revision-pinned after publication and withdrawal.

## Limits and evidence

- Ambiguous anchors, relocation-dependent links, memory/task owners and oversized blocks require review.
- Private synthesis candidates are not promoted by lossless structural publication.
- No new account, certificate binding, runtime grant or live Vault policy was created.
- CLI currently passes host storage only; its verified processing runtime connection is still missing.
- Existing managed-output receipts and exact host grants are also required; a config file alone is insufficient.
- Real temporary-filesystem tests cover apply/restart/revert, partial writes and manual-edit conflicts.
- MCP tests exercise the existing authenticated route; they are not live NAS application evidence.
- Build and full regression passed: 558 files, 7,338 passed / 4 skipped / 0 failed; basis f5d1a9ff.
- Initial stale architecture hashes were reviewed and updated; failed run retained, not counted.
- Existing-account live read/diagnose and split-operation discovery passed; no new binding or content write.
- Canonical original/world/economy bytes and the previous rollback release were preserved.
- Actual NAS split / next-use effect: 0 / 0. Whole C1-C3 remains unfinished.
- Last skills: metadata 186/1610 (11.55%); active 0/1610 (0.00%); not recounted.
