# Streamed Snapshot Read Implementation Plan

> **For agentic workers:** Use executing-plans inline and a bounded read-only
> review. The user has approved design decisions and fork main integration.

**Goal:** Eliminate whole compressed snapshot assembly while retaining safe bounds.

**Architecture:** One handle feeds an async bounded chunk iterator. Gzip reads
use Node pipeline with bounded decoded collection; raw reads collect source
chunks directly. Caller-visible API and error contract stay unchanged.

**Tech Stack:** Node fs/promises, stream/promises, zlib, TypeScript and Vitest.

- [ ] Extend `src/snapshot-read.test.ts` with a real 150 KiB incompressible gzip
  fixture. Spy on Buffer.concat passthrough and count calls whose total length
  equals the stored size; expect zero after reading. Run
  `npm test -- src/snapshot-read.test.ts --maxWorkers=1` and observe RED.
- [ ] In `src/snapshot-read.ts` replace convenience gunzip with createGunzip and
  pipeline. Extract async generator reading min(65536, maxBytes-total+1), reject
  overflow before yield. Collect decoded chunks only after cumulative limit
  checks. Keep handle close in outer finally, existing sanitized catch, regular
  file stat guard and before-IO validation (reject missing stored limit too).
- [ ] Extend real-handle instrumentation in the reader test to count bytes/read
  requests and close; inject growth or mid-read error only for the selected
  fixture. Test both compressed input overflow after stat and decoded bomb
  failure stopping reads, corrupt CRC, truncated trailer, concatenated success,
  invalid stored/decoded arguments, plain compatibility. All errors return no
  partial bytes and preserve caller input files.
- [ ] Update README and evidence; run reader/writer/semantic/search/notification
  tests with one worker, build and full `npm test -- --maxWorkers=1`. Review for
  decoder cancellation and resource closure, run diff check and stage explicit
  source/tests/docs/dist only. Commit and push the user's origin main.

No live Vault mutation or model/GPU work; the whole organization Goal stays active.
