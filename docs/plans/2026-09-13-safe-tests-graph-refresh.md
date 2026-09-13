# Safe tests and graph refresh implementation plan

User approved the reviewed feedback. Execute inline with executing-plans and
TDD, on existing main after ad6059794; no agents, PRs, new branch or worktree.

## Design

Promote the proven guarded checkpoint workflow into portable repository tooling,
not a copy of host-specific paths. `test:safe` discovers actual Vitest files,
runs fresh single-worker processes in batches of at most20, and pins code/build/
tests/config/runtime to durable reports. Missing RAM defers with a nonzero exit;
it never certifies an interrupted or failed report. A resumed run must match its
basis and exact test set. Reports and locks stay in ignored `.mcpvault/test-runs`.
`test:compact` is the same safe workflow with one file per process, retaining
test isolation. No removed Vitest poolOptions or assertion/timeout relaxation.

Investigate alias changes separately from watcher/reconciliation events using
real synthetic files, then fix only a reproduced source of unnecessary reads.
Preserve unknown-event full refresh, periodic content audits, revision checks,
ambiguity and current ACL filtering. Do not add an inverse alias map without
evidence that it addresses the measured cause.

New test-tool responsibilities are separated in `scripts/testing/`. Existing
runtime files are not moved wholesale. declarationMap stays on and sourceMap
stays off; speculative IDE speed claims and map cleanup are excluded.

## Tasks and verification

- [x] Tests first in `src/safe-test-runner.test.ts`: malformed/duplicate CLI
  options, removed options absent, exact report coverage, unexpected skips and
  runtime failures, resume drift, incomplete records, safe paths and ownership.
  Pin assertions such as `expect(verdict(report, files, 0).passed).toBe(1)`
  and `expect(() => verdict(report, ['src/Other.test.ts'], 0)).toThrow()`.
- [x] Implement focused `scripts/testing/{config,manifest,report,process,runner}.mjs`
  and thin `scripts/run-chunked-tests.mjs`; wire `test:safe`/`test:compact` in
  package.json. Exercise actual child completion, cancellation and CLI smoke
  tests in disposable fixtures, not fabricated successful Vitest reports.
- [x] Reproduce graph full-read trigger and add a failing regression using the
  real graph, bounded reader and filesystem/event boundary. Isolate target-only,
  reference-only and combined alias changes; distinguish body IO from resolver
  rebuilding. Apply the smallest fix and keep unknown-event/content-audit tests.
- [x] Build, targeted tests, synthetic1000/10000 measurements and source-pinned
  full regression through the new runner. Keep existing retrieval80 and fidelity24
  corpora. Record observed numbers and limitations, not an OOM-free promise.
- [x] Solo review, architecture/source pin check, staged paths/content and diff
  check; preserve rollback, deploy runtime changes to NAS and verify public MCP
  reads/canonical data.

Final Git delivery commits and pushes only the user's existing fork main, with
remote identity verification; no PR or upstream contribution.

Target tests initially use the existing local guarded supervisor. Final
verification uses `npm run test:safe -- --run-id safe-graph-final3 --chunk-size=10`, resuming only
with unchanged source/runtime basis. Checkpoint metadata distinguishes pass,
allowed skip, incomplete and failed. No package/model/provider installation or
production fixture writes. Native automation grants and Telnet stay unchanged.

## Verification attempts

`safe-graph-final1` stopped on batch9 after160 accepted files. The existing
Git handoff history test hit its unchanged5-second deadline, followed by EBUSY
while cleanup overlapped the still-running asynchronous fixture. A later test
also reported EBUSY. The failed report and earlier receipts are retained, not
accepted as a successful run. No memory guard tripped (accepted-batch minimum
4.326GiB). The unchanged file passed all30 tests in a separate guarded run.
This demonstrates a timing-sensitive failure, not its exact external trigger;
no assertion, timeout or production Git code was weakened to suppress it.

Standalone verification completed a new full run with at most10 files per coordinator:
482 files, 6,799 passed, 4 existing skips, 0 failed. Its code/build basis is
`a8247b543a05ab815b6f473bc03cedfa9f809cc5825d5675ae7d3c380bd78e7a`.
No accepted coverage is imported from the failed run.

## Shared-catalog follow-through

Review during the frozen run found that createServer supplies VaultFileCatalog;
the standalone watcher benchmark does not exercise that production path. Its
parent-folder notification still becomes an unspecified full invalidation.
Do not claim standalone timing as a measured live-service improvement.

- [x] Reproduce with real files and the shared catalog, then add failing tests
  at the watcher boundary. Keep the current frozen run intact while it finishes.
- [x] Carry a host-internal directory-metadata hint alongside the existing full
  notification. Other indexes keep their conservative undefined/full semantics.
  Preserve all coalesced explicit dirty note paths, including metadata collisions;
  unknown events and renames dominate known-folder hints in either event order.
  Graph must not clear forced reads, dirty paths or the independent content audit.
  Keep one shared watcher and current visibility/revision checks.
- [x] Measure standalone and shared modes separately; run target/build/full
  verification on a new source basis before deployment of the combined changes.

No authorization, public endpoint or provider is added by this internal hint.

Shared follow-through target verification passed 156 tests across13 files plus
5 benchmark tests in both modes; strict build and architecture checker passed. Solo
review caught delivery failure racing a new folder hint; direct-read and timer
paths both reproduced stale results before the fix and now preserve strong
revalidation. This is solo review, not independent-account approval. Final combined
regression uses a new `safe-graph-final3` run and will not import the earlier basis.

## Final combined verification and deployment

- Final official safe-runner result:483 files,6,818 assertions;6,814 passed,
  0 failed,4 existing allowlisted Windows skips. All49 completion receipts match
  the exact inventory without overlaps or missing files; no interrupted/failed
  batches. Minimum sampled free host RAM was4.228GiB. Final source/test/build basis:
  `ed2fd9d697bfbb71e04c48ee535478c1d660cfc951b1cd06ec20ed3843ed997a`.
- Earlier failed and standalone runs remain separate. Their results were not
  imported into this final run. Assertions, test timeouts and isolation were not
  relaxed. Actual-model quality and native automation authorization are not
  inferred from these tests. Retrieval80 and literal24 corpora remain unchanged.
- Reviewed24 scoped files, including generated output, passed staged path/content
  review and whitespace checks. Seven unrelated research documents remain
  untracked and excluded; host records and credentials are not committed.
- NAS-backed service deployment used969 byte-matched build files. Previous
  runtime and launcher rollback artifacts remain available; preliminary staging
  was not overwritten. Original/world/economy bytes and canonical checkpoints
  matched across the exact owned service restart and dead-writer recovery.
- Read-only live verification passed:fixed5 tools, public revision-pinned reads,
  hidden-path denial, compilation diagnosis at512 chars, and graph assertion
  views at512/4000 chars with truthful partial coverage. No operational fixture
  documents or public actions were created.
- Live automatic application remains false with host policy missing. No model,
  provider, scheduler or native hook grant was added. NAS direct-write protection
  remains outside scope, and Telnet was not enabled.

The final Git delivery follows on the existing user-fork main, with its remote
commit identity checked after push. No release, package, PR or upstream action.
