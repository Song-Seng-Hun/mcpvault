# Recall recording integrity implementation plan

> Use executing-plans inline with TDD; delegate a bounded final integrity review.

**Goal:** Record only the current attempted knowledge/private state without
silently replacing personal recall settings or misattributing write receipts.
**Architecture:** fresh bounded metadata -> caller source/state guards -> existing
guarded filesystem write -> own-write receipt.
**Tech stack:** TypeScript, Vitest, existing filesystem revision primitives.

- [ ] Create src/recall-record-integrity.test.ts using real temp directories and
  contained cleanup. Assert stale source/state rejection and unchanged bytes;
  exercise private prompt/cadence, concurrent creation and receipt provenance.
  Example: `await expect(wiki.recordRecall({principal,path:'Note.md',recallQuality:'good',expectedRevision:old})).rejects.toThrow(/revision/i)`.
- [ ] Run `npm test -- src/recall-record-integrity.test.ts --maxWorkers=1` and
  record expected RED failures before touching implementation.
- [ ] In src/llm-wiki.ts recordRecall, load source and own private metadata using
  `{fresh:true,strict:true,maxBytes:MAX_NOTE_CONTENT_BYTES}`. Validate source
  SHA-256 and existing expectedStateRevision; preserve private defaults.
  Private write: `const receipt = await this.fileSystem.writeNoteWithRevisionGuardsAndReceipt(write,[{path:params.path,expectedRevision:params.expectedRevision}]);`.
  Shared write: `const receipt = await this.fileSystem.updateFrontmatterWithReceipt(update);`.
  Return receipt.revision, never a later read's revision.
- [ ] In src/createServer.ts forward expectedStateRevision. In
  src/llm-wiki-tools.ts document its conditional requirement and inherited prompt
  rules. Update README.md, _wiki/SCHEMA.md and existing MCP repeat-record tests
  to pass the previous stateRevision. Add real executor coverage.
- [ ] Review changes independently; run focused tests, `npm run build`,
  `npm test -- --maxWorkers=1`, and `git diff --check`.
- [ ] Stage only changed source/tests/docs/dist, commit and push fork main.
  Verify HEAD, origin/main and live remote hash. Preserve .agents/.mcpvault.

## Evidence

Implementation and verification pending. No completion claim yet.
