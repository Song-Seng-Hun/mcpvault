---
id: context-architecture-routing
kind: implementation-contract
description: Select relevant tools and chapters; verify work preparation and completion.
keywords: [hybrid, RRF, context-route, context-session, hooks]
parent: README.md
previous: 02-migration.md
next: 04-automation.md
---
# 3. Routing and work

Current ACL/runtime/explicit query filters precede metadata and top-k selection.
Exact identifiers favor lexical search; retain multilingual-e5-small.
Optional semantic search: <=20/channel, equal RRF k=60, lexical fallback.
Expand explicit prerequisite/counterpoint edges one hop; deduplicate source family.
Read current selected evidence. Important omissions return partial + exact read.
Quotes/exclusions/structured filters are never weakened by routing or a model.
Approved applicability differs from inferred relevance; relax soft routing once
on empty/conflicting results, never ACL or explicit constraints.

## Interfaces

Keep the fixed five MCP tools and existing schemas/enums/error identities.
Add read-only wiki.context_route: task/intent/location -> compact entry packet.
Add wiki.context_session prepare/read/update/check/finish; persist through
existing task/continuity services, with request IDs and expected revisions.
Read/check remain available read-only; operation-level mutations are denied.
Extend documents.*, wiki.policy, guidance.catalog and capability discovery.
Extend wiki.compilation bundle status; reuse feedback and exception board.
Packets carry basis, selected IDs, requiredReads, nextAction and partial.
Basis pins rules/access/catalog/documents; no prose translation of machine data.

## Work protocol

Changes/deployment/multi-step work require goal/scope/non-goals, concise plan,
context facts/constraints/decisions, required rule revisions, checklist and results.
Simple reads do not create compulsory tasks. Never persist hidden reasoning.
Reading receipts cover actual returned ranges only; drift invalidates affected ones.
Read receipt is not understanding or verification. Finish checks actual changes.

## Host hooks

Test installed Codex events without user data before enabling exact coverage.
SessionStart/PostCompact resume; UserPromptSubmit route; PreToolUse checks writes;
PostToolUse records results; Stop checks once; shutdown preserves prepared state.
Plan mode diagnostic-only. Hosted WebSearch requires explicit agent registration.
Only code-owned short instructions and opaque reads enter hook context; no bodies.
Bootstrap reads/task records/recovery must not block themselves.
No claim to cover arbitrary shell, external apps or direct NAS writes.
Stop: <=1 follow-up, <=5min, one task. Never block cancellation or chain community.
