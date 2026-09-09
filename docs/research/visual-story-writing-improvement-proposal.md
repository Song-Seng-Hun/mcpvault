# Visual Story-Writing: MCPVault improvement proposal

Date: 2026-09-10

Status: research complete; recommended scope approved by the user on 2026-09-10
and implemented in the local checkout. This document preserves the pre-change
assessment and design rationale; see the [implementation plan](../superpowers/plans/2026-09-10-story-visual.md) for verification
and the [creative-workspace guide](../creative-workspace.md#source-linked-visual-editing) for the current contract.
The initial implementation did not change the running host. The user subsequently
explicitly requested NAS deployment and a current-branch fork commit/push; the
implementation plan records that verified deployment follow-up. No model provider
or economy policy was changed.

## Research basis

Masson, Zhao, and Chevalier, *Visual Story-Writing: Writing by Manipulating
Visual Representations of Stories*, UIST 2025.
[Paper, revised July 2025](https://arxiv.org/html/2410.07486v2)
and [author implementation](https://github.com/m-damien/VisualStoryWriting).

The prototype coordinates entity/action, location, and event views with linked
text passages. Selection scopes edits; writers inspect changes and navigate
alternatives. Manual edits can stale visuals. Its framework distinguishes
chronology from narrated order (sections 3–4).

Evidence is exploratory: study 2 involved eight experienced writers; study 1
found no significant differences on measured cognitive-load dimensions.
Preferences varied; some writers preferred highlighting over rewriting.
Authors report unintended model edits and 10–15-second latency. Long-story
support remains future work (sections 5–7). Literary-quality improvement is
not established by these results.

## Pre-change implementation, inspected directly

- `src/story-tools.ts` exposes eight dynamic story endpoints through the
  existing control plane. No visual-edit endpoint exists.
- `src/story-model.ts` permits explicit scene planning metadata, character
  knowledge layers, shots, and declarative branch graphs. It has no typed
  event-to-passage, participant-action, or participant-location model.
- `src/story-artifacts.ts` already supports separate artifact IDs, source pins,
  branch checks, request receipts, and guarded writes.
- `src/story-workspace.ts` centralizes access checks, dependency guards,
  bounded inventory, stale-source checks, and response continuations.
- `src/story-exports.ts` derives outputs from explicit presentation/chronology
  sequences and current sources. Canvas layout is not an authoring command.
- `docs/creative-workspace.md` documents editorial review and immutable
  adoption, with host execution rather than automatic model spawning.

The useful gap is therefore a structured, source-linked editing interface,
not another output format alone.

## Alternatives

| Approach | Benefit | Cost or limitation |
| --- | --- | --- |
| Extend MCP with source-linked projections and explicit edit proposals (recommended) | Reuses guarded artifacts and editorial workflow; usable by current agents | Not a drag-and-drop editor; client rendering remains separate |
| Only enrich exported Canvas views | Small, directly visible in Obsidian | Does not provide the input-to-revision workflow |
| Build a separate interactive editor | Closest to the paper's interaction style | Adds UI, authentication, synchronization, and model-execution decisions |

## Recommended first increment: proposed design

These are MCPVault design choices, not findings established by the paper.

1. **Source-linked story structure.** Store explicit event, entity, action, and
   location annotations with scene IDs and exact source revisions. Validate
   locators against the pinned body, including Unicode and Markdown fences.
   A matching quote demonstrates location, not the truth of an interpretation.
   Preserve the author's distinction between stated, inferred, and uncertain
   annotations. Empty or partial annotation sets must not imply completeness.
2. **Coordinated projections.** Propose one new dynamic `story.visual` endpoint
   under the fixed five MCP tools. Start with bounded event, interaction, and
   location projections sharing stable IDs and passage locators. Select scenes
   or events explicitly; never rely on pixel position to identify a target.
   Keep chronological order and presentation order separate, and leave unknown
   locations/times unknown. Legacy artifacts remain valid without annotation.
3. **Intent before prose.** Support explicit intents such as moving an entity
   within selected events, changing a selected interaction, and proposing an
   order change. A read-only preview reports the exact target, source pins,
   intended structured change, and affected passages. It does not claim to have
   identified every semantic consequence elsewhere in the manuscript.
4. **Separate, reviewable alternatives.** The current writer supplies candidate
   prose; the server does not call a model. Persist only an explicitly requested
   candidate with its source revisions and change intent. Preserve the original
   draft and prior adoption. Route editorial review and adoption through the
   existing roles. A sequence proposal must not silently update either order.
   Detailed schema and any application operation require the same revision,
   authorization, and idempotency guarantees as the existing artifact service.
5. **Honest drift and bounded context.** An upstream edit invalidates affected
   locators and projections. Require rereading/revalidation before applying a
   candidate. Never guess a new offset from an old quote or refresh pins
   silently. Pagination signatures must include source revisions, selection,
   and actor. Display uncertainty and source status alongside the projection.

First-increment exclusions: standalone browser editor, interactive Obsidian
Canvas interception, automatic extraction/rewrite API calls, new agents,
automatic continuity verdicts, style sliders, image generation, live-world
roleplay mutations, and funding/policy changes. Exported static Canvas must not
be described as interactive visual editing.

## Implementation and acceptance outline

1. Finalize one bounded annotation/intent contract and executable examples;
   identify service, schema, discovery, and documentation touchpoints.
2. Add failing model and locator tests, then implement validators and pure
   projections. Test duplicate IDs, malformed/unknown fields, wrong kinds,
   oversized inputs, ambiguous or changed locators, Unicode, and fenced text.
3. Add service tests before introducing preview and candidate persistence.
   Cover same-project/branch constraints, source and project revision races,
   hidden/deleted dependencies, revoked roles, disabled projects, read-only
   mode, idempotent retry, and partial failure without original-draft changes.
4. Verify MCP and REST use the same service. Keep the stable five tools intact;
   add every new write to capability discovery and read-only rejection paths.
5. Run a small fixture with a flashback, recurring character, and two locations:
   inspect a passage, propose a local move, compare a candidate, and reject a
   stale retry. Prove unchanged original text/adoption and unchanged unrelated
   scenes. Measure response bounds; do not label this a user study.
6. Run targeted tests, build, the full test suite, and `git diff --check`.
   Regenerate tracked `dist/` with the build; preserve unrelated work. Do not
   commit, publish, or push. Runtime activation is a separate checked step;
   do not restart the currently active host as part of researching this design.

Existing test suites to extend include `src/story-service.test.ts`,
`src/story-core-regressions.test.ts`, `src/story-tools.test.ts`, and
`src/story-mcp.test.ts`. New pure-model and service tests should be isolated
where that keeps ownership and failure diagnosis clearer.
