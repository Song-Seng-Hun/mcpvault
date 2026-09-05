# Navigation view guards implementation plan

> Execute inline with executing-plans and TDD; no new agents, live Vault writes, or upstream contributions.

**Goal:** Automatically continued graph reads reject changed caller-visible result sets rather than silently skipping or mixing entries.

**Architecture:** Opt-in query fingerprints in VaultGraphIndex flow through the shared filesystem service into the four existing MCP graph adapters. Fingerprint all admitted rows, not merely the page, after visibility/masking. Stream each source's rows into SHA-256 and combine source digests in ordinal path order; this avoids retaining every link and is independent of index insertion order. Bind endpoint kind, target and parsed target/source revision where applicable. Keep default internal service output compatible. No retained snapshot/session or new client setup.

**Tech stack:** TypeScript, node:crypto, existing graph/services, Vitest and compiled in-memory MCP.

## Contract and alternatives

A server-wide generation would invalidate public reads on unrelated private
changes. Retained cursor snapshots would add state, memory and expiry rituals.
Use content fingerprints of admitted projected rows instead. They detect changes
in the observed derived query view, not unobserved filesystem edits or an atomic
Vault transaction. Unchanged results remain reusable after unrelated mutations.
Backlink traversal with asynchronous source checks rejects observed generation
changes during traversal instead of certifying a mixed view.

Public pages include `snapshotFingerprint`; their nextAction carries
`expectedSnapshot`. It is optional for legacy manually authored offset calls.
A malformed fingerprint fails validation. A mismatch raises a bounded error:
restart at offset 0 without expectedSnapshot; no continuation rows are returned.
Same-position budget retries preserve the original expectedSnapshot. Fingerprints
are query-view guards, never permission tokens or write revisions.

## Steps

- [x] Add deterministic service/public tests: changed off-page backlinks,
  outlink edits, unresolved repair, orphan membership; unchanged page budgets,
  hidden-only edits and graph rebuild; query mismatch and malformed guard;
  asynchronous backlink invalidation. Run them before implementation.
- [x] Add `NavigationViewFingerprint` with per-source streaming hashes and
  ordinal combination; opt-in `includeSnapshot` on four graph/services;
  incorporate masked full result rows before slicing and reject observed
  backlink traversal drift.
- [x] Add optional expectedSnapshot to four existing dynamic schemas, validate
  in packNavigationPage before any result text, and retain it in nextAction.
  Update exact output tests without dropping assertions on existing fields.
- [x] Update descriptions/README/schema/roadmap, run targeted tests, build,
  full regression, diff check, and compiled guarded MCP continuation.
- [ ] Commit source/tests/docs/dist and push only Song-Seng-Hun/mcpvault main.

Test entry point: `npm test -- src/navigation-view.test.ts src/navigation-page.test.ts src/navigation-page-packing.test.ts`.
The service fixture uses explicit graph.invalidate after owned temporary file
mutations so freshness tests do not depend on timers/watch delivery. Public
continuation tests consume returned arguments unchanged and authenticate locally.

## Verification and inline review

- Full regression: 1200 passed, one skipped, 87 files (58.64 seconds).
  Build and whitespace verification passed.
- Ten baseline service/packing regressions failed before implementation; four
  public adapter regressions then failed before adapter integration.
- Targeted integration: 79 tests passed across six files. Expanded navigation
  coverage: 24 tests passed across three files. Build passed.
- Compiled MCP: five stable tools; guarded continuation succeeds before an
  off-page mutation, rejects after it, and succeeds with the new fingerprint
  after restart. Mutation bytes were re-read. Owned fixture removed; no live
  Vault changes or new agents.
- Reviewed shared adapter/service flow, optional internal compatibility,
  post-visibility hashing, query binding, source insertion-order independence,
  budget retry preserving guards, and generic no-row mismatch errors.
- Cost boundary: fingerprinting adds hashing/projection work over admitted
  results; it does not introduce a second full edge collection or retained
  historical views. Source-hash storage scales with matching sources. Very
  dense same-line context redaction remains a separate performance audit.
