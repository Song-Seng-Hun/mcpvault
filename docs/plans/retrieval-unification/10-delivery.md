---
id: retrieval-delivery
kind: implementation-plan
description: Sequenced delivery and isolated Qdrant comparison.
keywords: [R0, R6, deploy, Qdrant, rollback]
parent: README.md
previous: 09-evaluation.md
next: status.md
---
# Delivery
Use: execution sequencing. Not: authorization to switch production vector engines.
Gate0: preserve P1e failures; finish fresh validation/deployment before search source edits.
R0: route contract matrix, real indexes/plans, frozen120-case set and resource baseline.
R1: common contracts/planner, profile adapters and bypass architecture tests.
R2: local SQLite read models, filtered Lance indexes, bounded incremental workers.
R3: state machine, fast-first/expansion and optional skills versus mandatory rules.
R4: retention receipts, conservative deltas, scoped penalties and review.
R5: bounded graph and gap-driven agentic exploration.
R6: isolated Qdrant adapter, reproducible comparison and transition recommendation.
Each batch: targets -> build -> frozen low-memory full regression -> solo code/security review.
Then staged path/content checks -> retained rollback -> NAS-backed live checks -> main commit/fork push.
Source drift invalidates test evidence; include dist, exclude host data/models/Vault/secrets.
Begin shadow comparison; disable unsafe features without unbounded legacy fallback.
Do not call pending migration, unsupported hooks or unavailable evaluation complete.

## Qdrant experiment
Pin official stable release, verified Windows asset and SHA256 in experiment manifest.
Failed provenance/asset verification blocks experiment; no Docker or unofficial substitution.
Use an isolated local folder, loopback binding and authentication.
No autostart, firewall changes, operational Vault, credentials or user queries.
Use public/synthetic corpus; backend-specific benchmark credentials remain host-only.
Run LanceDB and Qdrant sequentially with equal data, embeddings, filters and resource bounds.
Require6GiB free RAM at start.
Stop if free RAM<2.3GiB or summed owned experiment RSS>4GiB.
Never overlap with build, full tests or large index jobs.
Only stop owned processes; preserve unrelated services and recoverable experiment records.
Recommend transition only if equivalent quality/safety,1M p95 improves>=20%, peak RAM does not rise.
Actual production transition requires a separate decision.
Unsupported/resource-blocked tiers remain unverified, not extrapolated certification.
Security reference: https://qdrant.tech/documentation/tutorials-operations/secure-qdrant/
Final report separates shipped features, host support, quality/cost, scale and external comparison.
