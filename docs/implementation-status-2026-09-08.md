# Handoff implementation checkpoint

This checkpoint tracks the two approved plans without treating a catalog, a
unit test or a recorded proposal as a completed product rollout.

## Implemented foundation

### Meeting facilitation

- Optional persisted managed Workshop configuration and 16 method catalogs.
- Structured submissions, explicit current steps, actual-account participation,
  revision guards, handoff/revocation, bounded reads and mutation retry records.
- Counted contribution/evidence guards through transition commit, serialized
  submission admission, same-account checklist repairs, and preservation of
  manually authored content around the generated block.
- Dynamic `workshop.methods`, `workshop.facilitation`,
  `workshop.facilitation_update`; fixed MCP surface remains five tools.
- Workshop Canvas preview/export through the existing scope-local, fingerprinted
  `wiki.canvas_view` and `wiki.canvas_export` flow.
- Progressive policy, schema, client guidance and method documentation.

### Experimental quest economy

- Nontransferable reputation and spendable XP separated; host-approved owners.
- Fixed-supply pure reducer, escrow, independent review and bounded owner WIP.
- Exclusive journal writer, replay/integrity checks, external checkpoint,
  permanent retry IDs, aggregate byte admission and shutdown barrier.
- Dynamic wallet/market/contract/review adapters over the common service.
- Existing Work claim bridge, exact current Work receipt/generation binding,
  suspended payout/refund on divergence, no-config downgrade prevention.
- Fixed prose-literal mechanical verifier, never arbitrary code execution.

## Not completed by this checkpoint

- Meeting delegation's exact project/action authorization and stable-ID
  Decision Record / Work task creation with resumable output receipts.
- Complete method-specific structural/completion predicates, terminal closure,
  and comparative 12-case actual
  model evaluation (the catalogs describe intent; the server checks structure,
  not truth, human psychology or deliberative quality).
- Economic operator provisioning/recovery workflow, host-local storage probe,
  seven-day escalation/admission rules, treasury operating budget and paid Work
  projections/participation integration.
- Actual multi-host/model behavioral evaluation and process-kill/power-loss
  durability testing. MCP InMemoryTransport tests are protocol tests only.

Keep the live economy disabled. Financial tests use temporary vaults and fake
accounts, never a live allocation. See [quest deployment gates](quest-economy.md)
and [meeting workflow](meeting-facilitation.md). Continue the remaining plan
from these gates; do not restart the design or silently mark them delivered.

## Verification on 2026-09-08

- `npm run build`: passed using the production `tsconfig.build.json`.
- `npm test -- --maxWorkers=1 --testTimeout=15000`: 290 test files passed;
  3,888 tests passed and 2 skipped (3,890 total), 652.36 seconds.
- The first full run exposed the oversized packaged skill and stale policy/
  Canvas schema expectations. The skill was shortened without raising its
  9,000-character limit; the expectations were updated to the new contracts.
- Added regression coverage reproduced completion-evidence races, manual text
  loss, late submission admission, checklist repair and a tiny-budget empty
  catalog continuation before verifying their fixes.
- `git diff --check`: passed. Build/test execution was sequential; the final
  suite used one worker and BelowNormal process priority.
- The existing shared HTTP task was restarted with the tested build. Current
  Codex MCP discovery and `workshop.methods(methodId="brainwriting")` succeeded.
  `quest.market` returned the expected disabled-economy error. No live account,
  workshop, wallet allocation or financial event was created for this check.
- Source review and protocol/automated tests are not the pending 12-case
  actual-model meeting/economy comparison, nor a power-loss durability test.
