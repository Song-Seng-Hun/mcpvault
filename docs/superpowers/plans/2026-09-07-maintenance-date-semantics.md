# Maintenance Date Semantics Implementation Plan

> Execute inline with TDD and independent review. User-approved design/main
> integration, no live Vault changes, upstream work or extra client setup.

**Goal:** Stop malformed dates generating false chronology or review actions.
**Architecture:** Reuse organizationDateTimestamp and current revision guard.
**Tech Stack:** TypeScript, Vitest, temporary Markdown fixtures.

- [ ] Add src/maintenance-date-semantics.test.ts; exercise arrays, impossible
  dates, null, blank, natural language on date fields through maintenanceDebt.
  Assert invalid reason, no invented age/overdue/never-reviewed, exact patch
  guidance, no source edits. Run targeted tests and observe RED.
- [ ] In maintenanceDebt read each applicable date using the shared helper.
  Collect invalid_<field> only when value !== undefined and timestamp nonfinite.
  ```ts
  const updatedAt = organizationDateTimestamp(frontmatter.updated_at === undefined
    ? frontmatter.created_at : frontmatter.updated_at);
  ```
  reviewAt also uses shared helper; never_reviewed requires last_reviewed_at ===
  undefined. Add one6-point score for any date errors. The curationRoute date
  branch returns notes.read(path,maxChars5000) and dry-run notes.patch with
  expectedRevision, required oldString/newString or patches, evidence-only hint.
- [ ] Cover valid/missing fallback and offset dates, malformed review history,
  closed/hidden/private rows, bounds and real MCP discovery/response. Reuse
  existing streaming tests for changed revision and hidden aggregate handling.
- [ ] Update README/tool guidance. Build, focused tests, independent review,
  full npm test -- --maxWorkers=1, git diff --check.
- [ ] Commit explicit source/tests/docs/dist; push user fork main and verify.
