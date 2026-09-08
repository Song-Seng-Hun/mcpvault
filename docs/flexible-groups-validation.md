# Flexible groups validation (2026-09-09)

## Automated evidence

Five initial regressions failed before implementation: missing team declarations,
ignored responsibilities, both exclusive claims succeeding, silent active-role
changes, and absent coverage. All passed after implementation.

Independent static review found five more failures. Each was reproduced RED,
fixed, verified GREEN and inspected again by the reviewer:

- Hidden tasks retain reservations without revealing their identity in reports.
- Hidden/missing references do not trap members trying to leave a group.
- Large group arrays have progressing field/cursor reads at the maximum budget.
- Reference guards bind the same snapshot whose visibility was validated.
- Legacy task reads filter now-hidden responsibility resource locators.

Targeted Work service/integration/schema/group/responsibility/pulse/coordination
tests passed before hardening (97 tests). The five review regressions passed
after hardening. Build and guidance consistency checks passed: 3,762 definitions,
zero pending bindings.

Final full regression: `npm test -- --maxWorkers=1` passed all 316 test files:
4,134 tests passed, 2 skipped (4,136 total), in 665.57 seconds. The earlier full
run exposed a policy-version fixture still expecting 37; it was corrected to 38
before this complete rerun. `npm run build`, `npm run guidance:check` and
`git diff --check` also passed. Skipped tests are not counted as verified.

## Limits

Protocol tests use isolated temporary Vaults and fixture accounts, not actual
Gemini/Claude/Codex behavior. The existing three-client cooperation test exercises
requests, review and completion; it does not measure spontaneous cross-field
dialogue or the quality of a game project. That model-level experiment has not
been run for this change. Static review is not a separate test execution.

No live memberships, tasks, accounts, diaries or projects are migrated. Exact
resource declarations coordinate one shared server's Work callers, not external
editors, repository aliases or distributed servers. Direct Markdown edits can
invalidate workflow invariants and never confer authority or generate approvals.

## Deployment preparation

Live guidance preview: 3,708 unchanged definitions, 54 new, no collisions or
overwrite of user edits. The prior committed `22e1b536` build is retained in a
host-local rollback archive. Runtime backups are excluded from source Git.

## Actual shared-server verification

Applied the 54 new guidance definitions without overwriting existing entries.
The subsequent read-only preview reports all 3,762 definitions unchanged.
The shared HTTP server was restarted using its existing scheduled task and
configuration. A transient port-release delay prevented the first launch; after
confirming the port was free, the task started successfully. One listener on
127.0.0.1:8788 runs the new `dist/server.js` against the intended Vault.

The current Codex MCP connection discovers both `work.group` and `work.coverage`.
Anonymous group reads are available while create/update/join/leave/archive
remain authentication-locked. An actual `wiki.policy` work-topic call returns
version 38 with both new routes and the group/responsibility guidance. No Codex
restart was required for this final connection check. Live write behavior was
not exercised with production accounts; mutation coverage above is isolated
protocol/service testing, not an actual multi-model cooperation experiment.
