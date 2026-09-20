---
id: curation-c2-working-status
kind: execution-record
description: Lossless passage merge, interrupted-bundle resume and disk graph indexing; unfinished C2/C3.
keywords: [archive_duplicate, merge_duplicates, merge_passages, SQLite, recovery, 병합]
use_when: Continuing the active whole-plan goal; do not reuse earlier release tests.
position: Working continuation after the deployed exact-edge cleanup.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-status.md
next: 2026-09-20-curation-retirement.md
---
# C2/C3 partial engine delivery

Starting HEAD: e5855de64; release 20260920-curation-merge-graph-final is live. No grant, binding, NAS content change or deletion.

## Delivered engine subset

- archive_duplicate compares exact body and semantic metadata against a managed replacement.
- merge_duplicates uses the explicit canonical and existing lifecycle/change-set services.
- The private journal pins both original and output revisions and both ownership proofs.
- Reread both outputs before completion; restore both only while outputs remain owned.
- A verified canonical-first partial merge resumes only its unwritten source transition.
- Retirement also archives the source memory view; historical recall and rollback retain both originals.
- Reference capture is bounded at discovery and body reads; incomplete means no approval.
- SQLite stores distinct graph occurrences with forward/reverse indexes and keyset pages.
- Continuations require the original index generation; changes invalidate the page cursor.
- Graph results remain private unresolved candidates, not absence or permission certificates.
- merge_passages retains both bodies verbatim, maps original revisions/ranges and writes the canonical first.
- Metadata conflicts, anchor collisions, incomplete blocks and ambiguous relocation require review.
- The journal revalidates passage mappings; a forged locator cannot be returned as evidence.
- Background indexing covers ordinary knowledge; graph-only records never enter memory results.
- Each graph key is limited before multi-key merging; legacy rows backfill missing graph coverage.

## Validation and delivery

- Authenticated live read/diagnose passed; original/world/economy bytes and rollback release preserved.
- Targets: 22 files / 185 passed; final link-safety targets: 8 files / 46 passed; build passed.
- Full: 556 files, 7,321 passed / 4 skipped / 0 failed, basis 827de09e; interrupted evidence is not reused.

## Still open

- Physical split, staged-bundle visibility and broader merge metadata/anchor mapping.
- Resume other partial multi-output orders; the owned canonical-first merge is supported.
- Connect paged graph candidates to complete ACL/revision-safe impact validation.
- Usage coverage, automatic archive eligibility, deletion rehearsal and fixed quality corpus.
- Graph measurements: [scale record](2026-09-20-curation-graph-measurement.md); live effects remain absent.
- Live auto-apply is OFF: compilation host policy and exact managed grants/receipts are missing; capture limit 200 files.

Actual live applied / restored / next-use effects: 0 / 0 / 0.
Last skills: metadata 186/1610 (11.55%); active 0/1610 (0.00%); not recounted.
