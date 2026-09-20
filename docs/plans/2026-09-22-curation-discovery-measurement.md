---
id: curation-discovery-measurement
kind: measurement-record
description: Synthetic SQLite candidate-ingestion and indexed-query measurements, not NAS certification.
keywords: [curation, million, SQLite, latency, memory, 백만 문서]
use_when: Assessing candidate-window scaling or separating index cost from live application quality.
position: Measurement companion to incremental curation.
parent: 2026-09-22-curation-incremental.md
previous: 2026-09-22-curation-discovery-review.md
next: 2026-09-20-curation.md
---
# Candidate index measurement (후보 색인 측정)

Command: `node --max-old-space-size=256 scripts/benchmark-curation-discovery.mjs COUNT`.
Node 22.23.2; actual SQLite worker ingestion, 128-row batches, 1,000 exact-body groups.
One synthetic note row per logical document; no NAS Markdown fixtures created.
Zero vector chunks/model calls/NAS I/O. Two runs were sequential, not concurrent with tests.
Queries repeat 100 times; return eight candidates, with keyset continuation verified.

| Synthetic logical documents | 100,000 | 1,000,000 |
| --- | ---: | ---: |
| Index build seconds | 34.60 | 440.09 |
| Relation query p50 / p95 ms | 0.226 / 0.331 | 0.213 / 0.317 |
| Duplicate query p50 / p95 ms | 0.252 / 0.329 | 0.258 / 0.313 |
| One update plus lookup ms | 2.863 | 6.838 |
| Peak process RSS MiB | 119.34 | 126.39 |
| SQLite main file bytes | 83,173,376 | 832,118,784 |

RSS includes the main process and worker/native allocations; JS heap alone is not RSS.
Disk values exclude WAL overhead and are not a complete capacity estimate.
Plans use curation_relations_path, curation_groups_active and curation_body_path indexes.
Selected note rows use primary-key lookup; no whole-document scan or temporary sort appeared.
Nine candidate rows bound the primary window; auxiliary group seeks are separate operations.
The measured p95 excludes NAS body reads, current ACL checks, graph impact and model work.
This is not Recall/MRR, memory usefulness, semantic merge safety or full-plan certification.

## Reproduction and cleanup

Worker SHA-256: `7f926fb2fefd5ad3e842728ea0287ff945124534cc1ae7fe8b8429607c2aa183`.
Store SHA-256: `6dd0d14040bbe9066b540df2abb8507aa39a2708a92f385417f7e2294351c537`.
Private result receipts include all engine fingerprints, detailed plans and runtime values.
Resource guards require 3.8 GiB free RAM at start, stop below 2.3 GiB or 1.5 GiB own RSS.
Only owned, validated temporary directories were removed after closing each worker.
Benchmark result records remain host-local; no Vault contents or host credentials are committed.
