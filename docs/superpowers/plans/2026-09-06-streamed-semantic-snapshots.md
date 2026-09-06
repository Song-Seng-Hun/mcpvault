# Streamed Semantic Snapshot Implementation Plan

> **For agentic workers:** Use executing-plans for inline work and a narrow
> independent review. The user explicitly authorizes fork main commits/pushes.

**Goal:** Avoid whole snapshot JSON/buffer duplication without losing atomic publication.

**Architecture:** A bounded gzip-stream writer consumes record generators;
semantic callers capture entry references/copies synchronously and keep their
existing read schema and coalescing. Temporary files are unique and owned.

**Tech Stack:** Node streams/promises, zlib, fs, TypeScript and Vitest.

- [x] Add `src/semantic-snapshot-write.test.ts` with real temporary services and
  `vi.spyOn(JSON, 'stringify')` rejecting the complete manifest/queue value.
  Require `await service.saveManifest()` to succeed and decoded values to match.
  Run `npm test -- src/semantic-snapshot-write.test.ts --maxWorkers=1`; record RED.
- [x] Add `src/snapshot-write.ts`: `writeGzipSnapshot(path, chunks, limits)` uses
  `Readable.from` -> bounded byte transform -> `createGzip` -> stored-byte limit
  -> exclusive unique temporary write stream -> rename. `finally` cleans only
  an owned unfinished temp. Errors preserve the previous snapshot.
- [x] Replace `saveManifest`/`flushPendingSnapshot` whole-blob writes with record
  generators in `src/semantic-search.ts`; keep the same gzip JSON object/array.
  Capture entries before asynchronous IO; preserve limits, debounce and fallback.
- [x] Add `src/snapshot-write.test.ts` for real Unicode/empty round trips, limits,
  iterator and publication failures, concurrent writers and no leaked temp files.
  Assert failed writes keep prior `readFile(path)` unchanged. Test service-level
  captured generation via a serialization callback that replaces live entries.
- [x] Run focused snapshot/semantic tests, `npm run build`, full
  `npm test -- --maxWorkers=1`, `git -c core.safecrlf=false diff --check` and a
  read-only independent review. Document actual evidence and limitations.
- Final integration stages only owned source/tests/docs/dist, then commits and
  pushes `origin main`; no upstream contribution, release or live server restart.

## Evidence

- Initial two service regression tests failed on whole-inventory serialization;
  both passed after record streaming replaced whole-payload conversion.
- Real concurrent Windows publication reproduced EPERM, isolated to rename with
  error-code-only test instrumentation. Short bounded retry fixes contention;
  permanent failures still retain target data and clean only their owned temp.
- Manifest publication failure initially propagated from an optional cache and
  could requeue already committed vectors. Reproduced and made cache-only;
  added a real native-vector drain regression as well as direct save coverage.
- Focused snapshot/semantic tests: 100 passed across six files before the final
  native-drain regression. Build and diff check passed. Independent review and
  final focused/full verification pending.
- Final focused run passed 101 tests across six files in 10.57 seconds; build
  passed. Independent review found no correctness/failure-semantics blocker and
  was closed. Two non-blocking follow-ups remain: deterministic injected tests
  for the bounded rename retry schedule, and slow-destination backpressure
  measurement (current tests prove early stop on decoded overflow). Do not
  mistake these checks for a measured RSS or throughput benchmark.
- Final full suite: 2,322 passed, one existing skip across 153 files, 282.86
  seconds with one worker. Build and final diff check passed. Source and tracked
  generated output are integrated together; no live Vault mutation or server
  restart. This is one resource-efficiency increment, not completion of the full
  organization goal or all performance follow-ups.
