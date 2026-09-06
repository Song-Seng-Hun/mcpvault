# Cache Estimation Failure Plan

- [x] Reproduce unit and real metadata-cache failures with tests before edits.
- [x] Serialize once; return Infinity for missing representation or exceptions.
- [x] Verify cache rejection preserves result and row accounting, then recovers.
- [x] Document limits; build; independent bounded review; full one-worker suite.
- [x] Commit explicit source/test/docs/dist changes and push fork main only.

No live Vault changes, GPU/model work, client installation, or upstream PRs.

## Evidence

- RED: 12 failed / 11 passed across the two new test files. The actual cyclic
  Markdown sorted-cache test observed one retained cache where zero was expected.
- GREEN: 56 focused tests passed in five files; TypeScript build passed.
- Independent Terra review checked production estimator registrations, identity
  disposal callbacks, row accounting, tests and docs; no actionable defects.
  Reviewer closed. Full one-worker suite: 2,509 passed, one skipped across 168
  files, 321.09 seconds, exit zero. Build and whitespace checks passed.
- Design commit f6d0dd6; implementation f0ba4ed pushed successfully to
  Song-Seng-Hun/mcpvault main. No upstream operation or live-server restart.
- Known limits: generic serialization remains synchronous and allocates a JSON
  string. This increment fixes failed-size admission, not exact heap accounting,
  cycles throughout every frontmatter workflow, or serialization work budgets.
