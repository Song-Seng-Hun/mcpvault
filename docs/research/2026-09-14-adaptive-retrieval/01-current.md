---
id: adaptive-retrieval-01-current
kind: research-proposal
description: Static code findings and reusable service boundaries.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating static code findings and reusable service boundaries.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 1 of 14; see parent for navigation.
parent: README.md
previous: README.md
next: 02-planner.md
status: proposed-not-implemented
---
# Current implementation

Inspected main9c7e2d4cc; no live index inventory, query plan or million-document benchmark was run.
[RetrievalService](../../../src/retrieval-service.ts) has evidence RRF:k60, at most20per channel.
Strict quoted, excluded and structured queries disable semantic expansion.
[Semantic search](../../../src/semantic-search.ts) uses scope-derived tables and384-dimensional vectors.
General search puts profile/fiction in SQL; further visibility/path conditions are checked after top-k.
This can underfill eligible results. It does not itself prove hidden-content disclosure.
Memory candidates instead admit paths/revisions before vector top-k in128-path SQL batches.
That route caps admitted documents at10,000 and chunk rows at10,001per batch, reporting incomplete coverage.
Do not simply remove those caps for a million-document corpus.
The inspected source/scripts have no createIndex call; createTable is not proof of ANN availability.
Installed LanceDB0.38.0 exposes createIndex, explainPlan and bypassVectorIndex.
Inspect actual index metadata and plans before claiming indexed sublinear execution.

## Existing components

[Situation selection](../../../src/context-selection.ts) gates candidates before ranking.
Literal any/all/exclude/intents rules are not a general authenticated applicability policy.
[Feedback](../../../src/search.ts) records account-local query outcomes, not revision-specific negative-result learning.
It is explicitly process-local; durable feedback needs an additional privacy/storage contract.
[Skill evolution](../../../src/skill-evolution.ts) resolves discovered skills to current reviewed versions.
Its procedural-reference notice separates instructions from evidence and execution authority.
[Source delta](../../../src/source-delta.ts) provides bounded hunks, not consumer-specific exposure receipts.
The semantic result cache is5s/64entries; the query-vector cache is60s/32entries.
General result-cache reuse is bypassed when a custom access predicate is supplied.
These caches save computation; they do not track what remains in the model context.
Catalog path arrays and the graph entry Map are whole-corpus structures needing separate scale budgets.
The old [graph measurement](../../architecture/graph-index-measurement.md) covers1k/10k synthetic documents.
It does not establish1m capacity, cold NAS latency or current whole-server memory use.
Retain current authorization/exact-read checks while changing candidate enumeration.
