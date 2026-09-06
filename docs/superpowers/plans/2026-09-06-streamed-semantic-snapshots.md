# Streamed Semantic Snapshot Implementation Plan

> **For agentic workers:** Use executing-plans for inline work and a narrow
> independent review. The user explicitly authorizes fork main commits/pushes.

**Goal:** Avoid whole snapshot JSON/buffer duplication without losing atomic publication.

**Architecture:** A bounded gzip-stream writer consumes record generators;
semantic callers capture entry references/copies synchronously and keep their
existing read schema and coalescing. Temporary files are unique and owned.

**Tech Stack:** Node streams/promises, zlib, fs, TypeScript and Vitest.

- [ ] Add `src/semantic-snapshot-write.test.ts` with real temporary services and
  `vi.spyOn(JSON, 'stringify')` rejecting the complete manifest/queue value.
  Require `await service.saveManifest()` to succeed and decoded values to match.
  Run `npm test -- src/semantic-snapshot-write.test.ts --maxWorkers=1`; record RED.
- [ ] Add `src/snapshot-write.ts`: `writeGzipSnapshot(path, chunks, limits)` uses
  `Readable.from` -> bounded byte transform -> `createGzip` -> stored-byte limit
  -> exclusive unique temporary write stream -> rename. `finally` cleans only
  an owned unfinished temp. Errors preserve the previous snapshot.
- [ ] Replace `saveManifest`/`flushPendingSnapshot` whole-blob writes with record
  generators in `src/semantic-search.ts`; keep the same gzip JSON object/array.
  Capture entries before asynchronous IO; preserve limits, debounce and fallback.
- [ ] Add `src/snapshot-write.test.ts` for real Unicode/empty round trips, limits,
  iterator and publication failures, concurrent writers and no leaked temp files.
  Assert failed writes keep prior `readFile(path)` unchanged. Test service-level
  captured generation via a serialization callback that replaces live entries.
- [ ] Run focused snapshot/semantic tests, `npm run build`, full
  `npm test -- --maxWorkers=1`, `git -c core.safecrlf=false diff --check` and a
  read-only independent review. Document actual evidence and limitations.
- Final integration stages only owned source/tests/docs/dist, then commits and
  pushes `origin main`; no upstream contribution, release or live server restart.
