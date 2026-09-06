# Recall recording integrity implementation plan

> Use executing-plans inline with TDD; delegate a bounded final integrity review.

**Goal:** Record only the current attempted knowledge/private state without
silently replacing personal recall settings or misattributing write receipts.
**Architecture:** fresh bounded metadata -> caller source/state guards -> existing
guarded filesystem write -> own-write receipt.
**Tech stack:** TypeScript, Vitest, existing filesystem revision primitives.

- [x] Create src/recall-record-integrity.test.ts using real temp directories and
  contained cleanup. Assert stale source/state rejection and unchanged bytes;
  exercise private prompt/cadence, concurrent creation and receipt provenance.
  Example: `await expect(wiki.recordRecall({principal,path:'Note.md',recallQuality:'good',expectedRevision:old})).rejects.toThrow(/revision/i)`.
- [x] Run `npm test -- src/recall-record-integrity.test.ts --maxWorkers=1` and
  record expected RED failures before touching implementation.
- [x] In src/llm-wiki.ts recordRecall, load source and own private metadata using
  `{fresh:true,strict:true,maxBytes:MAX_NOTE_CONTENT_BYTES}`. Validate source
  SHA-256 and existing expectedStateRevision; preserve private defaults.
  Private write: `const receipt = await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write,[{path:params.path,expectedRevision:params.expectedRevision}],{maxBytes:MAX_NOTE_CONTENT_BYTES});`.
  Shared write: `const receipt = await this.fileSystem.updateFrontmatterWithReceipt(update,{maxBytes:MAX_NOTE_CONTENT_BYTES});`.
  Return receipt.revision, never a later read's revision.
- [x] In src/createServer.ts forward expectedStateRevision. In
  src/llm-wiki-tools.ts document its conditional requirement and inherited prompt
  rules. Update README.md, _wiki/SCHEMA.md and existing MCP repeat-record tests
  to pass the previous stateRevision. Add real executor coverage.
- [x] Review changes independently; run focused tests, `npm run build`,
  `npm test -- --maxWorkers=1`, and `git diff --check`.
- [x] Stage only changed source/tests/docs/dist, commit and push fork main.
  Verify HEAD, origin/main and live remote hash. Preserve .agents/.mcpvault.

## Evidence

- Initial 13 tests failed on the old recording path; stale source returned
  success, private fields were replaced, hidden state was overwritten and reads
  opened bodies. After implementation 12 passed; the remaining body read came
  from filesystem assertExpectedRevision, now hash-only.
- MCP repeat-record test reproduced missing adapter forwarding, then passed
  with explicit state guards. Missing/stale guards reject; correct ones append.
- Review-packet test originally mislabeled the private fixture as knowledge.
  Corrected to agent_recall_state, reproduced RED with the guard projection
  removed, restored it and observed all 16 tests pass.
- Independent Astra review found the global 8 MiB cap broke oversized-note
  shrinking/trashing. Two real recovery tests failed. Scope maxBytes to recall
  calls instead, preserve generic recovery, and retain hash-only assertions.
- Added shared-write cap coverage; observed RED before passing policy through
  Properties preparation. 19 recall tests plus receipt/lock suites passed:
  48 tests in 3 files, 5.82s. Reviewer is closed.
- Final source build passed. First full suite: 2809 passed, 1 skipped, 1 failed
  in checkbox-task-receipt's no-op race. It injected the external edit on the
  second parsed read, but revision guards now hash instead of parsing, so that
  edit never occurred. Move the hook to the inspected snapshot's first parsed
  read; preserve all assertions about the old receipt, zero writes and the real
  external edit. Focused checkbox/recall tests: 24 passed (4.10s).
- Final full regression after the test-harness adjustment: 181 files passed,
  2810 tests passed and 1 skipped; 324.08s, exit 0, starting 2026-09-07 05:52:32
  local. Build and staged diff check passed. Implementation commit
  e94f6b91622d711316911328a3b59e9fd1fb86b9 was pushed to Song-Seng-Hun/mcpvault
  main; local HEAD, origin/main and live ls-remote matched. Only pre-existing
  .agents/ and .mcpvault/ remained untracked. No live Vault/server change occurred.

## Next audit candidate (not part of this delivery)

Current knowledgeGaps (src/llm-wiki.ts, near line 2989) calls readPrivateRecall
only when the shared note has recall_prompt, and takes cadence from shared
Properties. readPrivateRecall still opens bodies and catches read failures as
missing state. Inspect private-only prompts, private cadence, hidden state and
read-error semantics there before claiming all advisory recall views are aligned.
