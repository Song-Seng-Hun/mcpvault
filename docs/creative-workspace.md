# Creative workspace

Creative work is explicitly enabled per work, not by converting existing notes.
The nine dynamic `story.*` endpoints use the existing five MCP tools and the
same service for REST. There is no new editor, model runner, paid model call,
image generation, public publication or automatic shared-roleplay-world setup.

## Start with one brief

Read `wiki.policy` topic `story` only when doing creative work. Discover the exact
endpoint schema, then create `story.project` with `op: create`, a lowercase
`projectId`, `title`, `brief.medium` (`novel`, `screenplay`, `interactive`),
`expectedRevision: missing`, and a stable `requestId`. Optional brief fields are
`audience`, `genre`, `theme`, `style`, `targetLength` and `forbidden`.

`participants` and `showrunnerAccountId` are registered account IDs, never role
names or invented agents. The owner may update or revoke the showrunner with
the current project revision. Only that current delegate selects snapshots and
ordering. The delegation covers this work's creative decisions, not spending,
deployment, private-scope sharing or other works. Set `enabled: false` to stop
new creative mutations; an authorized session participant can still record a
pause. New projects are enabled by the explicit create action.

The associated Work project uses the same ID. If it already exists, its owner
and participants must match; add participants through `work.project` first.
The project read offers optional Snowflake, discovery/reverse-outline, screenplay
and interactive method sequences. These are selectable procedures, not rigid
templates or executable prompts.

## Draft, review, select

Use `story.artifact` for `bible`, `character`, `place`, `outline`, `scene`, `shot`,
`summary`, `alternative`, `rehearsal`, `branch_graph` or `visual_model`. Create needs
`expectedRevision: missing`; update needs the exact artifact revision. Both
also need `expectedProjectRevision` and `requestId`. Long prose lives in
`content` (up to 20,000 Unicode characters); metadata is optional and bounded.
Use a new artifact ID for an alternative. Kind and branch remain immutable.

Scene `data` can record `purpose`, `pov`, `tension`, `startState`, `endState`,
`reveal`, `targetLength`, `setupIds`, `payoffIds` and `chronologyLabel`.
`sources: [{artifactId, revision}]` pins dependencies within the same work and
branch. `references` uses normal public-safe references. Summaries do not
replace those originals. `data.layer` separates `world_fact`, `belief`,
`reader_reveal` and `author_plan`; `knownBy` lists narrative character IDs.
Those labels do not create access rights or prove consistency.

`story.sequence` stores explicit `presentation`, `chronology`, and `shots` ID
lists per branch. Presentation and chronology contain the same scenes in
potentially different orders; flashbacks are not contradictions. Canvas
positions cannot change these lists.

Create a `story.review` against `sourceRevision`; use a new `reviewId` for each
review. `pass` separates `structure`, `line`, `continuity` and `reader` review.
Each finding has `classification` (`confirmed_conflict`, `possible_conflict`,
`intentional_exception`, `unknown`, `suggestion`) and attributed `text`.
Findings are human/agent judgments, not a server-generated truth score.
The same account performing multiple roles is never independent consensus.

`story.adopt` takes the exact artifact revision, optional current `reviewIds`,
an explicit `reason`, and the current project revision. It creates an immutable
snapshot, then selects its exact path/revision in `Project.md`. A prepared
snapshot without that selection is not adopted. Editing a later draft does
not rewrite the selected manuscript. Stale dependencies block new adoption.
Rehearsal material must first be turned into an explicit scene or setting
candidate; a rehearsal trace cannot silently become canon.

## Source-linked visual editing

`story.visual` offers three bounded projections over explicitly authored
annotations: `timeline` (passage order), `interactions` (directed action edges),
and `locations` (entity placements, including unknown location). The same event
IDs and passage locators connect them. This is an MCP data interface, not a new
drag-and-drop editor or an interception of Obsidian Canvas gestures.
An absent action target stays null with `targetSpecified: false`; it is not
converted to a self-interaction. Authors can explicitly name a self-target.

First read the exact scene using `story.artifact`, then create a separate
`visual_model` artifact. Its data contains:

