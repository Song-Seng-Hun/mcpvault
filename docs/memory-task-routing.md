---
id: memory-task-routing
kind: manual
description: Select optional memory by task intent and inspect delivery evidence.
keywords: [memory, episode, procedure, working, 기억, 재개]
use_when: Preparing a task or checking what memory was actually returned.
position: Task-routing companion to layered-memory.md.
parent: layered-memory.md
previous: layered-memory.md
next: plans/2026-09-20-memory-flow.md
---
# Task-aware memory

Legacy calls retain their defaults. `taskContext.intent` is an optional hint.
It never grants access, verifies truth or changes mandatory project/security rules.

| Intent | First optional material |
| --- | --- |
| self_contained | None, unless explicit search/filter/history was requested |
| resume | Existing continuity action, unless explicit retrieval was requested |
| procedure | Applicable procedural memory before incident detail |
| past_decision | Scoped semantic decisions, then event evidence |
| incident | Episodic circumstances, attempts, outcomes and corrections |
| environment | Semantic environment facts, then observed events |

Example: `memory.brief {"scope":"personal","taskContext":{"intent":"resume"}}`.
Example: `memory.recall {"query":"NAS","taskContext":{"intent":"incident"}}`.
Use the current authenticated account. Resume still requires authentication.
Hints do not exclude other roles. Exact role, query and scope remain binding.
Task-aware reads de-prioritize expired/future entries; history is not deleted.
Changing the intent invalidates prior cursors. Follow returned exact source reads.
The default brief budget remains 2,000 characters for the whole JSON packet.

## Operational evidence

If configured, begin an `evolution.context` task and pass `evolutionTask` plus a
unique `evolutionRequestId` to memory reads or `continuity.resume`.
Read observations using `evolution.context` with `op: observations` and task ID.
Receipts keep hashes, revisions, returned character counts and excerpt ranges.
Truncated excerpts are not full-range receipts. Unread basis/future actions are
not counted as delivered resources. Bodies, paths and query text are not logged.
Server delivery does not prove model retention, use, understanding or effect.
No configured observer: ordinary authenticated reads still work.

The fixed 60-case routing fixture tests explicit hints, not intent inference,
embedding quality, independent model behavior or actual token savings.
Its verification cases are public regression data, not secret holdout evidence.
