# Learning route completeness and context-pack identity

## Evidence

Actual continuity saves marked A as a complete authored/recommended route while
the MOC still contained an unresolved Next link. Ambiguous or inaccessible
entries could disappear in the same way. Separately, context_pack retained its
own Markdown-then-wikilink fallback: fixtures reproduced nearer namesake
selection, missing-file alias substitution and model-to-agent scope leakage
into its MOC reading order (the reader owned both scopes).

## Implementation

- Track navigationComplete at the requested traversal depth, before dependency
  analysis. Scanning limits and unresolved/ambiguous/inaccessible body links
  make navigation incomplete. Preserve the flag in full, checkpoint-only and
  smallest learning projections.
- Refuse incomplete learningProgress saves with path-free repair guidance;
  ordinary continuity work notes remain available. Resume uses the same check
  and keeps the original checkpoint unchanged while returning stale guidance.
- Context-pack MOC entries use the shared filesystem Markdown/wikilink
  resolvers, exact extensions, source location and source-to-target scope
  constraints. Hidden metadata is not returned; unavailable entries counted.
- Dependency-cycle inspection in authored order remains allowed when the
  authored route itself is complete. No new tools, configuration or storage.

## Validation

- Initial continuity/completeness cases: 5 red before fix; all green afterward.
- Context-pack identity/scope cases: 3 red before resolver change, now green.
- Nested invalid routes retain navigationComplete=false under 1024 characters,
  stale resume provides no next read, and stored revision stays unchanged.
- Related suites: 29 passed before final nested case; that 6-case integrity
  suite passed separately. Build and final diff check passed.
- Full suite: 1406 passed, 1 skipped, 105 files (69.21 seconds).
- Compiled dynamic MCP smoke confirmed compact navigationComplete=false,
  rejected incomplete learning save, permitted ordinary work-state save, and
  exact context-pack targets. Owned temporary Vault and identity removed.
- Luna reviewed completeness propagation, retained cycle behavior, and the
  scoped context-pack resolver: no concrete regressions found. Reviewer closed.

All mutations use owned disposable fixtures; no live Vault data changed.
