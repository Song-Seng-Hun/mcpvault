# Shared HTTP benchmark implementation plan

> Execute inline using executing-plans and TDD. Design approval and fork-main
> commit/push authority are already delegated by the user.

**Goal:** Produce repeatable equal-workload evidence before more resource changes.
**Architecture:** A bounded opt-in driver, real SDK transports, exact-PID Windows
memory sampling, disposable data, no production instrumentation.
**Tech stack:** Existing Node/MCP SDK, PowerShell Get-Process, Vitest.

- [x] Add `src/shared-http-benchmark.test.ts`: spawn the script with an unknown
  argument and require nonzero exit with an explicit usage message; spawn
  `--smoke` on Windows and validate mode order, process counts, request counts,
  finite nonnegative measurements, positive memory, and cleanup confirmation.
- [x] Run `npm test -- src/shared-http-benchmark.test.ts --maxWorkers=1` to RED.
- [x] Add `scripts/benchmark-shared-http.mjs` implementing the design. Use SDK
  `StdioClientTransport.pid` or the directly spawned HTTP child's PID, never a
  process-name scan. Run requests with a 10-second timeout and HTTP readiness
  with a 10-second deadline. Close all clients with allSettled; kill only the
  directly owned HTTP child and await exit before fixture cleanup. Preserve a
  fixture if owner shutdown cannot be established.
- [x] Re-run the focused test; run `node scripts/benchmark-shared-http.mjs`
  sequentially without tests or other benchmarks competing. Record all four
  runs and limitations in the spec, including contradictions to expectations.
- [x] Obtain a bounded read-only review, fix issues, re-run focused validation,
  `npm run build`, full `npm test -- --maxWorkers=1`, `git diff --check`.

Publication gate: commit only script/test/docs, push user fork main, and verify
the remote SHA against the local commit. Git and the delivery receipt, rather
than a pre-commit checkbox, establish completion of this external gate.

## Execution notes

- Initial tests failed because the script did not yet exist. Implemented the
  bounded driver; both initial tests passed. Review added a third startup-fault
  test, first observed failing because that fixed diagnostic mode was absent.
- Luna review found handshake-failure owner tracking and PID identity gaps;
  tracking now occurs at spawn/start completion, live handles bind snapshots,
  and creation identities are established before warm-up. The worker is closed.
- Three final focused tests pass, including the spawned-but-unconnected cleanup
  path. Final complete comparison is recorded in the spec. A subclass-based
  instrumentation changed SDK auto negotiation; it was removed in favor of a
  base-instance start wrapper, and the final comparison was repeated.
- No production code, generated runtime, live plugin settings or accounts were
  modified. New artifacts are diagnostic script, regression tests and docs only.
- Final build and full suite passed: 195 files, 2,982 passed / 2 skipped, 397.67s
  starting 12:08:40 local. The broader Goal remains active; HTTP overhead
  attribution and native-inference/large-Vault measurements are still pending.
