---
id: adaptive-retrieval-02-planner
kind: research-proposal
description: Trusted predicates and cost-aware candidate planning.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating trusted predicates and cost-aware candidate planning.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 2 of 14; see parent for navigation.
parent: README.md
previous: 01-current.md
next: 03-scale.md
status: proposed-not-implemented
---
# Conditional search planner

Keep read rights, permitted execution environment and processing policy as independent admission axes.
Compile typed conditions; never execute document-supplied predicates or arbitrary SQL.
Bind hard applicability to its issuer, rule revision, scope and authorization basis.
Hard: current access, execution restrictions, explicit query filters and approved mandatory applicability.
Soft: inferred intent/project/topic, preferred genre, language, quality estimates and prior exposure.
Unknown soft metadata belongs in a fallback lane; missing security classification never means public.
Keep original Korean queries and exact names alongside verified English aliases.

## Candidate algebra

Eligible IDs = authorized partition IDs intersect explicit filters intersect approved hard applicability.
Use indexed postings/bitsets and scalar predicates, not a JavaScript scan of all metadata objects.
Estimate eligible chunks privately; public diagnostics must not expose hidden counts or shard names.
Exact path/ID/anchor resolution runs first when supplied.
For a small eligible set, compare all eligible vectors exactly within a byte/time cap.
For larger sets, choose verified filtered ANN with scalar indexing and bounded refinement.
Calibrate the crossover on storage, dimensions, selectivity and filter-vector correlation.
ACORN shows why naive prefilter scans and top-k postfiltering each have weak regimes.[S1]
LanceDB defaults to prefiltering where clauses; physical indexes and query plans still matter.[S2]
A where clause alone does not prove storage avoided a full scan.

## Ranking and expansion

Keep existing RRF as baseline; rank scores are not truth probabilities.
Deduplicate by logical document/source family; preserve separate channel diagnostics.
Reserve a bounded obligation lane for prerequisites, conditions and contradictions.
Relation targets must respect strict search conditions; conflicting context becomes a separate explicit read.
If obligatory context cannot fit, return partial with a revision-pinned continuation.
On weak coverage, relax soft routing once while retaining every hard condition.
Top-N topic shards are heuristic; fan-out exhaustion is partial coverage, not an empty corpus.
If no safe plan fits, return bounded lexical results or request narrower scope.
Never submit private vectors to an unauthorized processing backend.
See [sources](13-sources-retrieval.md); planner policy here is proposed, not shipped.
