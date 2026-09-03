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

Evidence: `moc-navigation.test.ts`, `backlinks.test.ts`, `organization.test.ts`,
and the onboarding/context-pack/capacity integration cases in `llm-wiki.test.ts`.
These prove the named behaviors, not completion of the whole goal.

## Open work with concrete completion evidence

1. **Finish curator/synthesis consolidation.** The MOC scaffold need now lives
   in the existing candidate endpoint instead of a hidden API. Curator and
   synthesis intent still need to be traced through maintenance, answer-packet,
   decision, and publication workflows before adding any operation. Prove a
   new agent can discover and use the resulting path; preserve prerequisites,
   explicit cycles, Unicode titles, scope, evidence, and revisions. Never
   automatically declare source notes superseded because a synthesis candidate
   exists.
2. **Unify bounds and access across organization projections.** Audit direct
   service results as well as the generic MCP response limiter. At minimum and
   normal budgets retain a next step, exact identifiers/revisions, and honest
   truncation. Test hidden content, private paths, huge Properties, several
   MOC roots, concurrent changes, and external Markdown edits.
3. **Complete capture-to-permanent-knowledge continuity.** Fleeting capture,
   clarification lifecycle, destination collision, immutable-source distillation,
   and MOC draft placement are now connected by revision-bound next actions.
   Discussion promotion, completed-task lessons, and interrupted multi-note
   edits still need one end-to-end proof. Preserve the immutable work/edition
   source and distinguish evidence from navigational references.
4. **Make portable organization practical.** The content-free manifest is
   exported, but destination compatibility, property type drift, vocabulary
   collisions, stable IDs, missing relation targets, and a revision-aware
   migration preview still need an end-to-end workflow. Never copy private
   scopes, sessions, or derived caches.
5. **Validate retrieval utility with a representative corpus.** Combine Korean
   and English notes, ambiguous aliases, multiple classifications/MOCs,
   negative results, stale summaries, and long discussions. Check that a small
   packet includes enough reason/context to select a source, and that wiki
   knowledge remains discoverable as community volume grows.
6. **Reduce organizational burden.** Trace the same user intent through home,
   catalog, graph, packets, review, and repair endpoints. Remove duplicate
   rituals and contradictory advice; retain optional templates and a short
   first-entry path. Verify externally installed clients need only the
   endpoint/plugin/skill workflow the user requested.

## Completion gate

For each open workflow, inspect its actual registered schema, dispatcher,
service, guide, persistent Markdown result, invalidation behavior, and failure
tests. Prefer fixes that simplify an existing operation. Record a remaining
gap here rather than silently treating an unused helper as a shipped feature.
Run build and risk-relevant integration tests, then exercise the compiled MCP
surface on an isolated vault. Live-server deployment and fork push are separate
facts and must not be inferred from local tests.
