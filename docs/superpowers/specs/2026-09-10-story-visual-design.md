# Source-linked story editing design

Approved scope: the user selected the existing-MCP design, excluding a standalone
editor and automatic paid model calls, on 2026-09-10. Research and alternatives:
[research proposal](../../research/visual-story-writing-improvement-proposal.md).

## Contract

Add `visual_model` to ordinary story artifact kinds. Its `data` requires
`sourceSceneId`, `sourceSceneRevision`, and `visual: { events }`. Each event has
`id`, `actorId`, optional `targetId` and `locationId`, `action`,
`basis: stated | inferred | uncertain`, and `passage: { start, end, quote }`.
Offsets are zero-based Unicode code points over the exact `content` returned by
`story.artifact`, with an exclusive end. Maximum 64 events, action 300 code
points, quote 2000, source scene 20000. IDs use existing story validation.

Actors/targets must resolve to same-branch character artifacts and locations to
place artifacts; pin their current revisions, rejecting conflicting explicit
pins. The source must be a scene. Check locators before persistence and on each
visual operation. Fenced examples are not events. Repeated quotes are allowed
only because exact offsets disambiguate them. Overlapping annotations can be
read, but a selected edit must use distinct nonoverlapping spans.

Add dynamic `story.visual`, with `op: read | preview | propose`, default read.
The fixed five MCP tools remain unchanged. Required identity: `projectId`,
`modelId` (an artifact ID, not an authentication model), optional branchId.
Read selects `view: timeline | interactions | locations`, default timeline,
and optional `eventIds`. Results share event IDs and source locators; unknown
locations are explicitly unknown. Include project scene presentation and
chronology positions separately, or null when not sequenced. Outputs are
advisory and partial annotation, never inferred completeness or permissions.

Preview/propose require an exact `sourceRevision` for the visual model and an
intent with explicit eventIds (1..32):

- `move_entity`: actorId and locationId; every selected event must have that
  actor as actorId. A move here changes only that actor's selected occurrence.
- `set_action`: action; applies only to selected events.
- `reorder_events`: eventIds in the desired presentation order, at least two.
  It permutes selected passage contents into their original ordered slots;
  gaps and all outside text stay unchanged. This is a prose alternative, not
  a statement that chronological time changed.

Preview is read-only, pins all inputs, and returns before/after intent and exact
passages plus a fingerprint. Propose requires that fingerprint, the project
revision, a new artifactId, expectedRevision=missing, requestId, and title.
For move/action edits it also requires one replacement `{ eventId, content }`
for each selected event (no additional or duplicate targets). No semantic
claim is made that supplied prose fulfills the intent. Reordering accepts no
replacement prose. Final content remains bounded to 20000 code points.

Propose creates an ordinary `alternative` artifact, not a scene replacement.
Store typed `data.visualProposal` provenance (modelId, modelRevision, intent,
preview fingerprint, creation-time actorAccountId/projectRevision, exact changes), source pins, and the candidate body. This
kind already participates in review/adoption. Explicit scene creation and
sequence selection remain a separate editorial step; do not pretend adopting
an alternative replaces a sequenced scene. Existing screenplay blocks and
other source metadata are not copied as though revised.

## Boundaries and failures

Use StoryWorkspace access, current actor, participant, dependency closure and
StoryStore guarded write/retry behavior. Sources are scoped before projection;
hidden target names must not appear in errors or aggregates. Persist through
the artifact service, not generic Markdown writes. The proposal's source and
intent are revalidated in the common artifact path, so direct artifact calls
cannot forge a verified bounded proposal. Compare replay identity before a
stale-source check where possible, but never replay against a changed target
or bypass current author/delegation authorization.

Review/adoption revalidate typed visual data after direct host edits. Recompute
the historical fingerprint from the recorded creation context and the still
pinned input revisions; current authorization always uses the actual reviewer
or showrunner, never that historical actor. This also avoids making adoption's
own project bookkeeping invalidate an otherwise unchanged candidate. Missing
action targets remain null, not inferred self-interactions.

Stale visual operations fail with guidance to reread the source and author a
new model; `story.artifact` still exposes stale source diagnostics. Read
continuations are revision-, actor-, view-, and selection-bound. The response
must obey maxChars=512..12000 and never silently drop selected event changes.
Normalize all IDs and paths, validate host-edited YAML too, and cap dependency
closure at the existing 128-source / 8 MiB limits.

No new server model execution, UI, World/Roleplay mutations, automatic fixups,
external synchronization, commit, push, or publication. Work stays in the
existing shared checkout as previously requested; preserve all existing edits.

## Verification

Pure tests: valid/malformed schemas, Unicode quotes, changed and repeated
passages, matching backtick/tilde fences, selected overlap, replacement set
equality, unchanged surrounding text, reorder determinism, and bounds.
Service tests: model/reference validation, three projections, preview no-write,
candidate persistence/reread/retry, review/adoption without sequence rewrite,
source/project races, foreign branch, hidden targets, unauthenticated/outsider
and read-only writes, revoked authority, response bounds/cursor drift.
Adapters: discovery plus common service dispatch; rejection of unrecognized
ops/fields; fixed five tools. Run targeted suites, build, all tests and diff
checks. Technical tests do not establish literary quality.
