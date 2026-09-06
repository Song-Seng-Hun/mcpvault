# Neighborhood derivation snapshots

## Reproduced gaps

Neighborhood borrowed link contexts/lines from a graph but replaced the
neighbor revision during enrichment. Old relationships could then appear to
belong to fresh text. Direct-link lines were not attributed to the root that
actually contains them. Final source checks were missing, and maxChars counted
only compact JSON even when the adapter returned pretty JSON.

## Changes and boundaries

- Request graph source/target revisions and compare root snapshots.
- Retain graph, shared-metadata and semantic derivation hashes independently
  from later enrichment; reject mixed/currently changed selected snapshots.
- Return contextPath/contextRevision independently from the target path/hash.
  Clear an old locator when a new context has no line number.
- Reuse bounded context validation with a neighborhood-only cap of 41 unique
  sources and at most four simultaneous revision reads. Other callers retain
  their prior cap of 32. Validate selected notes before character trimming.
- Measure pretty JSON on all response branches. Preserve scope access, fixed
  five-tool surface, Markdown authority and body-free neighboring projections.

Five regression tests failed before implementation. Coverage also includes
removed shared metadata, a stale semantic excerpt, optional semantic line
omission, and the full 40-neighbor validation capacity. Astra independently
reviewed the implementation and identified the optional-line boundary, which
was reproduced and repaired.

These checks do not provide an atomic filesystem census, detect every omitted
candidate's concurrent change, or prove all standalone graph APIs fresh. A
separate graph cache/target-resolution audit remains open. Character fitting
can omit candidates; unknown-length paths can require a larger explicit budget.

## Verification

- Nine new regression/boundary tests; 54 related tests pass with context,
  navigation-reference and Canvas suites. TypeScript build passes.
- Compiled five-tool MCP client smoke verifies two context locators against
  actual Markdown line numbers and hashes, excludes a hidden author, copies
  no peer body, and respects a 700-character budget in compact (406) and
  pretty (521) responses. Disposable Vault removed after verification.
- Full repository suite: 1595 passed, one skipped across 118 files (84.85s).
  Build and diff check passed before commit/push.
