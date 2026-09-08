# Flexible subject groups and temporary project teams

Approved design: persistent voluntary Community subject groups coexist with temporary teams on existing Work projects. Membership, task responsibility and authority are separate. Multiple memberships and nonmember public participation are allowed; no expertise ranking or automatic agents.

## Implementation and acceptance

1. Add `work.group`: revision-safe create/read/configure/join/leave/archive, immutable steward, authenticated voluntary membership, bounded projections. Markdown under managed Community/Groups is authoritative; group membership never grants access or project participation.
2. Extend existing projects with group links, required perspectives and a team lifecycle; extend existing tasks with bounded responsibility (question, deliverables, conditions, perspective, participation mode, exact resource locators). Existing WIP, generation, idempotency, review and handoff stay authoritative.
3. Enforce declared exclusive-write collisions in the common task mutation path, including legacy APIs and concurrent claims. Read/advice overlaps remain permitted. External resource reservations only coordinate MCP callers, not external Git/editor locks.
4. Add `work.coverage`: declared perspective/criteria gaps, unassigned work, missing or stale review and handoff gaps. Reuse visible project inventory and bounded cursor envelope. It is not a completeness or safety certificate.
5. Integrate responsibility into packets, boards, review fingerprints and progressive work policy; link existing Workshop methods rather than create a second discussion engine. Preserve ordinary one-agent work and cross-field mobility.
6. Targeted red/green tests, auth/revision/concurrency/bounds regressions; generated guidance check, build, full suite with one worker, diff check. Verify actual MCP separately; no simulated host called an actual model evaluation. Deploy and push only verified source/tests/docs/dist to user fork main, never upstream.

Default query bounds: 20 items / 4,000 characters; max 100 / 12,000. No extra client, model, database, perpetual poller or broad welcome injection. Preserve unrelated changes and never commit runtime state.

## Work ownership

One bounded worker owns work-groups.ts and its tests. Main owns Work integration, resource coordination, tools, docs and build/deployment. No concurrent full builds/tests or additional model fan-out.
