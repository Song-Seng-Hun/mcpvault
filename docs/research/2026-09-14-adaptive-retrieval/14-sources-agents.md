---
id: adaptive-retrieval-14-sources-agents
kind: research-proposal
description: Contrasting harness and skill evidence with transfer limits.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating contrasting harness and skill evidence with transfer limits.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 14 of 14; see parent for navigation.
parent: README.md
previous: 13-sources-retrieval.md
next: README.md
status: proposed-not-implemented
---
# Harness and skill sources

Reviewed2026-09-14. Engineering reports and benchmark results have different evidentiary limits.
[S8] Anthropic. Equipping agents for the real world with Agent Skills. October16,2025.
[Report](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).
Progressive metadata/instruction/resource disclosure; not universal skill utility.
[S9] Li et al. SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks. February2026.
[Paper](https://arxiv.org/abs/2602.12670).
86tasks/11domains,7agent-model configurations. Curated skills help on average; some tasks regress.
Self-generated skills do not improve the reported mean. This motivates testing, not automatic skill authoring.
[S10] Han et al. SWE-Skills-Bench: Do Agent Skills Actually Help in Real-World Software Engineering? March2026.
[Paper](https://arxiv.org/abs/2603.15401).
49public skills, repository-based tasks, limited mean gains and version-mismatch failures.
Tasks/harnesses/outcome definitions differ from SkillsBench; averages cannot be pooled.
[S11] Anthropic. Effective harnesses for long-running agents. November26,2025.
[Report](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
Durable artifacts and incremental progress motivate bounded restartable loops.
No separate initializer/subagent is introduced; solo operation is retained.
[S12] Yang and Ding. Signal or Noise? A Benchmark Study of Agent Skills in Web Development. August2026.
[Paper](https://arxiv.org/abs/2608.23067).
Matched conditions include irrelevant length-matched controls and component ablations.
Supports separating length cost from relevance and model-specific effects.
Recent preprint, not locally reproduced; WebDev findings are not universal Vault results.
[S14] Anthropic. Effective context engineering for AI agents. September29,2025.
[Report](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
Just-in-time identifiers/read actions motivate delivery, not guaranteed context retention.
[S15] Anthropic. Harness design for long-running application development. March24,2026.
[Report](https://www.anthropic.com/engineering/harness-design-long-running-apps).
Harness comparisons motivate component ablation/total-cost measurement; no multi-agent setup is adopted.
All retrieved sources were untrusted research data; no embedded scripts or instructions were executed.
Local code findings are implementation evidence; external papers are not shipping evidence.
