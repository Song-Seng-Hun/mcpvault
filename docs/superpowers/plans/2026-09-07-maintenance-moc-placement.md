# Maintenance MOC Placement Implementation Plan

> Execute inline with executing-plans and TDD; independent scoped review.
> User approved design and main integration; do not operate on the live Vault.

**Goal:** Remove impossible MOC-placement tasks and preserve exact repair context.
**Architecture:** Reuse hasAuthoredText and the existing membership preflight.
**Tech Stack:** TypeScript, real Markdown fixtures, Vitest, in-memory MCP.

- [x] Create src/maintenance-moc-placement.test.ts. Seed knowledge fixtures,
  check `Boolean(result.counts.no_primary_moc)` against a matrix of MOC kinds,
  lifecycle states and primary/legacy fields. Assert source bytes unchanged.
  Check empty root maps retain only empty_moc and that regular missing-member
  plans inspect `{path, view:'full', maxChars:5000}` via wiki.read_projection.
- [x] Run `npm test -- src/maintenance-moc-placement.test.ts --maxWorkers=1`;
  observe predicate/inspection failures, not fixture errors.
- [x] In src/llm-wiki.ts use:
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
- [x] Add MCP budgets512/1000/12000, private/hidden counts, real preflight
  revision and source preservation tests. Update README, _wiki/SCHEMA.md and
  src/llm-wiki-tools.ts descriptions to distinguish root maps and membership.
- [x] Preserve the complete ranked prefix when response-envelope overhead exceeds
  the budget. Subtract serialized removed-item/comma lengths and the one-character
  false-to-true flag difference, stopping at one item before compact fallback.
  Confirm counts and item order remain intact at exact and intermediate budgets.
- [x] Focused tests and npm run build; independent review; full
  `npm test -- --maxWorkers=1`; `git -c core.safecrlf=false diff --check`.
- [ ] Explicit source/tests/docs/dist commit; push origin main; verify hashes.

## Evidence

- RED: 19 failed / 8 passed, covering wrong map-kind exemption, truthy malformed
  placement and generic rather than exact-source inspection. GREEN: 27 passed.
- Five-file regression: 190 passed in 13.51s. Build and diff check passed.
- Real membership preflight retains an explicit contextual map and stamps the
  current source revision. Real MCP responses fit 512/1000/12000 budgets and
  expose five tools. Temporary source bytes unchanged; no live Vault writes.
- Initial independent review found no actionable defects; reviewer closed.
- Initial full suite exposed one integration failure, then was explicitly stopped
  (exit1) before rerunning the affected case. It is not counted as validation.
  Root cause: item-only packing overflowed after envelope addition and collapsed
  the entire list. New prefix tests reproduced 3 failures/1 pass. Fixed by
  subtracting removed tail item/comma lengths, including false-to-true truncation,
  before compact fallback. The affected integration test now passes unchanged.
- Added 2500/4000/7000/12000 prefix tests and an exact envelope boundary with
  escaped/Unicode text. Fresh build/diff check pass; final five-file regression:
  195 passed in 12.91s, including32 new tests. Delta review found no introduced
  actionable defects; reviewer closed. Fresh full suite: 2,666 passed / 1 skipped
  across173 files, 307.71s, exit0, one worker.