```json
{
  "sourceSceneId": "opening",
  "sourceSceneRevision": "<exact revision returned by the scene read>",
  "visual": {
    "events": [{
      "id": "arrival",
      "actorId": "iris",
      "locationId": "hall",
      "action": "enters",
      "basis": "stated",
      "passage": { "start": 0, "end": 21, "quote": "Iris enters the hall." }
    }]
  }
}
```

The example assumes the body starts with that exact sentence. Offsets count
Unicode code points, not UTF-16 code units or bytes; end is exclusive. Use the
body returned by the server, including its newline normalization. Quotes must
match at those offsets and may not overlap matching backtick/tilde code fences.
There are at most 64 events per model. `actorId` and optional `targetId` resolve
to same-project/branch character artifacts, while `locationId` resolves to a
place. These artifacts must already exist; their current revisions are pinned.
An ID such as `iris` may represent a nonhuman character too.

`basis` is the author's `stated`, `inferred`, or `uncertain` interpretation, not
a server verdict. Every projection reports partial coverage; absent annotations
do not prove absence in the story. Overlapping annotations can be read, but
selected edit spans must not overlap. A model is per scene, so large works use
explicit scene selection. Scene presentation and chronology positions remain
separate; unknown positions are null, never invented dates.

Use the normal `call_endpoint` executor for this flow:

1. `story.visual {projectId, modelId, view}` reads the projection. Here `modelId`
   identifies the `visual_model` artifact, not the caller's model family.
   Narrow with `eventIds`; continue with the returned item cursor. Changes of
   actor, selection, view, or sources invalidate that cursor.
2. `op: preview` takes the model's exact `sourceRevision` and an `intent`.
   Use `{type: "move_entity", eventIds, actorId, locationId}` or
   `{type: "set_action", eventIds, action}`. A move must name the actor of
   every selected event. Preview returns exact passages, before/after structure
   and a fingerprint without changing a note. Read all returned pages before
   authoring the candidate; the fingerprint covers the whole selection.
3. `op: propose` repeats those exact inputs and fingerprint, plus a new
   `artifactId`, `title`, `expectedRevision: "missing"`, current
   `expectedProjectRevision`, and `requestId`. Supply exactly one
   `{eventId, content}` replacement for each selected event. The current writer
   supplies that text; the server never calls a model or claims that it achieves
   the intended meaning. Surrounding text is retained.
4. Re-read the returned artifact ID. The result is an `alternative`, containing
   the candidate prose, source pins, and `data.visualProposal` patch provenance.
   Original scene, ordering, and prior adoptions are unchanged. Review with
   `story.review` and optionally preserve the alternative with `story.adopt`.
   To use it as a sequenced manuscript scene, explicitly create/review a scene
   from the chosen alternative and let the showrunner update scene selection.
   Adopting an alternative alone does not replace a sequenced scene.

`{type: "reorder_events", eventIds: [/* desired order */]}` selects at least two
events. It creates a deterministic candidate by permuting their original
passage contents into the original ordered slots, preserving intervening gaps;
it accepts no replacement text. Review transitions yourself. It does not change
chronological facts or project sequence lists. Proposal metadata does not copy
old screenplay blocks or scene planning metadata as if already revised.

Source changes invalidate the model or preview; reread and re-annotate rather
than moving old offsets or silently repinning. Use `story.artifact` to inspect
the stale model itself. Explicit `sourceRevision` and `expectedRevision` on a
visual read must match the model revision. `field` continuation is unsupported;
use item cursors, narrower selection, or a larger permitted `maxChars`.
Writes retain existing membership, read-only, revision, source-visibility, and
idempotency rules. Direct artifact writes with visual provenance receive the
same validation; the metadata is not an authorization grant. Review and adoption
revalidate visual structure and patch provenance after direct host edits too.
The proposal records the creating `actorAccountId` and `projectRevision` solely
to recheck its historical preview fingerprint; a different current reviewer or
showrunner can still review/adopt it. Those recorded values grant no authority.
Inputs must remain current for a visual retry; after drift, inspect the existing
alternative receipt and refresh context rather than treating the old preview as
a current permission token.

## Coordinate actual participants

`story.session op=start` names a scene, `sessionId`, `writerAccountId` and
`editorAccountId`. It creates a real proposed Work task naming the intended writer.
The host reads `work.packet`, claims/executes work, and uses existing Work
handoff/review procedures. Story stage is an editorial state, not an automatic
claim, independent review or completion of the Work task.

