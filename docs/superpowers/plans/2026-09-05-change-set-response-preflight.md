# Change-set response preflight

Inline systematic-debugging/TDD/verification. No agents; fork-main push only.

## Contract

Before applying a confirmed change set, prove that its success response can fit
the caller's character budget while retaining every path/revision. First omit
optional previews as already supported. If even the compact result cannot fit,
reject before writing or notifying; the same original revisions remain usable
with a larger budget. No post-write response-size exception may represent an
applied transaction as failed. Build the bounded response from the already
validated plan before disk mutation, return it only after all writes succeed.
Keep the existing write-failure/rollback errors intact.

Moving response admission before mutation is preferable to dropping paths or
inventing an untracked follow-up response token. It preserves the existing API,
fingerprint, exact request and Markdown authority without client setup.

## Steps

- [x] Reproduce on a real ten-note batch: large-budget preview, small-budget
  apply error, compare every original and mutation notification count.
- [x] Precompute full/compact successful result and reject impossible budgets
  before writes. Cover successful retry and compact successful response.
- [x] Build/full tests, compiled isolated-vault smoke, docs/diff check; deliver
  source/tests/docs/dist to user fork main and verify remote SHA.

## Verification and integration

- Baseline real-file regression returned a size error after changing Original to
  Changed. A second initial test confirmed optional-preview compaction already
  worked. New pretty-output and projected-path regressions also failed before
  those final adapter transformations were included in admission.
- Service accepts a trusted path projection callback for its receipt only and
  a prettyPrint option; disk plans and fingerprint remain internal/unchanged.
  MCP supplies its normal scope path mapper before admission, then serializes
  that admitted result with the same indentation. No post-write path remapping.
- Focused filesystem/adapter/receipt tests: 223 passed, 1 skipped. Final build
  and full suite: 1123 passed, 1 skipped, 76 files (51.13 s). Diff check passed.
- Compiled MCP smoke used a real isolated ten-note vault and ephemeral account:
  too-small pretty result rejected without changing any original revision;
  larger-budget retry with the same revisions/fingerprint succeeded, and all ten
  returned path/revision receipts matched re-read files. Owned temp data removed
  after path validation, no live Vault writes/server restart.
- Inline review retained actual write-failure rollback behavior and delayed the
  success return until after apply. Other mutation endpoints' response shaping,
  network delivery and concurrent external writers remain separate audits.
