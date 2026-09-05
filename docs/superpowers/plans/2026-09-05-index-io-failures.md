# Index IO failure and recovery plan

Execute inline with systematic-debugging, TDD and verification-before-completion.
No new agents; use only the authorized fork main.

## Contract

Markdown remains authoritative. A failed stat/read/directory listing is not
proof of deletion. Only ENOENT/ENOTDIR or a successful non-file stat can remove
a file from a derived view. Missing Vault roots are unavailable, not empty.
IO/permission failures must reject the affected read with a bounded message
without leaking filesystem paths, preserve retry/invalidation state, and recover
after the filesystem becomes readable without restarting the server. Cached
views are not a fallback permission system during known refresh failure.

## Implementation

- Add shared missing-path classification and a path-free retry error.
- Catalog directory/stat readers propagate non-missing faults. Failed watcher
  batches retain work for the next drain, including background-timer failures.
  Watcher error delivery reaches batch and legacy subscribers.
- Metadata, graph and lexical index reads distinguish missing files from other
  failures. Failed refreshes remain dirty; initial failed index loads can retry.
  Do not increase concurrency or add automatic writer/retry loops.
- Cover real temporary files with injected low-level stat/readdir/readUtf8
  failures, repeated failure, recovery, deletion, initial failures, batch tails,
  unknown/full events and bounded public errors. Do not change ACLs or live Vaults.
- Run targeted tests, build, full suite, compiled public MCP smoke and diff check.
  Update README/schema/roadmap with verified limits. Commit source and dist,
  push the user's fork, verify actual remote main; no upstream PR.

## Boundaries

This is not a globally atomic snapshot or an OS delivery guarantee. Files not
scheduled for a refresh can remain cached until normal invalidation/expiry.
Semantic persistence and unrelated service-specific fallback catches require
separate audits. Preserve those gaps rather than claiming all IO is fail-safe.

## Validation and review

- Fault injection reproduced false deletion/empty views, missing batch watcher
  errors and non-recoverable refreshes. One deletion-control fixture initially
  used rm for an empty directory and was corrected to rmdir; it was not a product
  failure. The final fault suite has 23 cases, including real public MCP calls.
- A later lazy-text fault test failed by returning an empty result; propagating
  non-missing read errors fixed it without poisoning the document's text fields.
- Related catalog/index/graph/search suites: 89 tests passed. Updated policy and
  IO tests: 37 passed. Policy version 18 teaches unavailable is not deletion and
  forbids a busy retry/cleanup loop. Build and compiled five-tool public MCP fault
  + same-server recovery smoke passed. Driver/path details stay out of errors.
- Full default parallelism: reputation timed out once (913 pass, one skip), then
  archive long-path timed out on the final-policy run (914 pass, one skip).
  Reputation alone passed in 1.07s test time. Local Vitest resolves 11 workers
  from 12 available cores; comparison with --maxWorkers=4 passed all 59 files,
  915 tests and one skip in 42.70s versus default run's 46.91s.
- Bound the repository test runner to min(4, availableParallelism) so normal
  npm test uses measured bounded concurrency without timeout/assertion changes.
  This is test infrastructure only, not a server concurrency limit or proof that
  every timing/teardown issue has been eliminated. CLI overrides remain possible.
- Final normal `npm test` with the committed configuration: 59 files passed,
  915 tests passed and one skipped in 42.12s. `git diff --check` passed.
- Inline review checked unknown error sanitization, promise rejection cleanup,
  failed-batch tails, no automatic retry loop, retained dirty work, startup
  recovery and unchanged fixed MCP surface. The live Vault and accounts remained
  untouched; failure tests and compiled smoke used owned temporary Vaults only.
