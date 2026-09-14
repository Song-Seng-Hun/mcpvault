---
id: adaptive-retrieval-04-state
kind: research-proposal
description: Statecharts for workflow guards and contextual visibility.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating statecharts for workflow guards and contextual visibility.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 4 of 14; see parent for navigation.
parent: README.md
previous: 03-scale.md
next: 05-agentic.md
status: proposed-not-implemented
---
# Retrieval statecharts

Use hierarchical states and orthogonal dimensions, not one state per condition combination.[S4]
Dimensions: task phase, retrieval progress, delivery exposure, freshness and resource availability.
Keep existing capture/explore/decide/execute/review intents; phase is a separate field.

## Transitions

Received -> Authorized -> Planned -> Retrieved -> EvidenceChecked -> Delivered.
EvidenceChecked -> Gap -> Planned requires remaining budget and a novel next action.
Any state -> Invalidated when a dependent source/rule generation or permission changes.
Any state -> Cancelled on cancellation; exhausted budget -> Partial, never fabricated completion.
Only code-owned guards admit actions; an LLM proposes plans but cannot attest that guards passed.
Record event/request ID, plan version, state revision, basis and one bounded next action.
Replay returns the recorded outcome; concurrent updates require expected state revision.
Dispatch at most one owned retrieval action at a time.
Orthogonal state regions do not require parallel workers.[S4]

## Exposure projection

Intake: applicable rule/tool index, not all manuals.
Before mutation: current safety/preparation evidence through existing services.
After mutation: changed obligations and verification actions, not repeated onboarding.
Finish: check obligations created by actual actions, not every possible workflow.
Omitted discovery cards remain explicitly searchable.
Do not remove callable tools merely because their descriptions were recently shown.
Keep fixed five MCP tools; defer only dynamic descriptions and schemas.

## Conflict order

Check revocation, cancellation, invalidation, budget, then progress in that order.
Scope change or invalid receipt restarts admission, not the whole task.
Partial output cannot mark required reading, tests or review complete.
Hook availability requires actual host-path verification, not a feature flag.
Service checks survive missing hooks, delayed completion and restart.
Example: deployment rules appear for deployment; review-only work gains no deployment permission.
See [sources](13-sources-retrieval.md); these state names/order are proposed contracts.
