---
id: memory-five-layer-map
kind: architecture-guide
description: Map working, episodic, semantic, procedural and forgetting behavior to owners.
keywords: [five layers, working, episodic, semantic, procedural, forgetting, 기억계층]
use_when: Selecting memory or checking which layer owns a behavior.
position: Reading guide before disk storage; roles do not mandate loading all layers.
parent: 2026-09-20-memory-flow.md
previous: 2026-09-20-memory-flow-contract.md
next: 2026-09-20-memory-storage.md
---
# Five layers, one selective read path

| Layer | Existing owner and current behavior |
| --- | --- |
| Working (작업) | Work/continuity: current objective, decisions, open issues and pinned reads. Resume points here; do not copy every past episode. |
| Episodic (사건) | Journal/memory entries: observed time, circumstances, attempts and outcome. Retrieve matching incidents, not whole transcripts. |
| Semantic (의미) | Scoped facts/lessons with source revisions, conditions and corrections. A past preference is not an eternal fact. |
| Procedural (절차) | Applicable procedures and reviewed skills. Reading or repeated success grants no execution permission. |
| Forgetting (제공 관리) | Expiry, correction and historical-state filtering plus bounded caches. Remove stale presentation, not authoritative originals. |

These are roles and lifecycle behavior, not five duplicated stores or prompts.
The original `core` and `resource` roles remain compatible.
Self-contained work may need no optional memory. Mandatory rules still apply.
An incident can inform a lesson, but cannot silently become a universal procedure.

## Example: failed deployment

1. Working memory points to the active deployment and unresolved check.
2. Episodic recall finds the matching host/version and recorded failure.
3. Semantic recall checks current constraints, corrections and supporting sources.
4. Procedural recall selects an applicable verified procedure, if needed.
5. Presentation drops superseded advice; exact historical reads remain available.

One shared packet budget covers every selected layer and its next-read actions.
SQLite narrows candidates; current access and source revisions are rechecked.
Consolidation produces a grounded worksheet; existing evolution/compilation owns
comparison, managed application, reread and revision-safe reversal.
Exposure receipts are not retention proof. Unknown hosts receive current content.

## Evidence boundary

Layer separation alone proves no token saving or learning improvement.
Measure unnecessary recall, missed conditions, corrective rereads and total cost.
Actual model tokens and next-session effects remain separate from server timings.
This map does not authenticate the attributed "13-page PDF" or a 90% saving claim.
