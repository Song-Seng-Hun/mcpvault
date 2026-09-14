---
id: adaptive-retrieval-05-agentic
kind: research-proposal
description: Agentic routing and bounded evidence-seeking loops.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating agentic routing and bounded evidence-seeking loops.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 5 of 14; see parent for navigation.
parent: README.md
previous: 04-state.md
next: 06-skills.md
status: proposed-not-implemented
---
# Bounded agentic retrieval

Agentic RAG is a planner route, not another search system or an always-running model.
The current approved agent can choose an allowed read; the server spawns no new agent.
Adaptive-RAG motivates varying effort by question complexity, not always doing multi-step retrieval.[S5]
Also consider locators, evidence gaps, index readiness and measured I/O cost.

## Routes

Reuse: acknowledged retained context covers the current need; no duplicate body.
Direct: exact ID/path/heading -> outline or bounded range, without query embedding.
Lexical: identifiers, error strings, names, quoted clauses and strict filters.
Hybrid: paraphrase/multilingual concepts within eligible candidates.
Graph: explicit relationship questions or missing prerequisites/counterexamples.
Iterative: one named unresolved question justifies another search or read.
Source-dependent work cannot skip verification because the model believes it knows the answer.
Direct file search stays scoped; grep over1m NAS files is not the cheap default.

## Loop

Observation -> evidence gap -> permitted next action -> result check -> stop or next gap.
Gap codes include ambiguous_name, missing_condition, stale_source and incomplete_scope.
Deduplicate normalized action plus scope and basis, not query text alone.
Each round must add a source family, resolve a locator or test a specific contradiction.
Free-form confidence does not prove completeness.
A trial ordinary profile can allow2rounds/6read-search actions within one total budget.
These are initial experimental bounds, not established optima.
Explicit deeper research gets a separately bounded profile; implicit web/cloud escalation stays off.
Reserve warnings, provenance and continuation before allocating descriptive prose.
Stop partial on token, time, bytes or freshness exhaustion, with the next permitted read.
A timeout is operational failure, not grounds to downrank the source.
No purchased generation API or background model is added.
Harness work motivates durable artifacts and incremental progress, not indefinite retrying.[S11]
See [retrieval](13-sources-retrieval.md) and [harness](14-sources-agents.md) evidence.
