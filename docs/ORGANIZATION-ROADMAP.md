# Organization mechanism audit

Goal: make this an excellent, coherent knowledge-organization system, including
the unfinished ideas from earlier investigation. A helper, schema field, or
passing unit test alone is not evidence of a completed agent workflow.

Markdown, Obsidian Properties/links, immutable evidence, private scopes,
revision checks, and Git are the permanent foundation. No client daemon,
embedding installation, extra account ritual, or second history database is
required for ordinary use. The MCP surface stays at five discovery/execution
tools; new behaviors belong in the endpoint catalog.

## Verified mechanisms in the current batch

- MOC Home and graph hierarchy traverse whole branches in sibling order.
  Missing, ambiguous, and cyclic ancestry is explicit. Traversal is iterative.
- MOC context packets respect authored mixed-link order and preserve locators,
  accessible targets, current revisions, and hard response budgets.
- Fenced examples cannot become reading-order links.
- Filing-only and partial stale-projection edits cannot certify an inherited
  stale summary. Repairing only a fingerprint is not interpretation.
- Ordinary triage/publication can author tags and execution-capacity hints.
- A small orientation budget preserves a usable public first action.
- `on_upstream_change` now compares a bounded typed-relation revision/state
  baseline captured at publish/review time. Exact qualified paths and exact
  visible aliases/stable IDs resolve conservatively; outgoing dependencies and
  incoming support keep their correct direction. A completed review refreshes
  the baseline instead of reopening forever on an unchanged disputed input.
- Capture returns a revision-bound Clarify action. Clarify applies the selected
  lifecycle, rejects unsafe destination paths, reports destination collisions,
  and returns a move- or merge-preview action without moving/overwriting.
- MOC candidates now include current revisions, deterministic authored order,
  a bounded Obsidian Markdown draft, and collision-aware `notes.write` guidance.
  The suggestion remains non-mutating.
- Maintenance debt and the compact review packet now route one selected item
  through existing inspect/mutate endpoints with its current revision. Answer
  packets for decide/review expose a bounded synthesis plan that preserves
  inputs, names missing evidence/counterpoint stages, and routes to an existing
  review or proposed Decision Record rather than inventing a curator API.
- Community discussions and completed-task retrospectives share one promotion
  queue with revision-safe inspection and publication guidance. Social/task
  records remain provenance context, never immutable factual evidence.
- Private continuity checkpoints can preserve bounded pending edit guards
  (`endpointId`, path, expected revision, purpose) across interruption without
  locking notes or duplicating their bodies.
- Organization manifest v2 has a normalized contract fingerprint, optional
  global-only metadata readiness scan, contract/identity comparison, stale
  counterpart detection, and honest inventory truncation. Community, private
  scopes, whispers, bodies, sessions, and caches never enter that inventory.
- A representative Korean/English corpus test covers ambiguous aliases,
  multiple MOCs, negative knowledge, stale summaries, and long community
  noise. Bounded search keeps Wiki knowledge first and the selected answer
  packet retains a revision, counterpoint, stale-summary signal, and synthesis
  route.
- Home is now the single intent router rather than another dashboard. It maps
  find/capture/organize/decide/execute/review/repair/migrate to one existing
  endpoint, returns a live recommended action, and carries metadata-index
  revisions without reopening every note body. A 512-character response still
  preserves an executable endpoint and its required argument names.
- The Global Hub/Replica path now proves source-before-knowledge migration
  between two Vault roots. Immutable `_sources/` snapshots are approved first;
  dependent knowledge binds exact Hub evidence revisions and a signed portable
  organization fingerprint. Incompatible contracts and dirty target notes stop
  before overwrite, while private/Community paths are rejected even inside
  provenance.
- Organization projections now share a last-resort response compactor that
  retains revision locators, exact endpoint actions, curation/synthesis plans,
  and migration fingerprints without serializing credentials. Direct Home,
  answer, review, maintenance, promotion, and manifest tests cover minimum
  budgets. Public Home also excludes private/quarantined MOCs, ignores a huge
  irrelevant Property, and refreshes its revision after an external Markdown
  edit without a server restart.
