---
id: memory-scale-evidence
kind: benchmark-record
description: Reproducible SQLite memory-index scale measurements and limits.
keywords: [memory, SQLite, benchmark, million, 백만]
use_when: Assessing the new memory read-index capacity; not whole-Vault capacity.
position: Scale appendix after the current execution record.
parent: 2026-09-20-memory-flow.md
previous: 2026-09-20-memory-completion-evidence.md
next: 2026-09-20-memory-flow.md
---
# Measurement scope

Run `node scripts/benchmark-memory-index.mjs 100000` and then `1000000`.
Do not run concurrently with builds, regression or large background indexing.
Input is deterministic synthetic data: one memory unit per logical document,
100 project folders, two roles, and a Korean conditional phrase every 101 rows.
No Vault content, user queries, model calls or vector chunks are used.
Start requires 3.8 GiB free; stop below 2.3 GiB or above 1.5 GiB owned RSS.
Measurements cover local SQLite worker creation, 128-document ingestion batches,
100 sequential scoped queries, one correction insertion and inverse lookup.
Queries repeat one input: warm/cache-influenced timing, not cold-start p95.
RSS is sampled after batches; it includes worker/native memory, not only JS heap.
Build time excludes NAS enumeration, source-byte validation and embeddings.
The exact SQL query plan is retained; returned rows are not scanned-row counts.

## Final-source results

Same final source as completion evidence; Windows, Node 22.23.2, local storage.
| Logical documents / units | Build s | p50 / p95 ms | Sampled RSS MiB | DB / WAL MiB |
| --- | ---: | ---: | ---: | ---: |
| 100,000 / 100,000 | 165.592 | 1.310 / 2.659 | 123.602 | 408.520 / 7.807 |
| 1,000,000 / 1,000,000 | 1966.481 | 82.858 / 94.031 | 142.469 | 4203.629 / 7.807 |
100k: seven returned rows; correction insertion + reverse lookup 67.358 ms.
1M: twenty returned rows; correction insertion + reverse lookup 32.048 ms.
Plan uses gram PRIMARY KEY, doc rowid and covering units_role; sorting uses a temp
B-tree. There is no per-request JavaScript inventory of all documents.
Both runs exited successfully; scoped cleanup left zero benchmark directories.
These are one run per size, not confidence intervals or adversarial-corpus results.

## Not certified by this benchmark

Whole-Vault NAS scalability; filtered ANN accuracy; skewed production corpora;
model task success, Recall@5/MRR, retained-host context or actual token reduction.
Incomplete or resource-stopped runs must not count as measured completion.
The disk path remains optional; legacy indexes retain their own limits.
