---
id: retrieval-candidates
kind: implementation-plan
description: Hard eligibility, soft relevance and cost-aware retrieval.
keywords: [filters, ANN, RRF, conditions, 후보]
parent: README.md
previous: 01-contracts.md
next: 03-storage.md
---
# Candidate selection
Use: planner/filter implementation. Not: ACL decisions from model labels.
Hard conditions: current ACL, execution policy and explicit path/quote/exclusion/filter.
Approved mandatory applicability is hard only with issuer, rule version and scope.
Soft conditions: inferred topic, project, genre, phase and optional relevance.
Unknown classification is not public; uncertain relevance is not permanent exclusion.
Build candidates with indexed postings/ID intersections, not a full JavaScript scan.
Apply authorization before top-k and again at hydration and final return.
Residual callback predicates use bounded pages; exhaustion returns partial coverage.
Never silently replace bounded inspection with a full scan.
Exact ID/path/anchor selects direct read; strict strings prefer lexical search.
Choose eligible-set exact vectors versus filter-aware ANN by measured crossover.
Freeze crossover on development data before holdout evaluation.
Baseline fusion: equal RRF k=60; at most20 candidates per lexical/semantic channel.
Semantic execution requires existing host authorization; failure permits lexical results.
Required conditions, counterexamples and contradictions have a bounded evidence lane.
If strict conditions conflict with that lane, offer separate reads, not relaxed matches.
Allow one soft-condition expansion; never relax a hard condition.
Track searched partitions and residual predicate coverage.
Partial coverage cannot establish that no answer or document exists.
Rank is relevance, never truth, permissions or evidence independence.

## Tests
Quoted/excluded/structured syntax, Korean/mixed identifiers and exact aliases.
Hidden top-k saturation, residual-page exhaustion and revised access during hydration.
Eligible-set exact recall versus ANN recall; routing loss reported separately.
Same names in different project/version scopes must not merge.
Example: exact Korean item ID -> lexical/direct locator before optional semantic search.
