---
id: adaptive-retrieval-11-evaluation
kind: research-proposal
description: Quality, routing loss and total-cost measurement gates.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating quality, routing loss and total-cost measurement gates.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 11 of 14; see parent for navigation.
parent: README.md
previous: 10-graph.md
next: 12-sequence.md
status: proposed-not-implemented
---
# Scale and quality evaluation

Keep existing80search,100context-economy and180task cases unchanged.
Fix new development/holdout sets by source family before tuning, retaining Korean/English/mixed queries.
Add100k/1m/3m document tiers with explicit chunk distributions, not one vector per document.
Use approved public/synthetic fixtures, not unauthorized Vault copies.
Include skewed projects, long notes, overlapping departments, old versions and high-degree hubs.
Run tiers only with sufficient resources; unexecuted tiers stay untested.

## Independent measures

ANN: exact-neighbor recall within the identical hard-eligible set.
Routing: relevant documents lost before retrieval, including soft-shard misses.
Evidence: logical/source-family Recall@5, MRR, conditions, negatives and exact locators.
Task: verified outcomes, wrong-tool rate, missing rules and unnecessary skills.
Exposure: duplicate tokens, mistaken suppression, delta recovery and compaction.
Privacy: hidden content/counts, revoked access, forged receipts and cross-account cache reuse.

## Total cost

Measure p50/p95 latency, cold/warm load, rows/bytes scanned, NAS reads and native/JS peak RAM.
Include embedding, scalar filtering, ANN probes, hydration, serialization and agent round trips.
Count cumulative input including catalogs, schemas, receipts, deltas and failed retries.
Separate preprocessing/reindex cost and calculate break-even reads for stable representations.
Vary eligible fraction:0.01%,0.1%,1%,10%,100%, with correlated/adversarial filter-vector distributions.
Test concurrency, cancellation, churn, misses, restart and generation lag.
Compare no-skill/length-matched noise/selected chapters, not just always-skill.[S9][S10][S12]

## Acceptance

Prior language Recall/MRR must not decrease; negative false positives must not increase.
Retain5pp required-evidence improvement target, capped at100%, and30% median cumulative-input reduction.
These remain unachieved targets, not findings from this research.
Zero permission leakage, user overwrite or required-context suppression in fixed safety cases.
Calibrate exact/ANN crossover on development data, then lock it for holdout.
Require plans showing bounded/indexed access; small JSON does not prove cheap retrieval.
Do not infer million-scale production capacity from unit tests or vendor latency charts.
