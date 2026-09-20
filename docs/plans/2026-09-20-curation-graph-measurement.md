---
id: curation-graph-scale-measurement
kind: measurement
description: Synthetic disk graph ingestion and bounded keyset query measurements, not NAS certification.
keywords: [SQLite, curation, graph, scale, benchmark, 백만]
use_when: Comparing graph read cost; do not substitute this for ACL, quality or live curation evidence.
position: Scale measurement supporting the unfinished C3 implementation.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-c2-status.md
next: 2026-09-20-curation-retirement.md
---
# Disk graph scale

Runner: `node scripts/benchmark-curation-graph.mjs 100000` or `1000000` after build.
Real production SQLite worker; synthetic knowledge documents with two authored links each.
No vectors, NAS calls, user documents or model inference. Each query repeats 100 times.
Two incoming hub keys; outgoing relations from 20 exact document paths; page size 20.
Each key reads at most 21 indexed occurrences before combining the bounded windows.
This is a computed SQL window bound, not measured SQLite VM row/byte counters.

| Measure | 100,000 documents | 1,000,000 documents |
| --- | ---: | ---: |
| Authored occurrences before update | 200,000 | 2,000,000 |
| Ingest time | 42.22 s | 566.05 s |
| Incoming p50 / p95 | 0.63 / 0.79 ms | 0.69 / 1.04 ms |
| Outgoing p50 / p95 | 4.18 / 4.98 ms | 5.18 / 6.48 ms |
| One update and reverse lookup | 3.81 ms | 3.29 ms |
| Empty memory query over graph corpus | 0.74 ms | 0.53 ms |
| Sampled process RSS maximum | 128.54 MiB | 135.23 MiB |
| SQLite file | 201.24 MiB | 2013.77 MiB |

Results and exact query plans stay in the ignored `.mcpvault/curation-benchmark/` directory.
The million-document runner records Node and built worker/store SHA-256 values.
Worker SHA-256: `3394175b4c5dd0168ba4beed5919e7b235280b73ab05717e6585a2fda68a3d62`.
Store SHA-256: `43081318017ef5b4fe1f56902224bcca759b04ff44ea3b5144ea5893a1d7c765`.
These runs predate the Markdown-relative-key fix; the measured corpus uses wikilinks only.
They do not certify the final delivery build; final-version validation remains separate.
Raw generated databases use a dedicated OS temporary directory, removed after each run.
Memory guard: start at 3.8 GiB free; stop below 2.3 GiB or above 1.5 GiB owned RSS.
Do not run alongside builds or full regression. Keep the previous deployed engine unchanged.

Still unmeasured: NAS latency, complete permission/alias resolution, multilingual retrieval
quality, source-family recall, actual next-use effects and model input-token savings.
These figures are not full million-document operational certification.
