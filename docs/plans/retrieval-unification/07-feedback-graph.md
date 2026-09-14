---
id: retrieval-feedback-graph
kind: implementation-plan
description: Scoped relevance penalties and bounded graph expansion.
keywords: [feedback, relevance, graph, 반례, 검토]
parent: README.md
previous: 06-exposure.md
next: 08-interfaces.md
---
# Feedback and graph
Use: R4 relevance review and R5 relation traversal. Not: truth scoring or content rewriting.
Bind feedback to actual result receipt, revision, authenticated account and task.
Reasons: wrong topic/entity/version, duplicate family, stale derivative, needless skill, rendering error.
Same task retries or multiple workers count once.
Same account/project/intent/document revision:3 distinct tasks within30 days trigger review.
Apply one optional relevance penalty, at most10%; do not compound it.
Expire after7 days or document/applicability revision change pending fresh validation.
Retain historical evidence separately from current judgment.
Exempt exact targets, mandatory rules, required counterpoints/contradictions and source reads.
Timeout, access denial, no click and disagreement are not negative relevance evidence.
Automatic actions: this penalty and already-authorized derivative repair only.
Meaning, access, claims and lifecycle changes use review and existing mutation owners.
Persist only in explicitly authorized host storage; otherwise process-local diagnostics.
Feedback is not cross-account or global popularity demotion.

## Graph contract
Separate navigation, evidence relations, procedure dependencies and ANN graph mechanics.
Default one hop from accessible seeds; second hop only for an explicit expansion gap.
Inspect at most200 relationships per request; prioritize conditions and counterpoints.
Overflow returns bounded coverage; hidden neighbors/degrees/paths/counts are not exposed.
Use forward/reverse adjacency and alias-reference reverse postings for delta updates.
No foreground global PageRank, community analysis or whole-corpus LLM extraction.

## Acceptance
Distinct-task deduplication, penalty cap/expiry, revision invalidation and protected evidence.
High-degree hubs, hidden neighbors, concurrent moves and reused alias paths.
Example: three irrelevant skill deliveries for the same context -> bounded demotion plus review.
