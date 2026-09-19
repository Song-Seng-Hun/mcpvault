---
id: evolution-endpoint-manual
kind: procedure
description: Use bounded feedback and cycle endpoints without assuming authorization.
keywords: [evolution.feedback, evolution.cycle, evolution.context, reconcile, 피드백]
use_when: Recording a concrete correction or checking an already prepared cycle.
parent: index.md
previous: host.md
next: validation.md
---
# Workflow

Start: `evolution.cycle {op:"diagnose"}`. Missing host connection stays diagnostic.
Record feedback with target, scope, task/session, concrete key/value and evidence revisions.
Optional cause: search, knowledge, procedure, expression, environment, tool_failure, unknown.
No transcript, private reasoning or credentials. Cause labels are not authority.
Unattested input stays agent_report; it cannot self-promote a preference.
Human explicit correction may prepare a cycle. Inferred preference needs three
independent interactions/tasks in 30 days across two sessions.
Attested concrete non-persona task corrections also require pinned source evidence.

Cycle: prepare(feedbackIds) -> advance(candidate) -> check -> preview -> apply.
Writes require requestId, expectedRevision, capability and current host authorization.
Apply also requires the exact preview fingerprint. Reconcile uncertain writes; do not reapply.
Read/list return state, output revision and bounded evaluation metrics, never raw candidates.
Effect needs an opaque host useToken for a different task and session with the actual revision.
Withdrawal hides associated context immediately; exact-result persona revert is separate.
No native rollback adapter means review, not a generic file overwrite.

Example: a verified project correction requests verbosity=brief.
After evaluation/application, `evolution.context {project:"example"}` provides the overlay.
Current explicit request and scene settings outrank the optional overlay.
Persona keys: verbosity, tone, ordering, language; no identity or safety edits.
Conflicting same-scope values require withdrawal/clarification, not latest-wins.
Context checks the newest 32 cycles, returns at most five preferences and five changes.
`partial` means incomplete; no broad completeness or task-version-pinning claim.
Default JSON budget 4,000 chars; explicit expansion 12,000; continuation retains exact IDs.
Cycle lists page ten records; retain expectedIndexRevision for continuation.

Procedure discovery: `wiki.search {query:"review",resultKind:"procedures"}`.
Continue with returned nextCursor as cursor, same query and authenticated scope.
Strict note filters are not relaxed. Cards are procedures, never factual evidence.
Expired/changed cursors require fresh search; explicit skill.resolve remains available.
