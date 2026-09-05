# Move and review snapshot parity

## Requirement and evidence

Knowledge organization should neither create false maintenance debt after a
pure rename nor certify old summaries as current after rewriting note bodies.
Indexed and fallback fixture tests showed moving an unchanged target to the
Vault root rewrote its stored review path as ../Target.md or ./Target.md while
the current baseline used Target.md, spuriously triggering on_link_change.
The no-auto-certification tests already passed and remain regression guards.

## Implementation

- Distinguish captured file identities from authored Property reference text.
- Only producer-defined `.path` slots under review_basis_links arrays,
  review_basis_upstream.entries arrays, pending_edits arrays and research_trail
  arrays receive canonical snapshot rewrite semantics.
- Snapshot paths match the exact physical move source, not basename/alias
  resolution; same-name notes elsewhere cannot introduce false ambiguity.
- Preserve captured revisions and all summary/review hashes.
- A resolved upstream entry compares its actual path rather than its display
  target spelling. Missing/ambiguous entries retain the authored target; claim
  IDs/digests, lifecycle/state, and ordinary revision checks are unchanged.
- Scope, mutation transaction, bounds and read-only capability contracts are
  unchanged. No live Vault data, accounts, server configuration or new tools.

## Review and validation

- Initial on_link_change rename regression: two failures before fix, both pass
  afterward. Two existing-summary digest guards also pass.
- Two consecutive renames with a same-name note elsewhere stay quiet; an
  actual later edit still triggers review in indexed and fallback modes.
- Four snapshot root fixtures preserve paths/revisions and create no graph edges.
- Upstream support rename reproduced a display-target comparison failure;
  both dependency/support rename tests pass after fixing it, while actual
  evidence edits still trigger upstream_changed.
- Luna independently confirmed that failure (its test ran before the local fix)
  and identified over-broad nested path classification. A red shape test led
  to exact producer-shape matching. Reviewer closed.
- Targeted tests: 230 passed, 1 skipped. Final build and diff check passed.
- Final full suite: 1374 passed, 1 skipped, 103 files (59.18 seconds).
- Compiled service smoke confirmed canonical captured paths and original
  revisions, quiet link/upstream review after a pure rename, and both policies
  triggering after an actual evidence edit. Owned temporary fixture removed.
