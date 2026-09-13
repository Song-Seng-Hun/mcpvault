---
id: context-architecture-evaluation
kind: acceptance-contract
description: Freeze multilingual tasks before tuning; measure evidence and total context cost.
keywords: [holdout, recall, MRR, tokens, provenance, regression]
parent: README.md
previous: 04-automation.md
next: 06-execution.md
---
# 5. Evaluation

Preserve retrieval80, context-economy100 and all existing regression fixtures.
Add180 tasks:60 Korean,60 English,60 mixed; 90development/90holdout split by family.
Freeze documents, chapters, evidence, allowed tools and required warnings first.
Cover tool/rule/source selection, conditions/counterpoints, names and completion.
Include collision/version/empty/misclassification/hidden/revoked cases.
Measure logical documents/families, never inflate results through physical shards.

At4000/12000 chars: language Recall@5/MRR nonregression, negative FP nonincrease.
Evidence inclusion target min(100%,baseline+5pp); critical qualifiers all pass.
Median cumulative input reduction >=30%, including instructions/TOCs/rereads/history.
Separate one-time conversion cost and report break-even reads.
Librarian: task success nonregression, p95 end-to-end <=baseline*1.10, resource caps.
Compare dense fragments with short complete English sentences; clarity wins.
Separate mocked embedding, real embedding, real librarian and current-agent evals.
Missing evidence is unverified, never passed. Do not tune on holdout.

## Required safety cases

- Hidden titles/existence/counts/departments/source bodies never leak.
- ACL-only drift, mixed restrictions, policy-before-body interruption.
- Korean/emoji/CRLF/repeated headings/long lines/tables/footnotes/both fence styles.
- Exact source coverage/hashes/locators/historical citations.
- Old paths/anchors/backlinks/Obsidian; no task/claim/MOC inflation.
- Interruption at every store phase, manual edits, races and restart.
- NAS outage is neither deletion nor empty inventory.
- Corrupt receipts, hostile model output and forged reading receipts.
- Unsupported/duplicate hooks, code mode, late completion, cancel, Plan, reentry.
- Unchanged events produce no extra edits/notifications/model calls.
- Legacy APIs and exact source read/export remain compatible.
