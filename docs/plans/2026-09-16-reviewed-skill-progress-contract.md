---
id: reviewed-skill-progress-contract
description: Fixed denominators and outcome-based reporting for all-skill review and activation.
keywords: [metadata, activation, progress, percentage, 완료율, 활성화율]
use_when: Ending a goal turn or deciding the next skill-review task.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-metadata-wave20.md
next: 2026-09-16-reviewed-skill-metadata-wave21.md
---
# Progress reporting contract

Report actual skill outcomes, not a generic claim of progress.
Infrastructure, metadata, model calls and test counts are not activated/deleted skills.

## Stable denominators

- Inventory baseline: 1,610 entries. Keep this denominator for both headline percentages.
- Metadata numerator: ordinary entries with all discovery fields reviewed or explicitly unknown.
- Source, references, seven impact axes and examples must be tied to reviewed source bytes.
- Two test fixtures remain separate; they are not completed ordinary skills or activations.
- Activation numerator: reviewed versions with current authorized runtime search/read verified.
- A passport, static pass, successful text trial or prepared file is not activation.
- If inventory changes, state the change explicitly; do not silently shrink the denominator.

## Required turn-end report

Report metadata and actual activation percentages, plus this-turn percentage-point changes.
Report backup-confirmed deletion count and final `(activated + deleted) / 1,610` percentage.
Percentages use unrounded counts and round to two decimals only for display.
Example: three metadata reviews add 0.19 percentage points, not three usable skills.
State unverified, prepared, deployed and actually usable separately. Preserve fixed denominators.

## Execution decisions

Prefer work that advances these outcomes, not repeated reports or same-case wording tweaks.
A candidate repair failure remains visible; do not inflate counts by rebuilding its package.
Use bounded, least-cost helpers for separable drafting or checks when they save main-path time.
Main verifies source coverage and integrates findings; helpers cannot approve runtime access.
Do not bypass a rejected host grant or weaken safety gates to improve activation statistics.
Before the first actual activation, stop bulk metadata work if the common access path is blocked.
After that gate, one held candidate must not block other actionable entries.
No completion-date promise without measured throughput and a feasible activation path.

## Evidence

Metadata counts come from the explicit, hash-pinned work-index generation and all its pages.
Activation requires separate live receipts and current authorization, not the metadata index.
Record the generation, numerator deltas and next concrete action in the private checkpoint.
This reporting rule grants no execution, installation, publication or account privilege.
