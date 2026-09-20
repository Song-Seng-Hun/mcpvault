---
id: curation-reference-index-measurement
kind: measurement-record
description: Synthetic SQLite reference-posting scale, limits and release evidence.
keywords: [curation, SQLite, reference index, million documents, 성능]
use_when: Interpreting integrity-index scale without claiming live curation success.
position: Measurement supplement to reference-index implementation and review.
parent: 2026-09-22-curation-reference-index.md
previous: 2026-09-22-curation-reference-review.md
next: 2026-09-20-curation-contract.md
---
# Scope and reproduction

Node 22.23.2; real SQLite worker; synthetic documents, three reference values each.
Zero vector chunks, zero NAS I/O; no source files or user documents generated.
This measures postings, not full filesystem ingestion, ACL checks or end-to-end RAG.
Private run receipts pin engine/driver hashes and query plans; no host data published.
Driver SHA-256: 74fb593dd5cfe4827038d40924fc08e8d51a4516bc457783780c286b6567aa34.
Build basis: f8f5a39528b4b383a168d0f199d80e9fb56a1edc6674996efca6d0edcf7a89d4.
Driver uses 128-row batches, then 100 warm reads per scenario, without parallel jobs.
Resource guards: start free RAM >=3.8GiB; stop below 2.3GiB or RSS >=1.5GiB.
Owned temporary databases are removed after measurement; receipts remain private.

## Measurements

| Logical documents | Reference values | Build | Peak process RSS | DB + WAL |
| --- | --- | --- | --- | --- |
| 100,000 | 300,000 | 37.97s | 118.62MiB | 52.11 + 7.45MiB |
| 1,000,000 | 3,000,000 | 481.18s | 124.66MiB | 516.84 + 7.87MiB |

100k p50/p95 milliseconds: hub .292/.347; unique .244/.313;
preserved snapshot .228/.277; absent .174/.232. Update plus two reads: 2.843ms.
1m p50/p95 milliseconds: hub .268/.340; unique .193/.272;
preserved snapshot .161/.197; absent .150/.175. Update plus two reads: 2.891ms.
The hub returns 20 candidates and truncated=true; it is not certified absence.
Each measured single-key posting branch visits at most 21 selected rows by plan.
That bound is not an instrumented physical I/O or all-SQLite-page count.
Explain confirms key-index lookup; DISTINCT/order operate on bounded candidates.
No reference-only row appears in memory retrieval after ingestion.

## Acceptance limits

Full same-source regression: 563 files, 7,408 passed, 4 skipped, zero failed.
Target tests/build pass; isolated indexed merge reread/exact rollback pass.
NAS runtime deployed; existing non-admin reads pass; status-only probes observed ready.
Original/world/economy bytes preserved. Real curation/next use: 0/0; no new grants.
Search Recall/MRR, semantic preservation and actual task cost are not measured here.
This is not million-document automatic-curation or NAS consistency certification.
