# Revision-guarded action detail recovery

## Evidence and contract

Long next-action previews and compact action packets returned a source revision
beside their readAction but omitted expectedRevision from the executable read.
An agent following that instruction could combine an old ranked action with a
new source body. Pass the exact captured revision through both read builders,
including the actionOmitted fallback, and reuse notes.read's strict guard.

Keep the existing ranked-prefix budget contract: never skip an expensive head,
truncate a path or remove the revision guard to fit. If necessary reuse original
request arguments to retry at the response ceiling. These are source guards,
not a lock or transaction over all prerequisites. A conflict requires a fresh
wiki.next_actions query and reassessment, not dropping expectedRevision.

## Verification

- RED: 6 failures (ordinary preview, compact/omitted actions and actual MCP
  recovery at 512/16000 characters); 52 existing cases passed.
- GREEN: the same 58 cases passed after changing the two read builders.
- Added actual MCP tests for sources hidden/deleted after the action snapshot.
- Final targeted suites: 60 passed. Build passed; full suite: 2,053 passed,
  1 skipped in 142 files (81.08s). `git diff --check` passed.
- Compiled five-tool MCP smoke verified 512/16000-character action recovery,
  exact captured revisions, successful unchanged reads and rejected changed
  reads without new source content disclosure. Temporary Vault removed.
- Independent review approved with no concrete findings; reviewer closed.
  No live Vault, accounts, client registration or server settings changed.
