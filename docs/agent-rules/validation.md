---
id: repository-validation-economy
kind: project-rule
description: Risk-scoped tests and bounded low-cost delegation without weaker safety claims.
keywords: [test:changed, Luna, regression, cost, 검증]
use_when: Selecting tests, delegating routine changes or preparing a release bundle.
position: Code/deployment companion; authority and source protection remain unchanged.
parent: code.md
previous: code.md
next: deployment.md
---
# Validation economy (검증 비용)

Preserve behavior and evidence; do not equate more tests or code with better outcomes.
During local edits run affected tests, the build and relevant safety checks.
Documentation-only edits need relevant contract/link checks, not routine full regression.
Use test:changed when available; explicit target tests remain valid.
Unknown impact, dynamic registration or common foundations must not silently select zero tests.
Batch full regression once after an engine/release bundle is frozen, not after each edit.
Auth, filesystem, common request/storage paths and dependency changes require full integration coverage.
After a correction rerun affected checks; rerun full when common foundations are affected.
Every receipt binds its actual source revision and selected scope; partial is never full.
Interrupted, skipped unexpectedly, failed or missing checks do not prove success.
Do not broaden timeouts, retry unchanged failures or disable assertions to manufacture a pass.
Keep one test process tree with the existing memory/cancellation controls.
Store detailed logs locally; expose concise scope, status, failures and evidence paths.
Keep public test commands compatible; separate performance work from correctness explicitly.

## Low-cost delegation

For authorized routine delegation use one reusable Luna worker, medium reasoning.
Verify actual model/startup; do not fork the whole conversation into the worker.
Give file ownership, protected behavior and acceptance conditions once.
Do not spawn for trivial commands or create additional reviewer agents by default.
The worker completes routine edits and targets without per-edit approval.
Main does not duplicate its investigation or reread every successful test log.
Review only ambiguous removal and authority, concurrency, recovery or data-integrity changes.
Escalate a repeated failure after one cause-specific repair/retest with reproduction evidence.
Default handoff <=4,000 chars; result <=1,200 chars plus local evidence links.
Report completion, failure and actionable blockers; avoid repeated unchanged status polling.

## Removal criteria

Remove a redundant test only with a surviving behavior check or obsolete-requirement evidence.
Check CLI, public exports, dynamic endpoints and worker URLs before deleting unused internals.
Keep isolation: shared fixture code must not share mutable test state.
Generated data, dist duplication and formatting-only line savings are separate from logic reduction.
Preserve live data, rollback releases and failure evidence; delete only owned unused temporary output.
Report net handwritten code change, wall time and output size; unknown billing savings stay unknown.
