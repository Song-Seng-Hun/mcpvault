# Review action revisions implementation plan

> **For agentic workers:** Use executing-plans. User approved inline main work.

**Goal:** Eliminate mixed-revision review plans and unnecessary selected-body reads.

**Architecture:** Keep existing producers; capture their valid revision evidence,
admit fresh bounded metadata, derive actions from it and recheck before return.

**Tech Stack:** TypeScript, Node, Vitest, Markdown/YAML.

- [x] Add `src/review-action-revisions.test.ts` using a contained disposable Vault.
  Wrap real `recallQueue`, rewrite source/private data after its result, and assert
  `reviewPacket` rejects with a refresh error. Include missing-to-present state,
  newly hidden source and changed repair basis. Observe RED before implementation.
- [x] In `src/llm-wiki.ts` reviewPacket, collect valid producer revision sets in
  `add`, pass `{fresh:true,strict:true,maxBytes:MAX_NOTE_CONTENT_BYTES}` to candidate
  metadata lookup, and compare revisions before routing. Track recall private
  revisions by the authenticated own-state path.
- [x] Reuse admitted selected metadata; remove final `noteExists`/body read.
  Read repair metadata bounded/fresh and compare the provided repair revision.
  Replace swallowed plan errors with a generic changed/unavailable error.
  Recheck candidate hashes and private state before constructing the result.
- [x] Add isolated real-storage orchestration checks for zero selected body
  reads, hash-only final guards and non-recall plan preservation. Run targeted
  review/recall/date tests with `--maxWorkers=1`.
- [x] Update README/schema/tool description, request a focused independent
  review, run build, whole single-worker suite and `git diff --check`.
- [ ] Commit source/dist/tests/docs, push fork main and verify live remote hash.

## Verification evidence

- Eight initial real-storage/routing tests failed on the old implementation,
  then passed. An added duplicate-receipt test reproduced two final source hash
  reads instead of one. Request-local receipt deduplication fixed it without
  caching content or accepting conflicting revisions.
- Missing-state verification uses fresh strict metadata because the existing
  hash reader throws on a missing note. Normal real recall has positive coverage
  both with no private state and with an existing personal prompt/state revision.
- The success tests initially asserted a prompt on `curationPlan.selected`,
  whose existing contract deliberately omits it. Corrected the assertion to the
  matching priority; independent Astra review reported the same test issue and
  no additional introduced production findings. Reviewer closed.
- Focused review/recall/date suite: six files, 148 tests passed (including 12 new
  tests). Build passed. Full `npm test -- --maxWorkers=1`: 183 files passed,
  2,851 tests passed, one skipped, 329.45 seconds. Whitespace validation passed.
- This removes redundant service-level body/existence reads, not all raw file
  reads. See the resource-reduction follow-up for streaming-hash limitations and
  later CPU/GPU evaluation gates. No whole-endpoint speedup is claimed.
