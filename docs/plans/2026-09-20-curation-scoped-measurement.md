---
id: curation-scoped-measurement
kind: measurement
description: Synthetic bounded graph and identity lookup cost; not live curation proof.
keywords: [million, SQLite, aliases, graph, benchmark, 백만, 별칭]
use_when: Checking the scoped graph index cost and unverified operational limits.
position: C3 storage measurement after scoped graph integration.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-scoped-graph.md
next: 2026-09-20-curation-retirement.md
---
# Bounded graph lookup

Node 22.23.2; synthetic local SQLite; 100 sequential samples per query scenario.
Reproduce: `node scripts/benchmark-curation-graph.mjs 100000` (then 1000000).
Store SHA-256: `12cbd9c816a9946e7690d6d98bc0a9a49f82ec0a5992a6d495858cb9b15ac458`.
Worker SHA-256: `6c3f6b53a106d508b5ef3e3e74e15523aa3ea8cf72da663e7fc1de20a917ce92`.
No NAS content or model call. Owned synthetic databases removed after each run.

| Metric | 100,000 logical documents | 1,000,000 logical documents |
| --- | ---: | ---: |
| Relation occurrences | 200,000 | 2,000,000 |
| Build time | 51.70 s | 669.25 s |
| Incoming query p95 | 0.708 ms | 0.939 ms |
| Outgoing query p95 | 4.887 ms | 5.352 ms |
| Shared alias p95 | 0.370 ms | 0.292 ms |
| Unique alias p95 | 0.239 ms | 0.211 ms |
| Exact path p95 | 0.179 ms | 0.257 ms |
| Peak process RSS | 141.51 MiB | 144.18 MiB |
| SQLite file | 250,503,168 bytes | 2,510,180,352 bytes |

The shared alias belongs to every document; only 21 indexed IDs are admitted.
Incoming/outgoing queries admit at most 42/420 branch rows for the measured inputs.
Explain plans confirm indexed key walks; no complete alias posting-list sort.
The final window has 20 results and explicit truncation, not all alias matches.
One source update plus lookup: 3.27/4.25 ms; no optional-memory units in graph-only rows.
Rows admitted are query-shape bounds, not measured physical bytes or VM instruction counts.
These are warm storage queries, not live permission/revision checks or end-to-end latency.
No claim of NAS million-document operation, Recall/MRR, token saving or effect validation.

## Operational evidence

Existing-account read-only NAS inventory succeeded without any new credential binding.
Visible Inbox was empty; Community/Knowledge had one visible file, not an ownership proof.
Generic compilation excludes that service namespace; an owner-service connection is still needed.
No eligible ordinary managed output was identified; compilation also lacks a host policy.
These observations say nothing about hidden documents; no service-path exemption was added.
Root continuation emitted an invalid absolute path; fix omits it, preserving path guards.
Actual curation applications, deletion and next-use effects remain zero.
