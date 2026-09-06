# Checkbox task write receipts

## Reproduction

At 11dfc2e, updateTask re-read the source after writeNoteUnlocked. An external
editor changing/hiding the file in that interval supplied the receipt's revision;
deletion caused a successful write to be reported as failed. Passing the wrong
receipt into the next update could authorize editing unseen intervening content.
No-op responses similarly mixed their inspected status with a later revision.

Five real-file regressions reproduce these cases. The no-op injection is after
the second read (the actual task snapshot), not the earlier guard read; its
corrected baseline assertion failed with the later revision as expected.

## Fix and invariants

Use the existing unlocked write receipt's revision. No-op uses its captured
inspection revision. Do not re-read solely to form the receipt. Preserve locks,
stale-write checks, task parser, CRLF, exact block IDs, hidden-owner checks,
read-only capability rejection and the public notes.task_update endpoint.
Document that acknowledgement is not a latest-state guarantee. A follow-up read
is still required; another edit must invalidate a stale write guard.

## Verification

Run new/adjacent checkbox and shared receipt tests, build, full suite,
compiled MCP exercise, diff check and fork-only main commit/push.
Do not claim a cross-process compare-and-swap or roll back somebody else's edit.
