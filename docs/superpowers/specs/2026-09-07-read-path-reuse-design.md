# Reuse one validated path within a note read

The user delegated design approval and authorized fork-main work. A server-only
CPU profile of 720 synthetic HTTP read/search requests found two synchronous
realpath branches under withNoteRead: its own resolvePath and isDirectory's
second resolvePath. The sampled lstat self times were 456.92 and 419.39 ms over
5,966.34 ms (3,591.09 ms idle); the calls are sequential with no await between
validation passes. This is sampled attribution, not exact per-call CPU timing
or proof that every HTTP overhead is filesystem work.

Keep normalizePath, lexical/symlink containment and PathFilter checks exactly
where they are. Extract the stat/isDirectory try/catch into private
isResolvedDirectory(fullPath), callable only after caller path validation.
withNoteRead uses that helper with its already validated fullPath; the public
isDirectory still performs its own normalization, containment and filter checks.
Preserve directory/missing/permission errors, bounded UTF-8 reads, revisions and
the VaultIoCoordinator. Do not cache paths across calls or bypass source/scope
rules. This does not solve external filesystem TOCTOU races already present.

Alternatives rejected: a cross-call realpath cache could miss link retargeting;
removing the directory check changes behavior across platforms; changing all
resolvers to async introduces unrelated race/concurrency changes.

Verify real filesystem reads and revisions, one resolution per ordinary
existing-path read, directory rejection, blocked/traversal/outside-junction
paths, in-Vault junction compatibility and between-call link retarget rejection.
Build, re-profile and run the existing equal-workload benchmark sequentially.
Run focused and full single-worker tests, review, then publish source plus dist
to the user fork only. Do not change the running server until verified.

## Evidence

- RED: five assertions saw two existing-target realpath calls instead of one;
  the other three behavior/security tests passed. After the change, targeted
  filesystem, existence, streaming-revision, HTTP-sharing and new tests passed:
  five files, 259 passed / 2 skipped, 16.52s at 12:24:08 local. Build passed.
- Same local inspector harness after warm-up, 720 requests (360 note reads and
  360 lexical searches), one temporary HTTP server and three clients. The two
  lstat self-sample branches totalled 876.31 ms before; one branch remained at
  466.39 ms afterward. withNoteRead inclusive samples fell from 948.60 to
  506.93 ms. Sampling at requested 500 us on this Windows host is approximate;
  inspector/control overhead and idle samples are included in profile duration.
- Profiled request median changed 19.27 to 20.40 ms; p95 32.58 to 29.08 ms;
  720-request workload elapsed 5878.86 to 5660.64 ms. Event-loop p95 changed
  6.62 to 6.45 ms but max increased 9.86 to 12.16 ms. These mixed results do not
  establish a general end-to-end latency improvement.

Unprofiled post-change benchmark (`node scripts/benchmark-shared-http.mjs`),
Node v22.23.2, three clients, 256 notes, 72 measured requests per fresh run:

| Run | Private MiB after | Working set MiB after | Workload ms | CPU interval ms | All median/p95 ms | Read median/p95 ms | Search median/p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| stdio 1 | 387.41 | 353.88 | 187.13 | 750.00 | 7.62 / 8.68 | 8.09 / 8.68 | 6.24 / 8.77 |
| HTTP 1 | 133.05 | 124.82 | 593.82 | 468.75 | 21.25 / 32.65 | 17.19 / 30.61 | 24.35 / 36.15 |
| HTTP 2 | 132.90 | 125.07 | 587.87 | 546.88 | 20.90 / 30.41 | 16.21 / 29.41 | 24.33 / 34.88 |
| stdio 2 | 388.04 | 359.77 | 255.89 | 781.25 | 8.37 / 17.25 | 9.37 / 20.16 | 7.30 / 10.56 |

The earlier baseline is in `2026-09-07-shared-http-benchmark-design.md`. All
responses and fixture cleanup passed. Read medians decreased, but aggregate
HTTP latency did not; HTTP remains slower than independent stdio in this small
warm-cache workload. CPU intervals include the PowerShell measurement gap,
and memory is summed process snapshots, not unique physical/peak RAM. No native
embedding, large-Vault or long-lived load was measured.

Astra review found no blocking regression. It also correctly noted that no-await
does not exclude external processes: removing the second resolution removes one
chance to catch a retarget between the former two checks. Both versions return
and later open a lexical path rather than pinning a validated target, so neither
provides within-call filesystem race safety. Tests verify between-call
revalidation, not that stronger guarantee. The reviewer was closed.

Next boundaries: attribute the remaining HTTP delay and independently examine
handle/canonical-target read validation for hostile external filesystem races.
Do not erase the remaining boundary check to chase a latency number.

## Final verification and host cutover

Full `npm test -- --maxWorkers=1`: 196 files, 2,990 passed / 2 skipped (2,992
total), 379.60 seconds, starting 12:26:47 local on 2026-09-07, exit 0. Build
and `git diff --check` passed. Generated filesystem JS/declarations/maps are
included with source; no other production modules changed.

After verification, the already-authorized host task was restarted. The old
PID/command/start-time guard initially observed the stopping process still
present and refused to start another. A fresh check showed no old process or
listener, so the same task was started once. New PID 27632, created
2026-09-07T12:34:51+09:00, owns 127.0.0.1:8788; task state is Running.
Native Codex `orient_wiki` followed by its exact `notes.read` primary action
read the public welcome successfully: 2,775 characters, unchanged revision
`5b66c8d1ec9f2dbdfdcdca4bba6f1ddd08d0722bce2af9944a8605aedc0c19de`.
No Codex restart, account creation or Vault document mutation was needed.
