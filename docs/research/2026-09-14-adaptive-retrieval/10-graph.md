---
id: adaptive-retrieval-10-graph
kind: research-proposal
description: Typed graph retrieval with bounded adjacency and hub control.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating typed graph retrieval with bounded adjacency and hub control.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 10 of 14; see parent for navigation.
parent: README.md
previous: 09-feedback.md
next: 11-evaluation.md
status: proposed-not-implemented
---
# Bounded graph retrieval

Keep relation roles separate, not a single generic similarity graph.
Document graph: parent/previous/next, aliases and explicit navigation references.
Evidence graph: supports/contradicts/prerequisites and revision-pinned source locators.
Procedure graph: required steps, related tools and approved applicability.
ANN proximity graph: storage implementation detail, never a knowledge assertion.
Source families connect translations/summaries without counting them as independent corroboration.

## Queries

Start from admitted exact/lexical/vector seeds and traverse the authorized induced graph.
Default one hop; permit another only for an explicit unresolved gap and total edge budget.
Prioritize conditions/contradictions over generic related links.
Bound per-node and per-relation expansion; a popular MOC cannot flood every packet.
Report incomplete coverage if caps prevent mandatory edge examination.
Never expose hidden neighbors, degrees, traversal paths or their diagnostic counts.
Rights changes invalidate traversals even when Markdown is unchanged.
PPR is a later optional associative-search experiment on bounded admitted subgraphs.[S6]
No full-corpus PageRank or community detection inside ordinary requests.
Current readable Markdown verifies evidence; graph edges only discover candidates.
Selected partitions cannot justify claiming an exhaustive corpus-wide survey.

## Storage and updates

Use disk-backed forward/reverse adjacency by stable IDs, revisioned edges and hot-page caching.
Maintain inverse maps from unresolved link tokens/aliases to referring document IDs.
Alias changes target affected references; ambiguity and path reuse still require validation.
The old10k measurement does not prove million-scale readiness or that this storage is shipped.
Source-file ownership remains authoritative; derived edges are reconstructible.
LazyGraphRAG motivates deferred summarization and budgeted query-time relevance tests.[S13]
Its news study does not establish million-document cost or multilingual ACL safety.
Reuse explicit relations before considering LLM extraction over the whole corpus.
See [graph research](13-sources-retrieval.md); no graph database is selected here.
