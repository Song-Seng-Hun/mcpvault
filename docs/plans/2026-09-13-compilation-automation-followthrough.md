# Compilation automation follow-through

User approved improving the four identified automation bottlenecks after the
Arkon/graph delivery. Execute inline with executing-plans and TDD; no agents,
new branches, models, schedulers, PRs or upstream contribution. Existing main
baseline is fb6b42727cda5d3fb51a59a1b659a0be0e45dd65. Preserve seven unrelated docs.

## Design and authorization boundary

Prefer bounded existing-session execution over a new autonomous model worker.
Keep literal comparison and semantic reports separate. For natural-language
facts, exact selected source/output text can establish verbatim preservation;
paraphrase, translated or excluded spans still require review. Do not reinterpret
out_of_scope as pass. No matching number alone proves a condition preserved.

Add a host-only session coordinator for prepared jobs that calls existing read,
submit/check/retry operations for one approved job. The current host supplies
generation through its existing session, cancellation and fresh authorization;
there is no provider or process launcher. Generation returns typed bounded data,
not instructions. Resume reads existing state rather than generating/replaying
blindly. Host readiness diagnoses missing connections without claiming that an
adapter object alone authorizes automatic application.

Native Codex event trust, independent runtime attestation and actual production
path/account grants are not manufactured from client input. Current runtime
activation remains separate from tested host integration; no configuration-only
bypass is added. Actual-model quality is not established by synthetic tests.

## Execution tasks

- [x] Pin failing literal/prose tests in src/fidelity-literals.test.ts and
  real publication regressions in src/compilation-publication-adapter.test.ts:
  identical Korean/English prose without literals is preservable; changed
  condition with identical numbers, excluded code/examples, missing anchors,
  translation and revoked authority cannot be promoted to a pass.
- [x] Add bounded exact-span preservation in src/fidelity-literals.ts, keeping
  checkFidelityLiterals behavior unchanged. Use the separate result in
  src/fidelity-service.ts and src/compilation-publication-adapter.ts. Preserve
  semantic attribution and original/revision/access checks.
- [x] Add tested readiness reporting to compilation diagnosis: missing host,
  runtime or concrete checker/writer is actionable but never a grant; no paths,
  account names or hidden job counts leak through public diagnosis.
- [x] Implement and test one-session generation/verification/application in
  src/compilation-session.ts using CompilationService. Enforce one work item,
  bounded time, one refinement, current authorization before/after generation,
  no new model/worker, restart-safe existing-job handling, cancellation and
  no automatic replay over human changes. Keep it host-only, not a new MCP tool.
- [x] Record exact integration obligations and still-unverified native/model
  gates in docs/compilation.md and this execution record. Test host wiring with
  deterministic generation separately from actual-model evaluation.
- [x] Targeted tests -> guarded strict build -> frozen full regression -> solo
  review and diff checks.
- [x] Staged/content checks -> rollback-preserving NAS deployment and read-only
  live checks.

The final Git step commits and pushes this verified change on existing user-fork
main, without a PR. Confirm its delivery using the remote commit identity rather
than a self-referential commit hash in this document.

Use the existing 512MiB single worker/coordinator, 2.3GiB admission/2GiB reserve,
at most20-file checkpoint batches. Never mix changed source bases. Test-driven
steps use the actual Vitest config and existing guarded supervisor; inspect
failures before implementing, then rerun target files. UML source pins need
explicit review only if a pinned contract input changes. No renderer is needed.

## Execution evidence

- Targeted real-service fixture tests: 7 files,217 tests passed, including
  generated drafts, actual fixture publication/reread, restart, manual edit,
  cancellation, hook duplication and late-async write denial.
- Strict production build and architecture contract checker passed. Architecture
  source pins and the fixed retrieval80/literal24 corpora remain unchanged.
- Full frozen regression: 480 files,6782 assertions;6778 passed,0 failed,4 existing
  allowlisted skips. All57 checkpoint reports have matching receipts, no overlap
  or missing files. Source/test/build basis:
  `8623909df4b88d6ff2926156f23a381dc244dc070416b880507bd43828734926`.
- Solo review (not independent-account approval) reproduced and fixed mutable
  async write permission inheritance and false/null journal marker acceptance.
- This is deterministic integration evidence, not actual-model quality testing.
  Native lifecycle transport/trust, production host runtime/path grants and
  model-quality acceptance are still separate. Automatic live synthesis stays off.
- Staged37 scoped files passed path/content checks; unrelated research documents
  and host data remain excluded. NAS-backed release includes969 byte-matched
  build files. Prior release and launcher rollback are retained. Original/world/
  economy canonical bytes and checkpoints were preserved across service restart.
- Read-only live checks passed: fixed5 tools, compilation readiness at512 chars,
  revision-pinned public reads, hidden-path denial, and assertion views at512/4000
  chars with explicit partial coverage. No operational fixture documents were
  created. Live diagnosis identifies missing host policy; automatic application
  remains false. Telnet and NAS direct-write protection were not changed.
