# Review action revisions implementation plan

> **For agentic workers:** Use executing-plans. User approved inline main work.

**Goal:** Eliminate mixed-revision review plans and unnecessary selected-body reads.

**Architecture:** Keep existing producers; capture their valid revision evidence,
admit fresh bounded metadata, derive actions from it and recheck before return.

**Tech Stack:** TypeScript, Node, Vitest, Markdown/YAML.

- [ ] Add `src/review-action-revisions.test.ts` using a contained disposable Vault.
  Wrap real `recallQueue`, rewrite source/private data after its result, and assert
  `reviewPacket` rejects with a refresh error. Include missing-to-present state,
  newly hidden source and changed repair basis. Observe RED before implementation.
- [ ] In `src/llm-wiki.ts` reviewPacket, collect valid producer revision sets in
  `add`, pass `{fresh:true,strict:true,maxBytes:MAX_NOTE_CONTENT_BYTES}` to candidate
  metadata lookup, and compare revisions before routing. Track recall private
  revisions by the authenticated own-state path.
- [ ] Reuse admitted selected metadata; remove final `noteExists`/body read.
  Read repair metadata bounded/fresh and compare the provided repair revision.
  Replace swallowed plan errors with a generic changed/unavailable error.
  Recheck candidate hashes and private state before constructing the result.
- [ ] Add isolated real-storage orchestration checks for zero selected body
  reads, hash-only final guards and non-recall plan preservation. Run targeted
  review/recall/date tests with `--maxWorkers=1`.
- [ ] Update README/schema/tool description, request a focused independent
  review, run build, whole single-worker suite and `git diff --check`.
- [ ] Commit source/dist/tests/docs, push fork main and verify live remote hash.
