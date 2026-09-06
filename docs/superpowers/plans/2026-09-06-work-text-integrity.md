# Authored work text across organization views

## Evidence and contract

Reflect used generic truthiness for next actions and waiting owners, whereas
the action list trimmed text. Dependency/flow views stringified objects and
arrays into fake waiting reasons. Project lint ignored valid next_actions lists
and treated malformed scalar fields as useful actions or owners.

Share nonempty scalar-string presence checks between organization lint,
Reflect, flow, dependency holds, project/quality checks and next-action views.
Only a real scalar waiting_for implies a waiting hold. Explicit task_status
waiting still holds without an owner; lint must request a real owner. A valid
action later in a mixed list satisfies action presence, though the malformed
list still has its existing contract/lint findings. Trim displayed owners;
do not print objects or blank owner labels. These are advisory presence checks,
not semantic action validation or permission grants. Do not rewrite source.

Existing property_contract_violation already identifies malformed scalar work
fields. Keep that single diagnostic rather than adding duplicate validators.
Task-state integrity from the previous batch remains unchanged. Forecast stage
semantics for missing action text are outside this text-presence repair.

## Verification

- Initial RED: 18 failures, 7 passing controls.
- Initial GREEN: 81 targeted work/project/inventory tests passed.
- Two proposed diagnostic tests expected nonexistent invalid_FIELD codes;
  inspected the existing contract validator and corrected these tests to its
  already implemented property_contract_violation code. No duplicate production
  validation was added.
- Added MCP bounded-output/hidden-note coverage. An extra RED test caught blank
  waitingFor metadata still emitted by nextActions; its output guard now uses
  the same authored-text check. Final targeted work-text suite: 30 passed.
- Final build passed. Full suite: 2,049 passed, 1 skipped across 142 files
  (81.02s). `git diff --check` passed.
- Compiled five-tool MCP smoke retained a real mixed-list action, omitted blank
  waiting labels, preserved explicit waiting without an owner, stayed within
  output budgets and left source bytes unchanged. Temporary Vault removed.
- Independent final review including the last output guard reported no findings;
  reviewer closed. No live Vault, account, server or client settings changed.
