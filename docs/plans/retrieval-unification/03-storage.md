---
id: retrieval-storage
kind: implementation-plan
description: SQLite read models and filtered LanceDB operation.
keywords: [SQLite, LanceDB, indexing, NAS, scale]
parent: README.md
previous: 02-candidates.md
next: 04-state.md
---
# Disk read models
Use: R2 large-mode storage. Not: migrating authoritative Markdown to a database.
SQLite holds disposable metadata, existing multilingual postings and graph adjacency.
LanceDB remains the operational vector backend.
Use node:sqlite in a separate index worker; never block the request loop with sync DB work.
Large mode requires Node>=22.23.2; retain the existing compatibility mode.
SQLite lives in verified local host storage, never a NAS/SMB-opened database file.
Markdown, immutable sources and authoritative revisions remain NAS-backed.
Preserve existing Korean/mixed/identifier tokenization; default English FTS is not a replacement.
Use stable IDs, cursor pages and bounded caches, not corpus arrays/maps in large mode.
Partition by security storage and embedding profile, then measured size.
Do not create project x genre x phase tables or duplicate vectors per department.
Inspect actual LanceDB index listings and explainPlan, not package capability alone.
Explicitly manage scalar filter indexes and vector indexes; record generation and readiness.
Incremental work uses event cursors, tombstones and revision manifests.
Permission changes invalidate plans/caches independently of content changes.
Publish prepared generations only after consistency checks; old generation remains recoverable.
Bound background rebuilds and apply backpressure; no foreground full reindex.
Unready indexes offer direct reads or partial results with a precise continuation.
NAS outage is not deletion; unverifiable private freshness/access fails closed.
Reconcile missed events using existing reconciliation, not a new unbounded foreground crawler.

## Acceptance
Test reopen, corruption, generation mismatch, deletion and policy-only changes.
Measure worker queues, local disk, JS/native memory, row/byte reads and NAS I/O.
Confirm ACL predicates are pushed down or explicitly bounded residual checks.
Reference: https://www.sqlite.org/useovernet.html