- Knowledge applicability now has an explicit clock: `valid_from` is
  inclusive, `valid_until` is exclusive, and `observed_at`/`temporal_scope`
  remain separate from file, source, task, retention, and review dates. The
  live catalog can filter at a supplied instant, projections expose a compact
  temporal card, and expired/invalid validity re-enters bounded review.
- Answer packets now group cited snapshots into declared source works and
  expose integrity, locator-staleness, unavailable, and non-source counts.
  Several snapshots of one work no longer masquerade as independent
  corroboration; the result remains advisory rather than a truth score.
- Private continuity checkpoints now preserve a bounded research trail of
  short query/read/finding/decision summaries plus optional path/revision
  locators. Raw prompts, note bodies, credentials, secrets, and hidden
  reasoning remain outside the checkpoint.
- Structured claims now have a bounded claim/evidence matrix. Authored order is
  stable, attention priority is separate, snapshots are grouped by source
  work, and missing/unavailable/altered/stale/single-work evidence routes to an
  existing revision-checked review action without changing the note.
- Knowledge role and execution state are now orthogonal facets. A question,
  hypothesis, experiment, atomic note, or other ordinary knowledge note can
  carry bounded GTD/Kanban work Properties without being reclassified as a
  project or task; next-action, flow, dashboard, lint, and quality projections
  use the same actionable-note rule.
- Role-exclusive managed Properties now use one explicit `appliesTo` contract
  in authoring, lint, schema discovery, and reclassification. Changing
  `note_kind` reports incompatible fields before writing; an explicit
  revision-checked `clearInapplicable` retry removes only those managed fields
  while preserving Markdown, custom Properties, identity, evidence, retention,
  and cross-cutting capture/Clarify provenance.
- Dynamic capability search now degrades oversized endpoint schemas in two
  stages: it first removes schema prose while preserving field names, types,
  constraints, nested shape, and required arguments, and only then falls back
  to an identifier-only retry hint. This keeps large organization endpoints
  directly callable without violating the response budget.
- Actionability is now one shared semantic predicate across dependency
  resolution, flow health, Reflect, quality checks, lint, Home counts, and the
  compatibility-named `project_next_actions` Base. Waiting-only epistemic notes
  remain visible and can block dependents; sources/issues cannot accidentally
  enter the work graph. Terminal/someday or archived/superseded work is also
  excluded from current dependency stages through one shared open-work rule.
  Home reports historical and open work separately and routes only on open
  work without duplicating every work item into its compact launchpad.
- Obsidian-native spatial retrieval now has a deterministic JSON Canvas 1.0
  projection. MOCs preserve authored order, hierarchy, and prerequisite edges;
  ordinary notes use explainable proximity tiers. Preview and export remain
  bounded, carry source revisions and a snapshot fingerprint, exclude illegal
  cross-scope nodes, never copy note bodies, and write only a revision-checked
  scope-local `Views/*.canvas` derived file. No client helper or extra plugin is
  required.

Evidence: `moc-navigation.test.ts`, `backlinks.test.ts`, `organization.test.ts`,
`filesystem.test.ts`, `json-canvas.test.ts`, `continuity.test.ts`,
`global-sync.test.ts`, and the
onboarding/context-pack/capacity/retrieval/migration integration cases in
`llm-wiki.test.ts`.
The compiled `dist/server.js` is also exercised over a real stdio MCP client on
an isolated temporary Vault through orientation, capability discovery, and
`wiki.home` execution in `protocol-version.test.ts`.
These prove the named behaviors, not completion of the whole goal.

## Open work with concrete completion evidence

1. **Prove the low-friction route in an external client.** Home now removes the
   overlapping-dashboard decision from the protocol and the plugin/skill path
   needs no helper daemon, but exercise one newly installed external client
   from orientation through one selected workflow route before calling the
   usability goal complete.
## Completion gate

For each open workflow, inspect its actual registered schema, dispatcher,
service, guide, persistent Markdown result, invalidation behavior, and failure
tests. Prefer fixes that simplify an existing operation. Record a remaining
gap here rather than silently treating an unused helper as a shipped feature.
Run build and risk-relevant integration tests, then exercise the compiled MCP
surface on an isolated vault. Live-server deployment and fork push are separate
facts and must not be inferred from local tests.
