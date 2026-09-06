# Semantic Pending Work Implementation Plan

> For agentic workers: use executing-plans inline; explicit main/design approval
> is already supplied. Independent review follows implementation.

**Goal:** Remove repeated pending inventory allocation and redundant source reads.

**Architecture:** Keep the existing Map and service validation; change selection
to a single bounded iterator and skip redundant scan reads only for queued paths.

**Tech Stack:** TypeScript, Map iterators, temporary Markdown, Vitest.

- [ ] Extend `src/semantic-integrity.test.ts` with a counted entries iterator over
  5,000 pending paths. Real `drain(4)` must consume four entries for all-ready
  work and a delayed prefix plus four for mixed work; capture native apply args
  to check FIFO and untouched retries. Add a failed-batch newer-event check.
- [ ] Add queued changed-note scan tests: spy on the real vaultIo readUtf8,
  assert zero scan reads and unchanged manifest/attempt, then drain and inspect
  current prepared hash. Read failure must remain retryable at drain; an
  unqueued changed source must still be read and queued.
- [ ] Run `npm test -- src/semantic-integrity.test.ts --maxWorkers=1` and observe
  RED for the new work-count invariants before source changes.
- [ ] Replace drain selection in `src/semantic-search.ts` with:
  ```ts
  for (const [path, change] of this.pending.entries()) {
    if (batch.length >= maxFiles) break;
    if (change.retryAt && change.retryAt > now) continue;
    this.pending.delete(path);
    batch.push([path, change]);
    if (batch.length >= maxFiles) break;
  }
  ```
  After the unchanged manifest stat fast path in scan, add:
  ```ts
  if (this.pending.has(normalized)) return { normalized, info, entry };
  ```
- [ ] Run focused integrity/inference/reuse tests and build. Document precise
  work-count/unchanged validation semantics in README. Review the diff; run
  `npm test -- --maxWorkers=1` and `git -c core.safecrlf=false diff --check`.
  Commit explicit source/tests/docs/dist and push only origin main.
