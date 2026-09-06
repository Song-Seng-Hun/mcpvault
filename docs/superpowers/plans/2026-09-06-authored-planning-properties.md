# Authored Properties, not truthiness, drive planning and quality

## Evidence and contract

Project planning treated objects and whitespace as purpose/outcome; list length
made empty next-action/support entries look useful. Quality had the same
coercion in work/MOC text, and accepted invented operational/epistemic states.
Project detail reads carried a revision beside, but not inside, the read action.

Require nonempty strings in these advisory projections. Trim/filter list entries
before preview limits. Preserve meaningful later entries and exact Obsidian
links. Omitted malformed details get a guarded read; never rewrite source data.
Invalid explicit project task_status must not imply execution readiness;
absent status still defaults to open. Quality requires a valid declared task
state and uses the existing kind-specific epistemic normalizer. These remain
authoring hints, not factual proof or publication gates. Work classification,
dependency graph semantics and other work-view eligibility are separate scopes.

## Verification

- Reproduced 29 failing cases/assertions before production changes; 64 existing
  cases passed. Array-valued fixtures are explicit rows, not spread arguments.
- Initial targeted service/packet tests: 93 passed. Actual MCP project read
  actions reject changed sources; compact actions retain the same guard.
- Added positive mixed-list and normalized valid-state coverage.
- Review exposed terminal experiment checks still coercing array-valued states:
  three RED tests, then reuse the validated normalized state for follow-up checks.
  Two more RED tests covered array-wrapped uncertainty and interpretation labels.
- Final targeted quality/project/MCP suites: 147 passed.
- Final build passed. Full suite: 1,996 passed, 1 skipped across 140 files
  (78.11s). `git diff --check` passed.
- Compiled five-tool MCP smoke passed in an isolated temporary Vault:
  malformed project Properties do not imply readiness, valid mixed actions and
  absent-state defaults survive, stale detail reads reject revision conflicts,
  and array-valued experiment states do not trigger terminal follow-up checks.
  Read-only projections preserved source bytes. The temporary Vault was removed.
- Independent final review reported no concrete findings after the fixes.
- No live Vault, account, server configuration or client registration was changed.
