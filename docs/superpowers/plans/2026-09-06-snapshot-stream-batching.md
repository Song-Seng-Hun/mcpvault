# Snapshot Stream Batching Implementation Plan

> **For agentic workers:** Use executing-plans inline; user authorizes main and
> fork-only integration. A separate read-only review runs alongside verification.

**Goal:** Reduce small-record codec overhead and prove bounded IO behavior.

**Architecture:** Lazy `snapshotByteChunks(chunks, maxBytes)` emits owned 64 KiB
buffers into the existing gzip writer. IO semantics and readers are unchanged.

**Tech Stack:** Node Buffer/streams/zlib/fs, TypeScript, Vitest.

- [ ] Create `src/snapshot-chunks.test.ts`. Assert joining yielded buffers equals
  the original encoded bytes; 100,000 one-byte records produce two buffers of
  65,536 and 34,464 bytes; oversized input rejects before Buffer.from; early
  iterator return closes source and emitted buffers remain stable. Run
  `npm test -- src/snapshot-chunks.test.ts --maxWorkers=1` and observe RED.
- [ ] Create `src/snapshot-chunks.ts` with exported generator accepting
  `Iterable<string | Uint8Array>` and maxBytes. Count `Buffer.byteLength(string)`
  or `byteLength` before encoding; throw on overflow. Copy slices into a lazy
  65,536-byte Buffer; yield a full buffer and allocate a different next buffer;
  yield only the initialized prefix at EOF. Validate byte limit before iteration.
- [ ] Modify `src/snapshot-write.ts` to pass this generator to Readable.from and
  remove the redundant decoded transform. Keep stored-byte transform/rename.
  Add writer instrumentation test requiring 100,000 single-byte records to make
  two gzip writes and still decode correctly; run RED before integration.
- [ ] Extend writer integration tests with transient rename injection and
  recorded delays, real final rename and old-target/owned-temp checks. Add a
  corked real file destination test using incompressible generated records,
  observing bounded source read-ahead while stalled then complete round trip.
- [ ] Update README and record test evidence here; run snapshot/semantic tests,
  `npm run build`, `npm test -- --maxWorkers=1`, independent code review and
  `git -c core.safecrlf=false diff --check`. Commit explicit files and generated
  output, push only `origin main`, verify remote commit. No live Vault changes.
