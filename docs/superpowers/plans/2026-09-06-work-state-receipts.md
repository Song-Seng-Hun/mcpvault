# Work-state and task receipt consistency

## Reproduction

Against `1715bd4`, five actual external-editor interleavings failed: first and
replacement continuity saves, task creation, completion with retrospective,
and completion with explicit no-reusable-knowledge reason. Post-write reads
reported the later version; task completion combined the first status with
another editor's lesson/reason.

## Correction

- Reuse `writeNoteWithReceipt` for continuity save and task creation/update.
- Keep the already normalized and validated task disposition fields paired
  with their own write revision, rather than reading a later file version.
- Keep ownership checks, completion gate, scope paths, revision checks, private
  continuity content and MOC drift validation unchanged.
- No new MCP endpoint/tool, storage schema, client setup or background writer.
- Explain own-write receipts versus current-state resume/task reads.

## Verification gates

- Five red/green race tests, stale subsequent edit rejection, private path and
  compact continuity response, existing continuity/collaboration regressions.
- Build, full suite, scoped review, compiled MCP task/continuity smoke, diff check.
- Generated dist and user-fork-only commit/push after verification.

Verified: all five races failed before the fix; 36 focused tests passed. Full
suite: 1,556 passed, one skipped, 116 files. Build passed. Luna found no
actionable issue in the scoped diff and was closed. The first compiled smoke
had an incorrect test assertion (`read.status` versus `read.fm.status`); after
checking the read contract, the corrected smoke passed continuity save/resume,
private receipt identity, task creation/completion/re-read, the completion gate,
stale checkpoint rejection and fixed five-tool exposure. Both temporary Vaults
and their accounts/tasks/checkpoints were removed. Diff check passed.

## Limits

Receipts do not make external writers atomic or prevent a newer checkpoint.
The optional continuity save guard retains its existing behavior; callers
should pass the revision from their inspected current checkpoint. Other
services' mutation response contracts still need separate auditing.
