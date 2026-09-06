# Reflect detail recovery pins captured source revisions

## Evidence and contract

Compact dashboard rows and the tiny selected-item view returned a source
revision but omitted expectedRevision from the executable notes.read action.
Following that action could combine old review context with a changed body.
Pass the captured revision through both builders; reuse the existing strict
notes.read check rather than implementing another access/revision path.

Preserve response budgets, exact source identities, category priority and
same-review retries. Never drop a revision guard, clip an identifier, or skip
an oversized first target to fit. On a revision conflict, repeat the review
and reassess the current source; do not remove expectedRevision. This guards
one source read, not a transaction over all dashboard sections or dependencies.

## Verification

- RED: three budget tests failed; four actual MCP tests failed on the missing
  guard. Existing ten packing and 48 MCP cases passed.
- GREEN: all 65 tests passed after updating the two read builders.
- Actual MCP: unchanged recovery succeeds; changed source yields
  revision_conflict without its body; hidden/deleted source recovery rejects.
- Independent review checked both builders and captured source revisions;
  no issues found, worker closed.
- Build, git diff --check and compiled isolated five-tool MCP smoke passed.
  The smoke follows both 512/6000-character recovery paths, confirms unchanged
  source reads, and rejects changed bodies without exposing their content.
  No live Vault/server was touched.
- Full suite: 2,091 passed, one skipped across 144 files (96.58s).
  This closes the recorded Reflect recovery gap, not the broader goal.
