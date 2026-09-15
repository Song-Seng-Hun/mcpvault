---
id: reviewed-skill-independent-trials
description: Preserve independent text-trial provenance through the existing release evidence gate.
keywords: [independent trial, evidence, Luna, reviewed skill, 독립 시험]
use_when: Preparing limited skill releases evaluated by a separate text-only worker.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-15-reviewed-skill-release-passport-next.md
next: 2026-09-16-reviewed-skill-independent-delivery.md
---
# Independent text-trial evidence

Starting main: 07f3975eb82edf16ea01680d52ba43cc711d73ba.
The old verifier rejected genuine independent records unless incorrectly relabeled.
Keep `current_agent_behavior` compatible; add `independent_agent_text` explicitly.
This is evidence consistency, never an admission grant or model-identity attestation.

## Bound records

- Independent case results require a trialEvidenceHash; a method label alone fails.
- Trial binds release basis, scenario set, case ID, raw input, response and judgment hashes.
- Record a reported executor ID and requested model; model identity stays unverified.
- Scope is synthetic_text_only, not live tools, account access or OS isolation.
- Main judgment binds the same input/response, reviewer, case and release basis.
- Judgment must pass and retain explicit limitations; failed/not-run is not passing.
- Legacy author-method records cannot carry independent proof and hide its origin.
- Existing byte/hash/count budgets cover the new artifacts through the shared reader.
- Existing host authority, current source and revision checks still control admission.
- Admission stores all referenced evidence and revalidates it on an idempotent retry.

Distinct labels do not prove independent identities or withheld expectations.
Matching hashes do not prove an answer's truth or that the worker actually read input.
Main must inspect real observations and source/output fidelity before registration.
Earlier failed candidates and diagnostic notes remain preserved, not overwritten.
Do not turn a normal text refusal into demonstrated prevention of real side effects.

## Verification

RED: the new positive independent fixture failed on the previous verifier.
GREEN: 32 tests across evidence, admission and passport files passed; build passed.
Admission tests use temporary files and simulated Windows ACL checks, not live grants.
Full regression e passed: 525 files, 7,074 passed, 4 skipped; d is historical after source edits.
Basis: `1d3e5b6befe0a121478638e48df6c105f07acd7b83a41e0077d3ae6bc94f4152`.
Run: reviewed-independent-text-20260916-e; 525 test files discovered.
Writing v3 raw-trial package passed consistency and 6 negative controls; see next record.
Package: [writing v3](2026-09-16-reviewed-writing-v3-package.md); no host admission/live availability.
No denied access-file retry, new listener, account change, bundle execution or model call.
Code delivery verified: [delivery](2026-09-16-reviewed-skill-independent-delivery.md). Live skill gates remain separate.
