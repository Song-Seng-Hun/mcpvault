# Tag mutation integrity

Execute inline with TDD, systematic-debugging and verification-before-completion;
no new agents. User permits fork-main commit/push only.

## Contract

Public tag add/remove requires expectedRevision from a current read. Listing
returns its snapshot revision. FileSystemService serializes tag operations with
its existing per-note mutation locks, validates optional caller revisions against
the read snapshot, and rechecks that snapshot before writing. Internal callers
without a guard remain compatible but operate on the latest serialized state.
Successful writes notify the existing index callback and return previous/new
revisions. Hidden notes reject reads and writes without returning their tags.
Rejected/conflicting writes neither mutate nor notify. Invalid operations must
not fall through to a write. Formatting and Properties-only removal stay intact.

Alternatives: adding only a revision argument leaves unlocked read/modify/write
races and stale indexes; delegating blindly to updateFrontmatter rereads after
tag derivation and risks applying a stale computed set. Reuse the lock and event
mechanisms around the existing snapshot transformation instead.

No claim of filesystem CAS against arbitrary external writers or cross-process
locking. Recheck narrows external edit races but a final check/write gap remains.
Response-wide tag budgets, Properties validation and removal of inline tags are
independent work; do not confuse them with this mutation integrity correction.

## Tasks

- [x] Add real-file regressions: stale guard, two queued same-revision writers,
  unguarded additive edits preserving both sets, snapshot revision return,
  explicit index notification, hidden/invalid operations, external edit during
  read/transform. Observe failures before implementation.
- [x] Add expectedRevision/result revision fields, locked snapshot implementation
  and post-write notification; wire the schema/dispatcher and public guard.
- [x] Check real public MCP missing/stale/current revisions and existing readonly,
  source/community boundaries. Re-read the mutation target and derived tags.
- [x] Build/full tests/compiled isolated-vault smoke/diff check; document actual
  guarantees and limits; commit source/docs/tests/dist, push fork main only.

## Verification evidence

- Initial nine real-file tests failed for the expected missing guards, lost
  concurrent addition, missing notifications/revisions and hidden tag access.
- Focused filesystem/tag suites: 199 passed, 1 skipped. Public adapter/integrity
  suites after adding authenticated workflow and callback-failure checks:
  52 passed. All eleven new tests use real files; one read hook injects a real
  external edit deterministically instead of relying on timing.
- Corrected a misplaced TypeScript result-field declaration found by build;
  final build passed. Full suite: 1106 passed, 1 skipped across 73 files (47.94 s).
- Compiled MCP smoke: temporary authenticated account, revision-bearing tag
  list, missing/stale guard rejection, successful mutation, raw body/tags/revision
  re-read. Owned temporary vault and account removed after path validation.
- Inline review confirmed existing readonly/capability and source/community
  mutation boundaries are unchanged. Updated both API help and actual README
  add/remove examples, not just a separate prose section. No live-server restart,
  live-Vault edit, new MCP tool or client dependency.
