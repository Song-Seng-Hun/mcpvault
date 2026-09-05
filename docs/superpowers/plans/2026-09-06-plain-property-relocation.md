# Plain Property relocation integrity

## Evidence and cause

The previous Markdown parity audit left plain Property paths unverified.
Four new regressions failed before implementation: inbound relative paths
were ambiguous despite an exact source location; outgoing references were
not rebased in root/folder notes; hidden relative inbound references were
missing from delete impact. `rewritePlainReference` omitted `sourcePath`
and only rewrote a moved target, never its source's relative destinations.

## Changes

- Pass containing/rendered source paths through managed Property rewriting.
- Resolve using the existing source-aware identity resolver.
- Preserve existing and future relative destinations, anchors, extension
  omission, and self references; preview reports actual move direction.
- Reject ambiguous or out-of-vault outgoing relocation before writes.
- Keep root targets explicitly relative so a basename cannot rebind.
- Reuse the same impact scan for deletion, retaining hidden-path redaction.
- No new endpoint, cache, client configuration, or live Vault mutation.

## Validation

- Four initial tests: red before fix, green afterward.
- Seven regression cases now include unsafe/ambiguous targets and stale
  revision rejection before any source/target mutation.
- Filesystem suite: 193 passed, 1 skipped.
- Full suite: 1350 passed, 1 skipped, 102 files (62.17 seconds).
- Luna scoped review completed and the reviewer was closed. Its case-sensitive
  comparison finding overlapped the already-applied normalization fix. Three
  further findings were reproduced with four failing tests, then corrected:
  source/destination access checks in the move service itself, non-ENOENT
  reference-scan errors fail closed, and authored surrounding whitespace is
  preserved. The access test proves the service boundary issue, not a bypass
  of the MCP adapter's separate external-path validation.
- Final full suite: 1354 passed, 1 skipped, 102 files (56.95 seconds).
- Final build and diff check passed. Compiled service smoke passed move preview,
  execution/re-read, denied access, and unreadable-reference rejection. Its
  owned temporary Vault was removed; no live notes or accounts were touched.

## Limits

This fixes managed plain reference relocation, not arbitrary strings that
look like paths. It does not re-author invalid existing references or change
authorization. The subsequent explicit note-extension collision audit and
fixes are recorded in `2026-09-06-explicit-extension-identity.md`.
