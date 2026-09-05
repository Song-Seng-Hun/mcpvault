# Canonical mutation lock identity

Execute inline with TDD and verification-before-completion; no new agents.
The user authorizes fork-main commit and push only.

## Design

Keep path authorization and actual file paths unchanged. Derive a lock-only key
from the absolute lexical resolved path after separator normalization. Fold case
conservatively so common case-insensitive filesystem aliases also serialize;
distinct case-sensitive files may unnecessarily share a lock but never become
the same note. No path rewriting, symlink access grant or scope equivalence is
inferred from a lock key.

Both single/multi-note entry points use the same key. Multi-lock acquisition
deduplicates canonical keys before acquisition and uses deterministic ordinal
order, not locale-sensitive collation. A private key-level acquisition helper
avoids canonicalizing an already canonical key as an input path. Existing finally
release behavior remains. Locks remain local to one FileSystemService instance;
cross-process writers, hard links and Unicode filesystem normalization are not
certified by lexical keys.

Fixing only the single-path map would introduce self-deadlock when two guard
paths collapse to one key. Globally changing normalizePath would alter access,
display and identity behavior beyond this task. Use a lock-only boundary instead.

## Tasks

- [x] Add deterministic paused-read tests: relative and absolute aliases must
  queue behind a current tag edit; multi-guard equivalent paths must finish;
  failed operations release the same lock for a later valid operation.
- [x] Implement common key derivation and canonical dedup/order; keep security
  path checks in the actual operations. Run relevant filesystem/tag tests.
- [x] Build/full tests/compiled isolated-vault concurrency smoke/diff check.
  Update README/schema/roadmap with actual scope. Commit and push source/tests/
  docs/dist only to the user fork, and verify remote main SHA.

## Evidence and limits

- Corrected the test's guarded-write method name before evaluating failures.
  Baseline then failed for `./Note.md` and `dir/../Note.md` entering while a
  first read was paused. Absolute paths and failure cleanup already passed.
- Focused filesystem/tag/lock suites: 194 passed, 1 skipped. Seven final lock
  regressions passed, including overlapping guarded writes and actual spelling.
  Full suite: 1113 passed, 1 skipped across 74 files (47.82 s). Build/diff check
  passed. Tests use a controlled pause around real reads, not arbitrary sleeps.
- Compiled FileSystemService over an isolated real vault: two aliased tag
  additions serialized and both survived; equivalent related guard keys completed
  without self-deadlock; the actual target was re-read. Owned temp vault removed
  after absolute path validation; no live Vault or server changes.
- Inline review verified lock folding is never passed to file IO or permission
  checks. Existing guard validation is not redefined as canonical note identity.
  Distinct path aliases in change-set semantics require a separate validation
  audit; lock dedup alone is not proof that duplicate semantic edits are valid.
  Cross-service/process, hard-link, Windows trailing-segment and Unicode alias
  completeness remain outside the demonstrated lexical lock contract.
