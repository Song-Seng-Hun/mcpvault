# Whole-response continuity projection

## Evidence

Resume capped only its body prefix, then returned all Properties and learning
state. Real saved cursors and pending edits made a 512-character request return
34,027 compact / 35,251 pretty characters. Eight initial regression tests failed
on the baseline, including validated and stale learning paths.

## Implemented behavior

- Count the final compact or pretty JSON, using a finite 512..12,000 budget.
- Preserve the validated learning action before optional history; keep topic,
  next action and a bounded body context before filling optional metadata.
- Include ordered prefixes of whole array entries. Never truncate mutation
  guards, identity paths or cursor values to make them appear usable.
- Mark truncation explicitly and return a bounded continuation. Source lines
  carry the original checkpoint revision. Tiny budgets require a larger resume
  when an intact learning action cannot fit; never emit a partial next target.
- Do not mutate stored Markdown. Raw historical reads do not validate progress.
- Update the endpoint description and schema documentation, not the fixed
  five-tool surface or client setup.

The old full-fixture test used a 1,200-character body allowance while expecting
all metadata and prose. It now uses 6,000 and asserts total size. New tests
cover small budgets independently. These limits bound output, not all source
reads or JavaScript allocations; original parsing/I/O boundaries are unchanged.

## Review and verification

Independent review found an initially unguarded source continuation. Seven
regressions then proved absent guards / silent reading of a replacement
checkpoint. Adding expectedRevision fixed them, including actual MCP calls.
The MCP fixture must register a session agent: the durable model-owner role
does not have the journal capability needed for continuity.save.

Targeted suites: 51 passed including 14 new tests, compact/pretty caps,
non-finite numeric budgets, intact guard entries, preserved learning safety,
unchecked pulse views, source continuation and concurrent checkpoint saves.
Final `npm run build` passed; full `npm test` passed with 1,804 tests and one
skip across 135 files (77.25 seconds); `git diff --check` passed. An isolated
compiled MCP smoke verified the five-tool surface, pretty JSON budget, a
validated next learning target, refusal after an underlying note changed,
revision-pinned source continuation, and refusal after another checkpoint save.
The live user Vault/server was not touched.

This batch resolves the observed resume projection failure. It is not a full
audit of authored MOC heading/block locator semantics or every learning-path
algorithm; those remain separate checks rather than implied completion.
