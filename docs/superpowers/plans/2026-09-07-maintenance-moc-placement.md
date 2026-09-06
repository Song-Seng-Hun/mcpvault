# Maintenance MOC Placement Implementation Plan

> Execute inline with executing-plans and TDD; independent scoped review.
> User approved design and main integration; do not operate on the live Vault.

**Goal:** Remove impossible MOC-placement tasks and preserve exact repair context.
**Architecture:** Reuse hasAuthoredText and the existing membership preflight.
**Tech Stack:** TypeScript, real Markdown fixtures, Vitest, in-memory MCP.

- [ ] Create src/maintenance-moc-placement.test.ts. Seed knowledge fixtures,
  check `Boolean(result.counts.no_primary_moc)` against a matrix of MOC kinds,
  lifecycle states and primary/legacy fields. Assert source bytes unchanged.
  Check empty root maps retain only empty_moc and that regular missing-member
  plans inspect `{path, view:'full', maxChars:5000}` via wiki.read_projection.
- [ ] Run `npm test -- src/maintenance-moc-placement.test.ts --maxWorkers=1`;
  observe predicate/inspection failures, not fixture errors.
- [ ] In src/llm-wiki.ts use:
  ```ts
  if (kind !== 'moc' && !hasAuthoredText(frontmatter.primary_moc)
      && !hasAuthoredText(frontmatter.moc)
      && !['archived', 'superseded'].includes(lifecycle)) {
    reasons.push('no_primary_moc'); score += 3;
  }
  ```
  Choose exact-source read_projection when missingAction or no_primary_moc.
  Keep empty_moc route and all current priority branches intact. Add membership
  instruction: inspect the source and chosen visible MOC, supply the complete
  additionalMocPaths set, then dry-run the returned change-set fingerprint.
- [ ] Add MCP budgets512/1000/12000, private/hidden counts, real preflight
  revision and source preservation tests. Update README, _wiki/SCHEMA.md and
  src/llm-wiki-tools.ts descriptions to distinguish root maps and membership.
- [ ] Focused tests and npm run build; independent review; full
  `npm test -- --maxWorkers=1`; `git -c core.safecrlf=false diff --check`.
- [ ] Explicit source/tests/docs/dist commit; push origin main; verify hashes.

## Evidence

Pending test execution.
