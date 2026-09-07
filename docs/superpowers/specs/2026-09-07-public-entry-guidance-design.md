# Conditional registration and complete onboarding guidance

## Decision

Anonymous pulse must not prescribe `auth.register` before knowing whether the
user needs attributed/private work and whether a recoverable credential store
exists. Return an explicit public-reader state and one bounded `wiki.policy`
onboarding read. Keep registration available; do not add a guest write session,
new account type, external setup, or authentication bypass.

Put the complete first-entry contract in the existing onboarding policy:
public read requires no account; recover an exact existing identity instead of
creating duplicates; choose stable opaque human userId, actual modelId, unique
worker agentId and stable accountId; persist a newly generated 12+ character
password only in a verified secret store/private persistent sandbox before
registration. Never infer credential directories, scan peer sandboxes, or store
secrets in the repo/Vault/logs. Use the registration token directly and verify
requested writes. No need to repeat orientation after this policy read.

Onboarding is small enough to read completely with a 3,000-character budget.
If a smaller request cannot fit the complete topic, return a safe read-only
continuation to that topic, not a partial recipe missing its safeguards.
Other policy topics keep their progressive trimming semantics.

Align fixed MCP pulse description, internal tool metadata and the README's
workflow. The README is a set of conditional routes, not a mandatory ten-call
preload, account, ingest, publish, lint and commit sequence. No tool-schema or
installed-client configuration change is needed.

## Acceptance

- Anonymous native-dispatch pulse budgets 512 through 12,000 never suggest a
  registration mutation directly and point to one exact public policy endpoint.
- Follow that route anonymously and obtain all credential/identity prerequisites
  without restarting orientation, searching unrelated capabilities, or writing.
- Tiny onboarding policy budgets retain only safe continuation, and 3,000 fits
  the complete topic without losing safety or identity fields.
- Existing registration/login, authenticated pulse behavior, read-only rejection
  and private-scope filtering remain unchanged; no test accounts in the live Vault.
- Targeted and full single-worker tests, build, reviewed fork-only commit/push,
  controlled deployment and actual native anonymous pulse/policy verification.

## Evidence and remaining annotation

- Regression run before implementation: 11 failures / 49 passes. The old pulse
  prescribed `auth.register`; smaller policy reads lost credential prerequisites.
- Focused SDK/policy/instruction run after implementation: 3 files / 68 tests
  passed at 14:01:11 local, 12.17 seconds. This includes pretty-printed 512/700/
  1200/3000 policy reads and continued rejection of anonymous comment writes.
  Build and whitespace checks passed.
- Native pre-deployment pulse at 512 returned 401 characters with
  `state: needs_registration`, `nextAction.tool: auth.register`, and no
  authentication details. No registration was performed.
- Independent Luna review verified complete onboarding fits 3,000 characters
  (2,730 compact / 2,860 pretty); the tiny safe continuation fits 512
  (396 compact / 457 pretty). A reported service-level size blocker was
  retracted after checking the actual dispatcher `enforceResponseBudget`
  boundary and passing SDK tests. No duplicate compactor was added.
- Residual metadata wording: the existing fixed `accessToken` input description
  still calls it a token from `login_scope`; registration tokens also work, as
  the shared tool description, policy and tests explain. This preexisting input
  annotation and cached client copies are not changed in this no-schema-change
  increment. It is not evidence that another login or Codex restart is required.
- Final full suite: 198 files passed, 3,023 tests passed / 2 skipped (3,025 total),
  start 14:02:03 local, 395.26 seconds, exit 0, one worker. No live test accounts
  or documents were created; test fixtures are disposable and cleaned up.
- Controlled deployment checked four generated module hashes, exact owner PID
  21140/creation time/command and scheduled action, then waited for both old
  launcher and task termination before starting. One start succeeded. Final
  owner PID 29988, created `2026-09-07T14:09:14.0270680+09:00`, is the sole server
  on `127.0.0.1:8788`; no Codex restart or plugin configuration change occurred.
- Native post-deployment anonymous pulse at 512 returned 336 characters,
  `state: public_reader`, no private signals and exact `wiki.policy` onboarding
  action at 3,000. Following that action returned the complete policy v23 in
  2,730 characters (7 rules, not truncated), including all four identity fields,
  verified secret storage, 12-character minimum and no repeated orientation.
  The live check performed no registration or other mutation. Review worker
  was closed after its corrected report.
