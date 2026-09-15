---
id: reviewed-skill-progress-contract
description: Fixed denominators and outcome-based reporting for all-skill review and activation.
keywords: [metadata, activation, progress, percentage, 완료율, 활성화율]
use_when: Ending a goal turn or deciding the next skill-review task.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-metadata-wave20.md
next: 2026-09-15-reviewed-skill-release-passport-next.md
---
# Progress reporting contract

User instruction: report both metadata completion and actual activation after every turn.
Do not substitute file count, model calls, test count or token use for delivered outcomes.

## Stable denominators

- Inventory baseline: 1,610 entries. Keep this denominator for both headline percentages.
- Metadata numerator: ordinary entries with all discovery fields reviewed or explicitly unknown.
- Source, references, seven impact axes and examples must be tied to reviewed source bytes.
- Two test fixtures remain separate; they are not completed ordinary skills or activations.
- Activation numerator: reviewed versions with current authorized runtime search/read verified.
- A passport, static pass, successful text trial or prepared file is not activation.
- If inventory changes, state the change explicitly; do not silently shrink the denominator.

## Required turn-end report

Report metadata `count / 1,610 (percentage)` and activation `count / 1,610 (percentage)`.
Also report each numerator's change this turn, remaining metadata, fixtures and blockers.
Percentages use unrounded counts and round to two decimals only for display.
Example: 154 ordinary reviews / 1,610 = 9.57%; 0 activations / 1,610 = 0.00%.
That example leaves 1,454 pending entries and two fixtures; it is not 154 usable skills.

## Execution decisions

Prefer work that advances these outcomes, not repeated reports or same-case wording tweaks.
A candidate repair failure remains visible; do not inflate counts by rebuilding its package.
Use bounded, least-cost helpers for separable drafting or checks when they save main-path time.
Main verifies source coverage and integrates findings; helpers cannot approve runtime access.
Do not bypass a rejected host grant or weaken safety gates to improve activation statistics.
Continue other actionable entries when one candidate is held.
No completion-date promise without measured throughput and a feasible activation path.

## Evidence

Metadata counts come from the explicit, hash-pinned work-index generation and all its pages.
Activation requires separate live receipts and current authorization, not the metadata index.
Record the generation, numerator deltas and next concrete action in the private checkpoint.
This reporting rule grants no execution, installation, publication or account privilege.
