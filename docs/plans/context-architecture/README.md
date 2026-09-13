---
id: context-architecture
kind: implementation-plan
description: Approved chaptered context, dense English, routing, migration and optional librarian.
keywords: [context, chapters, English, Korean, Caveman, routing, librarian]
status: implementing
---
# Context architecture

Use executing-plans inline and TDD. No agents or new worktrees.
User approved 2026-09-13. Baseline: `4607bc233` on existing `main`.
Goal: reduce cumulative context without losing evidence or authority.
Original Markdown, exact revisions and current access remain authoritative.

## Chapters

- [1. Content contract](01-content.md): source, chapters, language, precedence.
- [2. Migration](02-migration.md): inventory, generation, cutover, recovery.
- [3. Routing and work](03-routing.md): discovery, APIs, receipts, hooks.
- [4. Automation](04-automation.md): repeated mistakes and small librarian.
- [5. Evaluation](05-evaluation.md): frozen corpora, quality and cost gates.
- [6. Execution](06-execution.md): ordered milestones and release gates.
- [7. Source chapter use](07-source-chapter-use.md): first read-only P1 slice.
- [8. Source review](08-source-review.md): pinned Caveman and hook limitations.
- [9. Librarian preflight](09-librarian-preflight.md): dependencies and artifact caveats.
- [Execution record](status.md): current work, evidence and limitations.

Read only the chapter needed now; follow its previous/next links as needed.
Plan chapters, metadata and blank lines must fit 50 physical lines each.
Code, machine formats and preserved originals are not physically fragmented.
Do not treat implementation, deployment and activation as the same milestone.