The writer submits an exact scene revision with `op: submit` (which self-claims
an unclaimed Work task as that authenticated writer); the editor records
`op: review` using its own matching review ID and `decision: changes_requested`
or `ready`. Two requested revision rounds are available. After that, or after
a ready review, the stage is `decision`. The showrunner adopts through
`story.adopt`, then records `op: decide`, `decision: adopt` or `reject`, and a
reason. `pause` stores a waiting reason; `resume` revalidates current authority,
Work assignment and sources. The explicit project step budget defaults to 32
and is bounded to 128. Budget exhaustion records waiting rather than starting
more execution. Nothing wakes a model or invents attendance.

Existing Workshops remain the discussion surface: contributions link the exact
artifact and review revisions instead of embedding long manuscripts in their
280-character contribution field. Structure designers and character/readership
reviewers use real existing accounts and the same artifact/review operations.

## Context and Obsidian

`story.context` selects a work, branch, optional scene and literal query. It
returns source paths/revisions, inclusion reasons, excerpts and stale flags,
with bounded continuations. For character rehearsal pass `characterId`; only
explicitly known material outside `author_plan` is included. This narrative
filter cannot make a model forget earlier information or replace real ACLs.

`Community/Stories/<projectId>/Project.md` is the linked manuscript entry point.
`Artifacts/`, `Reviews/`, `Adoptions/`, `Sessions/`, `Rehearsals/` and `Exports/`
hold ordinary Markdown records. Properties support native Obsidian Bases;
there is no required third-party query plugin. `fiction_domain: story` prevents
ordinary real-world answer/memory workflows from treating fiction as evidence.
These are Community-local records, not Global-synchronized material.

## Export and rehearse

`story.export` defaults to a read-only preview and `selection: adopted`.
Explicit `selection: draft` previews drafts. Formats are `markdown`, `fountain`,
`storyboard` and `canvas`. `op: write` persists an export under the work's
Exports directory with exact source revisions and a managed output manifest.
Read or check `health` before relying on an older output; changed upstream
sources make it stale, even when the selected snapshot still exists.
User-edited output is not blindly overwritten. Canvas nodes are file links,
not duplicated prose, evidence or permission. Story export health is separate
from the general neighborhood `wiki.canvas_health` contract.

Screenplay `data.blocks` distinguish `heading`, `action`, `character`, `dialogue`
and `transition`. Fountain export handles Korean forced character names and
isolates Obsidian links/comments from screenplay syntax. It is an export, not
a lossless round-trip converter or professional pagination engine.

Shot metadata pins `sourceSceneId`/`sourceSceneRevision`, `order`, `camera`,
`action`, `dialogue`, `sound`, `durationSeconds`, and existing image references
`images: [{path, revision?}]`. Missing images are diagnosed, not downloaded or
generated. Images remain reference assets.

`branch_graph` stores a declarative graph: typed variables, nodes and choices,
conditions, ordered effects, targets and explicit ends. Validation reports
broken references, unreachable nodes, cycles and dead ends without running
scripts. `story.session op=rehearse` executes a supplied choice sequence against
one exact graph revision and stores a bounded proposal-only trace. It never
changes `Community/Roleplay` or starts a shared world.

## Integrity and limits

Every mutation needs live authentication, capabilities, project membership and
revision guards. Generic note writes/deletes/moves cannot forge managed story
records. Direct host/Obsidian edits remain possible and are detected as changed
sources or invalid retry receipts, not treated as another database's truth.
Reuse one request ID for retries of the same logical operation and reread the
returned target. Do not retry an uncertain write using a fresh ID.

Responses use `maxChars` (512–12,000), page limits and revision-bound cursors;
larger fields use explicit field/body continuations. Each serialized story record (including
retained retry receipts) must fit 500,000 UTF-8 bytes before it is written.
Raw exports remain outside ordinary real-world answer/memory routing even when
their format cannot carry YAML frontmatter. Explicit story/path reads remain
available under the same access policy. Sources and output health
are advisory freshness indicators, never quality certification. Deterministic
tests verify workflow and safety. Claims of better character voice, causality,
scene necessity or reader preference require a separately recorded, controlled
same-model/similar-budget creative comparison; passing tests is not that study.
