---
id: retrieval-evaluation
kind: implementation-plan
description: Frozen quality, safety, context and scale acceptance.
keywords: [benchmark, holdout, million, recall, 평가]
parent: README.md
previous: 08-interfaces.md
next: 10-delivery.md
---
# Evaluation
Use: R0 fixture freeze and each rollout gate. Not: synthetic tests as production certification.
Preserve existing80 retrieval,100 context-economy and180 task cases.
Add120 routing/exposure cases:40 Korean,40 English,40 mixed.
Split60 development/60 holdout by source family before tuning.
Fix gold documents, required evidence, procedures and warnings before implementation tuning.
Measure logical documents/source families; chapters must not inflate recall.
Budget comparisons:4000 and12000 serialized characters, including actions and metadata.
Per-language Recall@5/MRR cannot decrease; negative false positives cannot increase.
Required evidence target:+5 percentage points, capped at100%.
Median cumulative input-token reduction target:30%, including repeated/discovery context.
Separate one-time preparation cost and recurring costs; report break-even reads.
Skill controls: none, relevant bundle, selected chapter, wrong version and length-matched noise.
Compare ANN to exact retrieval over the same eligible set; measure routing loss separately.
Keep unit/fake embedding, actual embedding, agent-model and load evaluations separate.
Unperformed/partial evaluation is not a pass.

## Scale and cost
Tiers:100000,1000000,3000000 logical documents; record actual chunk counts.
Include skew, high-degree hubs, overlapping ACLs, updates and policy-only revocation.
Record explain plans, rows/bytes read, NAS I/O, local/native/JS memory and p50/p95.
Include indexing/rebuild/update cost, model round trips and full cumulative context.
No full metadata/path/graph scan hidden in large-mode request execution.
Record exact corpus, runtime, hardware, model/profile and index-generation manifests.

## Safety gates
No hidden existence/title/count/department/body leakage, even in small packets/errors.
No unauthorized backend transmission, stale-private cache or manual-edit overwrite.
Exercise duplicate events, forged/lost receipts, cancel, restart and unsupported hooks.
Test Korean/emoji/CRLF/quotes/identifiers, exclusions, revisions and exact source export.
No full scan fallback to mask incomplete indexes or exhausted resources.
