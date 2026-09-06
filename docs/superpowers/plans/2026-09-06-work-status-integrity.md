# Work status integrity across execution projections

## Evidence and contract

The previous project/quality fix did not cover dependency forecasts and action
selection. An array-valued `task_status: [completed]` satisfied a prerequisite;
unknown states executed, and whitespace-padded waiting/blocked states bypassed
the action list's untrimmed comparison. Such notes also disappeared from repair
views through generic string coercion in open-work classification.

Use one read-only authored task-state interpretation. Only absent state defaults
to open; valid scalar strings are trimmed/lowercased. Everything else is the
derived marker `invalid`, not a new authored status. Invalid work stays visible
for repair but cannot execute, satisfy dependencies or enter forecast stages.
Propagate its existing workflow hold through the dependency graph. Reflect and
flow expose the repair reason, lint reports the malformed declaration, and
project packet uses the same state interpretation. Never rewrite source data.

Waiting/action text validation beyond the prior project checks and non-task
status vocabularies remain separate issues; this batch does not claim to fix
every malformed Property or to verify that authored work actually completed.

## Verification

- Initial RED: 14 failures and 1 valid-scalar control passing.
- Initial GREEN: 125 targeted work/status/project/quality cases passed.
- Added MCP bounded-output/hidden-note checks, Reflect repair visibility,
  and lint checks that malformed completion creates no completion obligations.
- Review found two remaining coercion paths in full lint completion-reference
  validation and project waiting-owner checks. Three additional RED cases
  reproduced them; both now use the shared interpretation. Targeted: 23 passed.
- Final build passed; full suite: 2,019 passed, 1 skipped in 141 files (80.25s).
- Isolated compiled five-tool MCP smoke confirmed that invalid completion cannot
  execute or release a child, with bounded output and repair diagnostics. A
  final compiled-service smoke also checked full lint's completion obligations
  and unchanged source bytes. Both temporary Vaults were removed.
- Final independent review: no findings. Reviewer closed. `git diff --check`
  passed. No live Vault, account, server or client configuration was changed.
