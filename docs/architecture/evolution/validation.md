---
id: evolution-validation-index
kind: evaluation-plan
description: Separate synthetic correctness, agent behavior and operational effectiveness.
keywords: [evolution, holdout, baseline, cost, regression, 검증]
use_when: Preparing an operational candidate or reporting implementation results.
parent: index.md
previous: endpoints.md
next: cases-persona.md
---
# Evidence classes

Engine tests existed before this freeze; they are not an independent quality trial.
The following cases are frozen before operational candidate generation, not retroactively.
Per target: three development tasks, four misuse cases, three held-out tasks.
Keep holdout prompts/answers outside generator input; profiles expose IDs only.

| Target | Fixed cases |
| --- | --- |
| Persona | [Expression](cases-persona.md) |
| Wiki | [Source-preserving knowledge](cases-wiki.md) |
| Skill | [Reviewed procedure](cases-skill.md) |
| World | [Fiction](cases-fiction.md), [computer](cases-computer.md) |

Compare baseline/candidate; skills additionally compare no skill.
Safety, current permission, original preservation and existing successes are mandatory.
Require target failure resolution or measured cost reduction at unchanged quality.
Record sample count, retries, user re-corrections, elapsed time and input tokens.
Unknown metrics stay null. No static text overlap implies behavioral success.
Method: static / synthetic / agent_behavior / operational; absent provenance is unreported.
Applied output and next-use success need separate receipts and current rereads.
These scenario documents do not themselves implement or pass a behavioral evaluation.
No operational quality, token reduction or four-target effectiveness result is claimed yet.
Owner-service integration fixtures use disposable temporary Vaults, never real game events.
Full regression freezes source/build hashes; target fixtures do not replace that gate.
