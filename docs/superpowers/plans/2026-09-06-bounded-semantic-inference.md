# Bounded Semantic Inference Implementation Plan

> **For agentic workers:** Use executing-plans inline and independent review.
> Main/fork integration and design decisions are explicitly user-authorized.

**Goal:** Bound embedding CPU concurrency and working sets without client changes.

**Architecture:** A process singleton gate schedules service-owned jobs ahead of
model acquisition. Supported native thread options are part of the model profile.

**Tech Stack:** TypeScript, promises/AbortSignal/timers, Transformers.js, ONNX, Vitest.

- [ ] Create `src/semantic-inference-gate.test.ts` then
  `src/semantic-inference-gate.ts`. API `run<T>(priority, task, signal?)` starts
  one job, caps queue at 16, expires after 5000 ms, allows four foreground jobs
  before background, cleans listeners/timers, and preserves the slot on active
  cancellation until actual task completion. Tests use deferred promises and fake
  timers. Observe RED before implementation, verify GREEN and error recovery.
- [ ] Add `src/semantic-inference.test.ts` with a module fake pipeline, real temp
  services and deferred native calls. Demonstrate overlapping current calls,
  overload global backoff, and close during pending initialization. Implement
  service scheduling ahead of getEmbedder, track jobs for close/idle cleanup,
  split direct single-call primitive for batch fallback. Preserve BusyError in
  prepare/drain and skip markUnavailable for temporary admission failures.
- [ ] Extend `src/semantic-profile.test.ts` for supported CPU thread settings and
  native tiny Identity session success/disposal without network/model download.
  Update `src/semantic-profile.ts` with intraOp=min(2, availableParallelism()),
  interOp=1 and sequential execution included in the existing profile hash.
- [ ] Update README with limits, fallback behavior and bounded one-time profile
  rebuild implications. Run focused semantic tests, build, full
  `npm test -- --maxWorkers=1`, independent concurrency/lifecycle review and
  `git -c core.safecrlf=false diff --check`. Stage explicit source/tests/docs/dist,
  commit and push only the user's origin main. Record actual evidence here.
