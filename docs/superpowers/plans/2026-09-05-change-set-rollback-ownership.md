# Change-set rollback ownership

Inline TDD/verification; no agents. Fork-main commit/push authorized.

## Design

Keep whole-batch preflight, and re-read each checked writable target immediately
before its individual write. If an external edit is observed, stop and roll back
earlier owned writes rather than overwriting it. Track attempted writes only
after destination resolution and the per-file revision check.

During rollback read current content: original means already restored/no write;
exact planned content permits restoration; any other content or missing target
must be preserved and reported as incomplete rollback. Notify read-model
invalidation for restored or uncertain attempted paths. Errors disclose paths
and bounded reasons, not newly observed content. No silent success on divergence.

Unconditional restoration risks erasing external work. Filesystem atomic replace
would need a broader deployment/write-path audit; do not claim compare-and-swap
from check/write here. An uncertain partial failed write is also preserved rather
than falsely claimed restored. Existing Git/history remains the recovery route.
There remains an external check/write race and no cross-process lock.

## Tasks

- [x] Add deterministic real-file races at a later destination: external edit
  of an earlier written note, deletion of that note, edit of the next note.
  Confirm baseline overwrites/recreates them before changing production code.
- [x] Add per-write revision checks and conservative rollback content checks;
  preserve existing ordinary rollback and response-admission tests.
- [x] Build/full tests and compiled isolated-vault smoke. Update recovery docs
  and diff-check. Commit source/tests/docs/dist and verify fork-main publication
  separately after these checks.

## Verification

- The original three regressions failed against baseline: external edits and
  deletions were reported as restored, and the next target's edit was overwritten.
- Additional deletion-before-write regression caught missing invalidation; fixed.
- Five new cases cover those races, already-restored state, and a fresh successful
  transaction after failure. Existing normal recovery/admission/identity tests pass.
- Targeted: 200 passed, 1 skipped across five files. Build passed.
- Full: 1128 passed, 1 skipped across 77 files (50.64 seconds).
- Compiled MCP Client/InMemoryTransport smoke registered an ephemeral account in
  an isolated temp vault, previewed and attempted notes.change_set, induced an
  external edit plus later destination failure, and verified an MCP error reporting
  incomplete rollback without including the external body. Both files were reread;
  external A survived and B stayed original. Client/server closed and only the
  validated owned fixture (including its temporary account) was removed.
- No live Vault edits, server restarts, or new agents. Publication checked separately.
