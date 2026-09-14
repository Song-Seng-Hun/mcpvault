---
id: retrieval-r0-baseline
kind: execution-record
description: Frozen routing gold, existing quality results and native index-plan limits.
keywords: [baseline, LanceDB, case-sensitive, R0, R1a, 검색]
use_when: Reviewing what was measured before changing retrieval selection.
parent: README.md
previous: 10-delivery.md
next: 12-route-contracts.md
---
# R0 baseline and R1a boundary
Use: measured evidence and limits. Not: million-document or model certification.
Base:9a4ce516014954e00263ed52eadbf6d4262e7a74; Node22.23.2, LanceDB0.38.0.
Existing80search/100context/180task fixtures remain unchanged.
New tests/fixtures/retrieval-routing-v1.json:120cases,40each ko/en/mixed.
Forty synthetic source families;20development/20holdout,60tasks in each split.
Freeze SHA256:93870ec4aa27ada8dacedd8419b5a2fb2c32ab42ffa7ad798a69dbaf43c33fb9.
Hash covers JSON.stringify({sources,cases}); literal pinned independently in its test.
Gold froze before query-policy implementation; client flags are not host/ACL authority.
The new corpus is contract-only; it does not yet execute all120service scenarios.
Target corpus checks plus existing evaluation:4files,119passed,97.65s.
Existing synthetic lexical evaluation still returns promote=false at4000/12000chars.
Do not change legacy defaults or claim live embedding/token savings from these results.

## Native backend inspection
Read-only host check verified configured local cache root and canonical Vault namespace.
Its semantic-index directory was absent (ENOENT); no table was opened or created.
Thus live index listing/explainPlan, corpus size and ANN readiness remain unverified.
Current semantic available checks cache configuration/backoff, not table/index readiness.
No alternative namespace, private table or production rebuild was used to fill the gap.
Separate native experiment used128synthetic documents,256chunks,384dimensions.
No model calls, query execution or NAS data; CPU worker setting RAYON_NUM_THREADS=2.
Before indexing: no indexes; LanceRead -> FilterExec -> KNNVectorDistance -> TopK.
After indexing: Bitmap(embeddingProfile), Bitmap(fiction), IvfFlat(vector,cosine,2partitions).
Plan then used ScalarIndexQuery AND/NOT plus ANNIvfPartition and ANNSubIndex.
This proves the installed API/plan transition, not latency, recall or scaling quality.
Owned synthetic database directory was removed after connections closed.
Official interpretation: [prefilter](https://docs.lancedb.com/search/filtering),
[plan inspection](https://docs.lancedb.com/search/optimize-queries).

## First shared-policy correction
Case-sensitive ordinary/evidence retrieval admitted mismatched semantic candidates.
Memory discovery already filtered semantic calls for this condition.
Two new real-lexical/controlled-semantic tests failed with Other.md beside Exact.md.
Shared src/retrieval/query-policy.ts now owns strict syntax, expansion and semantic eligibility.
Original exports remain compatible; no tool IDs, defaults, ACL or ranking weights changed.
Four affected target files:72passed; build passed; frozen full502files:6947passed,4skipped,0failed.
Remaining: route-wide contracts, bounded candidate storage, exposure/state and graph work.
Global notes.resolve_link30s timeout is separate and still unresolved.
New live lexical probe:30s timeout; repeated case-sensitive pair matched at28.648s/19.370s, not the3s target.
