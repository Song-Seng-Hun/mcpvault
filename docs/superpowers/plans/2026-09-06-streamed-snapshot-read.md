# Streamed Snapshot Read Implementation Plan

> **For agentic workers:** Use executing-plans inline and a bounded read-only
> review. The user has approved design decisions and fork main integration.

**Goal:** Eliminate whole compressed snapshot assembly while retaining safe bounds.

**Architecture:** One handle feeds an async bounded chunk iterator. Gzip reads
use Node pipeline with bounded decoded collection; raw reads collect source
chunks directly. Caller-visible API and error contract stay unchanged.

**Tech Stack:** Node fs/promises, stream/promises, zlib, TypeScript and Vitest.

- [x] Extend `src/snapshot-read.test.ts` with a real 150,000-byte incompressible gzip
  fixture. Spy on Buffer.concat passthrough and count calls whose total length
  equals the stored size; expect zero after reading. Run
  `npm test -- src/snapshot-read.test.ts --maxWorkers=1` and observe RED.
- [x] In `src/snapshot-read.ts` replace convenience gunzip with createGunzip and
  pipeline. Extract async generator reading min(65536, maxBytes-total+1), reject
  overflow before yield. Collect decoded chunks only after cumulative limit
  checks. Keep handle close in outer finally, existing sanitized catch, regular
  file stat guard and before-IO validation (reject missing stored limit too).
- [x] Extend real-handle instrumentation in the reader test to count bytes/read
  requests and close; inject growth or mid-read error only for the selected
  fixture. Test both compressed input overflow after stat and decoded bomb
  failure stopping reads, corrupt CRC, truncated trailer, concatenated success,
  invalid stored/decoded arguments, plain compatibility. All errors return no
  partial bytes and preserve caller input files.
- [x] Update README and evidence; run reader/writer/semantic/search/notification
  tests with one worker, build and full `npm test -- --maxWorkers=1`. Review for
  decoder cancellation and resource closure, run diff check and stage explicit
  source/tests/docs/dist only. Commit and push the user's origin main.

No live Vault mutation or model/GPU work; the whole organization Goal stays active.

## Verification evidence

- Old implementation failed three new assertions: one complete compressed input
  concat instead of zero; all 1,049,968 stored bytes read before rejecting early
  decoded overflow; missing required maxBytes reached IO. The invalid-argument
  test was adjusted to await rejection before asserting opens, avoiding a
  test-created unhandled rejection. Isolated RED then failed cleanly on the
  existing wrong error classification.
- Streaming reader and required-ceiling validation passed the initial 60 tests
  across reader/writer/semantic snapshot integration, and build passed.
- Expanded real-reader/consumer/search/semantic checks passed 185 tests across
  nine files in 14.91 seconds. Existing public discovery, legacy lexical rebuild
  and semantic legacy fallback tests exercise the real new reader with smaller
  decoded limits, not a substituted parser or whole-buffer decoder.
- Review requested deliberately deferred reads across decoder-originated failure.
  Both overflow and checksum cases now hold the second read, observe the real
  decoder error, prove close has not been called, then release/await the read
  and verify close with no pending IO. Native corrupt/truncated failures also
  assert pending-read cleanup. The 38 reader tests passed; final broader suite
  passed 187 tests across nine files in 14.83 seconds. Build/diff passed again.
- Terra medium re-review found no remaining actionable issue and was closed.
  Full suite passed 2,365 tests with one existing skip across 154 files in 286.00
  seconds, using one worker. Build and diff check passed. Source/tests/docs and
  tracked generated output are the only integration targets; the user's fork
  main is the only push destination. No live Vault or server restart was used.

## Next resource investigation (not implemented in this batch)

Read-only follow-up found `SEMANTIC_MODEL_OPTIONS` specifies pinned revision,
q8 and CPU but no native intra/inter-op thread count or spinning policy.
`acquireSharedEmbedder` pools the model once per process but hands callers the
raw callable; `vectorInFlight` only coalesces identical queries per service.
Before changing this, audit upstream request admission and native call scheduling
to avoid adding a redundant queue or harming foreground search fairness.

Installed Transformers.js forwards `session_options`; installed ONNX types expose
intraOpNumThreads/interOpNumThreads, executionMode and extra session settings.
ONNX's [thread management documentation](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
describes default physical-core-based threading and spinning enabled for latency,
with a CPU/power tradeoff. This makes bounded inference concurrency and explicit
thread policy concrete next candidates. Benchmark with small controlled fixtures
before claiming a benefit; changing the embedding profile can trigger reindexing.
These observations do not establish the cause of the earlier whole-PC stutter.
