---
id: adaptive-retrieval-readme
kind: research-proposal
description: Architecture and navigation.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating architecture and navigation.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 0 of 14; entry index.
parent: README.md
previous: none
next: 01-current.md
status: proposed-not-implemented
---
# Adaptive retrieval for a million-document Vault

Recommendation: a cost-aware planner with bounded, disk-backed indexes.
Use statecharts for workflow and predicates for eligibility; do not turn every condition into a state.
Optimize verified task success per total cost, not vector latency or prompt length alone.
Target: at least1m logical documents and potentially many millions of evidence chunks.
This is a research proposal, not implemented behavior or a performance certification.
Baseline: main9c7e2d4cc; pending P1e changes and validation failures remain outside this artifact.

## Alternatives

A. Extend existing LanceDB/services with filtered planning and disk read models. Recommended first.
B. Replace the backend with specialized filtered ANN. Consider only after comparable local measurements.
C. Let an agent navigate everything. Useful escalation; not the sole predictable low-latency path.
Million-document readiness needs storage changes, not merely a ranking formula.

## Read by decision

- [Current code](01-current.md): reuse and verified gaps.
- [Conditional planner](02-planner.md): hard predicates, soft routing, exact versus ANN.
- [Scale and storage](03-scale.md): chunks, shards, indexes and memory.
- [Statecharts](04-state.md): events, guards and visibility.
- [Agentic retrieval](05-agentic.md): direct reads, bounded loops and stopping.
- [Procedural skills](06-skills.md): select, abstain, load and validate.
- [Exposure receipts](07-exposure.md) and [deltas](08-delta.md): safe duplicate reduction.
- [Feedback](09-feedback.md) and [graph](10-graph.md): relevance without authority drift.
- [Evaluation](11-evaluation.md) and [sequence](12-sequence.md): delivery gates.
- Sources: [retrieval](13-sources-retrieval.md), [agents/skills](14-sources-agents.md).

No code, live Vault, account, model download, agent process or runtime configuration changed.
All proposed limits require evaluation; research citations do not prove local performance.
