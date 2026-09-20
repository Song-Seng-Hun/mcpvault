---
id: curation-reference-integrity-index
kind: execution-record
description: Bounded retirement checks backed by private SQLite reference postings.
keywords: [curation, reference impact, SQLite, archive, merge, 참조 검사]
use_when: Enabling or reviewing indexed managed archive and merge checks.
position: Integrity chapter; complements scoped graph discovery, not C1-C3 completion.
parent: 2026-09-20-curation.md
previous: 2026-09-21-curation-owner-route.md
next: 2026-09-20-curation-contract.md
---
# Reference integrity (참조 무결성)
Baseline main 89bdae3a2. No account, certificate, ACL or original changes.
Search graph absence is not retirement permission: hidden/draft/fiction records
and checkpoint Properties can retain references outside navigational edges.
The private SQLite worker now keeps separate reference-only postings/revisions.
These rows never enter memory retrieval, graph cards or public metadata.

## Host connection

Explicit MCPVAULT_REFERENCE_CACHE_DIR selects verified local private storage.
Unset: retain the bounded 200-file compatibility scan. No silent full fallback.
Configured: background enumeration covers md/markdown/txt within the existing
filesystem boundary. Denied scopes, unreadable files or extraction overflow
prevent complete coverage. No default execution/curation grant is installed.
Queries intersect at most 128 identity keys with bounded indexed posting walks.
Inspect at most 200 candidate documents; read only candidates and the target.
Use existing link/Property rewrite semantics to inspect current source bytes.
Conservative basename/alias collisions can require review, never infer safety.

## Freshness and recovery

Raw shared watcher events fence captures before discovery exclusions/debounce.
Reconciliation, policy changes, shutdown and watcher loss invalidate coverage.
Restart requires a new completed scan. An interrupted scan cannot sweep rows.
Recheck candidate/target revisions and current access before returning impact.
Small owned incremental updates may drain for at most two seconds; no request
waits for or starts an unbounded foreground scan. Known stale results fail closed.
This is not an atomic NAS snapshot or protection from unobserved direct writes.
Native writes, retention, managed receipts and exact host grants remain required.

## Evidence and open work
Isolated tests: 220 unrelated notes with one checkpoint reference; candidate-only
reads. A 210-note merge fixture applies, rereads and restores exact source bytes.
Tests also cover excluded guidance, hidden references, raw events, NAS loss,
manual edits, overflow, generations, restart and legacy reference equivalence.
Build/full regression passed: 563 files; 7,408 passed, 4 skipped. NAS runtime deployed.
Not verified: actual NAS curation, next-use effects; scale measurements tracked separately.
[Scale measurements](2026-09-22-curation-reference-measurement.md) are separate from prior graph benchmarks.
Skills, last unrecounted: metadata 186/1610 (11.55%); active 0/1610 (0%).
