---
id: retrieval-state
kind: implementation-plan
description: Orthogonal state and gap-driven bounded retrieval.
keywords: [state machine, agentic RAG, budgets, 상태]
parent: README.md
previous: 03-storage.md
next: 05-skills.md
---
# State and exploration
Use: R3/R5 request execution. Not: a state for every language/account/project combination.
Orthogonal axes: task phase, retrieval progress, freshness, retained context and resources.
Flow: request -> authorize -> plan -> retrieve -> verify evidence -> deliver.
A concrete evidence gap may return to planning within the remaining budget.
Event precedence: permission revocation -> cancel -> invalidation -> budget -> progress.
Use request/event IDs and state revisions for replay, restart and concurrent mutation.
Agent proposals cannot attest authorization or successful completion.
First response: default4000 characters and3s server-processing budget.
Explicit expansion: up to12000 characters,2 extra rounds and6 read/search actions.
Cumulative server-processing expansion budget:15s.
Measure agent-model and transport costs separately; they are not free.
Check cancellation/budget before scheduling and between bounded work units.
Late or cancelled results cannot advance delivery or completion state.
New action must add a source, resolve an entity, check a condition or test a contradiction.
Stop repeated searches with the same scope and evidence.
Select direct, lexical, hybrid or graph work using the known gap and measured cost.
No new resident model or automatic web/cloud fallback.
Cancel owned work only; cancellation and partial coverage are not successful absence.
A continuation binds basis, scope, generation, spent budget and unresolved gaps.

## Tests
Duplicate events, restart, state CAS, revocation races and cancellation.
Repeated no-gain plans, exhausted budget and unsupported host observations.
Example: ambiguous name -> one bounded disambiguation, not another identical hybrid query.
