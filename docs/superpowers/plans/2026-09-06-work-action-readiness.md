# Authored actions gate execution forecasts

## Evidence and contract

An unfinished actionless project could enter stage 0, and a next_action status
alone counted as active WIP. Project readiness separately missed future defer
holds. Use the existing authored-action predicate and request-local dependency
plan, not a second scheduler or new persisted status.

- Unfinished work needs a nonempty string next_action or next_actions entry.
  Otherwise it and downstream work stay off execution stages.
- Waiting, blocked, dependency-blocked and deferred lanes keep precedence.
  Otherwise actionless work is blocked with missing_next_action and
  needsNextAction, without inferred age or mandatory timing metadata.
- Completed prerequisites remain satisfied. Editing the source action
  recalculates the forecast without mutating dependent notes.
- Project execution.ready uses captured stage 0 and dependency eligibility.
  Structural presence never proves action feasibility or safety.
- Preserve access filtering, bounded output, exact identities and revisions.
  No live Vault changes, new endpoint, or source mutation on reads.

## Verification so far

- Initial RED: six failures and one completed-prerequisite control passed.
- After hold/lane changes: 84 targeted tests passed.
- Additional future-defer mismatch: one RED, seven passed; after unifying
  project readiness with stage eligibility, 50 targeted tests passed.
- Independent read-only review found no evidenced correctness issue.
- MCP boundary/flow budget/project packet tests: 26 passed. Strengthened MCP
  coverage at 512, 1024 and 16000 characters: full flow counts at supported
  budgets, explicit bounded retry at 512, no hidden identities/counters,
  dependency reason precedence, and false project readiness retained.
- First full run: 2,061 passed, one failed, one skipped. The focus-relation
  repair test had unrelated actionless project fixtures, now legitimately
  higher-priority workflow repair. Added real actions to those two fixtures
  without weakening the original relation-repair assertion. Targeted rerun:
  102 passed. Final full rerun: 2,062 passed, one skipped across 143 files
  (84.41s). Fresh build and git diff --check passed.
- Build and compiled isolated five-tool MCP smoke passed: actionless chain
  held, future-deferred project not ready, source reads non-mutating, and
  action repair restoring stages. No running server or real Vault modified.

Existing age fallback behavior for explicitly waiting/blocked work is not
changed by this patch; this fix only avoids invented age for missing-action
repair. Do not describe the entire flow measurement system as redesigned.
