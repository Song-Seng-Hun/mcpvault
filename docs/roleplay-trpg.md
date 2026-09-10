# Optional declarative TRPG

TRPG is an opt-in extension of the existing roleplay journal. Existing worlds
stay legacy until a host administrator explicitly adopts one exact ruleset.
Adoption is permanent for this version of the subsystem: replacing an adopted
ruleset requires a separately reviewed migration, not an implicit upgrade.

This document describes the roleplay service implementation and the parent
integration contract, including guarded managed artifact persistence. Dynamic
MCP registration and deployment remain parent work; these files do not claim that
the live endpoint or Obsidian files have been deployed.

## Default preset

The original preset is `mcpvault-adventure@1.0.0` (no third-party game rules).

| Field | Initial value / rule |
| --- | --- |
| strength / agility / intellect | 2 / 1 / 1 |
| HP maximum | 8 + 2 × strength = 12 |
| focus maximum | 3 + intellect = 4 |
| defense | 10 + agility = 11 |
| growth | 3 fictional points, independent of XP and wallets |
| initial skill / active loadout | `attack` / `default` containing `attack` |
| actions per turn / switch cost | 1 / 1 |
| initiative | d20 + agility, descending; ties use ascending character ID |
| loaded skills | up to 3; up to 8 named loadouts |
| equipment | `hand` and `body`; shield occupies hand and adds 2 defense |

| Skill | Prerequisite | Growth cost | Focus cost | Effect |
| --- | --- | --- | --- | --- |
| attack | none | 0, initially learned | 0 | d20 + strength ≥ target defense; on hit deal 2 + strength = 4 HP |
| guard | attack | 1 | 0 | self only; add 2 + agility = 3 defense until the start of the next own turn |
| heal | attack | 2 | 2 | restore 3 + intellect = 4 HP to one encounter participant, capped at maximum |

This is an original small branching tree: `attack → guard` and `attack → heal`.
It does not claim to implement an external game standard.

Each skill use costs one action, including an attack that misses. Healing may
restore a character at HP 0. HP 0 means incapacitated, never permanent death.
Incapacitated participants are skipped during turn advancement. An encounter
ends only by an explicit GM command (or no conscious participants during an
explicit turn-end); no clock, offline duration or model response advances it.
`rest` explicitly restores resources and clears statuses outside combat.
Rest is a controller action in this preset; travel/time/rest-site simulation is
not implied. Host-only `growth` grants 1–100 fictional points per command,
capped at 100,000 per sheet, without an economy ledger operation.

Shield ownership comes from the existing inventory, not from learning or
equipping a skill. Creating the shield type in this preset does not mint one.
Use the existing host `roleplay.world` item operation and normal transfers.
Equipment must be owned and fit unique slots. Transfer of active equipment
requires unloading it first. A saved inactive loadout can become unavailable
after a transfer; it is revalidated when activated.

## Ruleset contract

`defaultTrpgRuleset()` returns a fresh complete preset. Alternatively, an
administrator may adopt a bounded declarative `ruleset` object. The schema is
exported in the `manage_roleplay_trpg` tool and validated again by the reducer:

- `id`, exact numeric `major.minor.patch` version, fixed initial `attributes`;
- derived formulas are `{base, terms: {attribute: integerCoefficient}}`;
- resources map to derived maximum IDs; `hp`, `focus`, `defense` are required;
- skills declare IDs, prerequisite IDs, exclusion IDs, growth costs, one of
  `attack|guard|heal`, an attribute, bounded power and focus cost;
- initial skills, initial growth, equipment definitions/slots, loaded skill
  capacity, actions per turn, switch cost and initiative attribute.

No scripts, expressions, dynamic imports, eval, functions, arbitrary effect
language or permission fields are accepted. Attribute values are 0–20; formula
bases 0–100 and coefficients 0–10. Limits are 12 attributes, 16 derived stats,
8 resources, 64 skills, 16 prerequisites/exclusions per skill, 64 item definitions,
8 equipment slots, 8 loaded skills, 8 loadouts and 20 encounter participants.
Ruleset content is cloned into the canonical adoption event and identified by a
stable SHA-256 fingerprint, so replay never fetches a mutable external preset.

`capability-graph.ts` exposes two named pure reuse adapters:
`validateLearningPathConfiguration(input: unknown)` and
`validateProceduralBundleConfiguration(input: unknown)`. Both accept exactly
`{id, version, nodes: CapabilityNode[], selected: string[]}`; a node is
`{id, requires: string[], excludes: string[], cost: number}`. They share the graph
and selection validators (128 nodes, 16 prerequisites/exclusions per node),
reject unknown fields, missing prerequisites, conflicts and cycles, and return
`CapabilityConfigurationCheck`: `{kind, id, version, valid: true, nodeCount,
selectedCount, totalCost, fingerprint, executable: false, permissionsGranted: false}`.
`kind` is `learning-path` or `procedural-bundle`; the SHA-256 fingerprint is
stable under node/reference/selection reordering. Invalid inputs throw.
No procedures, scripts, agents, permission changes or wiki learning-engine
rewrites occur. Parent's read-only `configuration.check` selects these adapters;
the same module also exports `validateCapabilityGraph`,
`validateCapabilitySelection`, and `capabilityRemoval` for internal use.

## Operations and examples

Parent endpoint mapping: `roleplay.trpg` → `manage_roleplay_trpg` →
`RoleplayService.execute('trpg', arguments, authenticatedPrincipal)`.
All examples below are endpoint arguments. Writes also require `accessToken`,
a new stable `requestId`, and the latest `expectedRevision`. Identity is derived
from the token. Do not send actor IDs or dice outcomes. Reuse the identical
request ID/arguments after response loss, rather than issuing a new action.

```json
{"op":"adopt","preset":"mcpvault-adventure@1.0.0","requestId":"adopt-v1","expectedRevision":"<world revision>","accessToken":"<host token>"}
```

Existing characters receive fresh sheets on adoption; subsequently registered
characters get sheets with the same pinned defaults. Existing narrative
definitions, legacy stats, inventories, lore and journal history remain intact.
Sheet resources/attributes are separate from legacy narrative stats/flags.

```json
{"op":"read","characterId":"alice","maxChars":4000}
{"op":"learn","characterId":"alice","generation":1,"skillId":"guard"}
{"op":"learn","characterId":"alice","generation":1,"skillId":"heal"}
{"op":"loadout","characterId":"alice","generation":1,"name":"support","skills":["attack","guard","heal"],"equipment":[]}
{"op":"switch","characterId":"alice","generation":1,"name":"support"}
```

Learning checks the prerequisite DAG, exclusions, available growth and current
controller/generation before atomically changing anything. Loadout editing,
learning and respec are unavailable in combat. Switching an already validated
saved loadout in combat requires the current character's turn and consumes the
configured action cost, even when its contents resemble another loadout.

```json
{"op":"encounter_start","roomId":"hall","participants":["alice","bob"]}
{"op":"read","roomId":"hall","maxChars":4000}
{"op":"act","characterId":"alice","generation":1,"roomId":"hall","skillId":"attack","targetId":"bob"}
{"op":"turn_end","characterId":"alice","generation":1,"roomId":"hall"}
{"op":"encounter_end","roomId":"hall"}
```

Start/end require the current designated scene GM, who must still be a host
administrator or delegated GM. Participants must be co-located, conscious, and
not in another active encounter. Wait for the actual initiative read before
choosing which controller sends `act`. Each receipt's `mechanics` reports the
attack check (die, modifier, total, defense, success), changed resources/growth
and resulting encounter turn/action state. An unsuccessful attack still has a
committed receipt and paid action cost.

Registered `act` responses also contain the following host-authored provenance,
persisted in the receipt and returned identically on retry/replay (under 256
JSON characters). This direct deterministic path has no GM/model dispatcher:

```json
{"route":{"kind":"registered_action","reason":"Registered declarative mechanics resolved under the canonical writer.","skipped":["gm_dispatch","model_dispatch"]}}
```

An unknown skill is rejected without dice, a pending GM request or automatic
model dispatch; explicitly submit a creative `attempt` when that is intended.
Route metadata cannot bypass revision, actor, generation, room or cost checks.

Unknown creative actions retain `roleplay.action` `attempt` and the existing
GM `resolve`. During combat they require the current turn and available action;
the pending request pins the mechanical basis. GM resolution spends one action
atomically with validated legacy effects. A changed basis requires resubmission.
Legacy move/take/give/use/correct cannot bypass combat costs or move active
participants; moving them requires ending the encounter. Narrative speak/OOC
does not consume combat resources or create mechanical effects.

```json
{"op":"respec_preview","characterId":"alice","generation":1,"remove":["guard"],"accessToken":"<alice token>","maxChars":4000}
{"op":"respec","characterId":"alice","generation":1,"remove":["guard"],"previewFingerprint":"<preview fingerprint>"}
```

The preview includes dependent removals, exact refunds and
every affected loadout entry to unload. It is paginated; inspect all pages.
In the branching preset, removing `guard` leaves `heal` intact and refunds one
point. In a custom graph with `heal` requiring `guard`, both are removed and
their purchase costs refunded; the regression suite exercises this dependency.
Applying that exact revision/fingerprint atomically unloads affected entries,
removes skills, and refunds their pinned purchase costs. Initial skills cannot
be removed/refunded. Any intervening journal change invalidates the preview.

## Durability, validation and disclosure

The canonical roleplay Markdown turn, trusted checkpoint and prepared file
remain the only durability mechanism. No new log or database is introduced.
The single writer first rechecks access/room/reference guards and preflights the
pure reducer, including revisions, controls, costs, targets and storage capacity.
Only then does it draw d20s with Node cryptographic `randomInt(1, 21)`.
Recorded dice are internal command metadata in the prepared canonical turn.
Service parameters and direct store transactions reject caller-supplied rolls.
The deterministic reducer accepts only the exact recorded count/range on replay.
Every committed retry revalidates its original receipt's exact turn path and
room, including inside the store writer callback. Ending an encounter does not
make a previous switch receipt's room check disappear. A hidden/revoked room
or turn path blocks disclosure without consuming dice or changing world state.

Prepared successor recovery covers interruption both before and after pending
checkpoint persistence. Once the prepared event is durable, restart/retry uses
the same bytes and outcomes. A crash before any durable prepared event exists
has no committed outcome. Existing dead-writer recovery/fencing is still
required after an actual process crash; this change does not steal writer locks.
Recovery writes no additional schema/database and does not advance a game turn
without an already prepared command.

All reads use the existing bounded cursor/pagination contract; hidden scene
encounters are filtered before totals and initiative details. Current sheets
remain shared fictional world state, as existing character state is; character
knowledge is not a separate secrecy boundary. Existing lore/access validation
and roleplay-versus-knowledge separation continue to apply. Ruleset fields are
strict IDs and numbers and cannot carry arbitrary note references.

## Managed Obsidian output and parent integration

`trpgArtifacts(state, characterId)` returns deterministic exact bytes for:

- `Community/Roleplay/Sheets/<id>.md`: managed sheet, skill headings and inventory;
- `Community/Roleplay/Sheets/<id>.canvas`: file nodes linking that sheet's skill
  headings, prerequisite edges, source revision and ruleset fingerprint;
- `Community/Roleplay/Sheets/<id>.base`: a table over that exact sheet.

Platform device basenames (`con`, `aux`, `prn`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`)
are escaped with one underscore in derived filenames only, for example `_con.md`.
Canonical character IDs and record metadata stay unchanged. Because canonical IDs
cannot contain an underscore, the mapping is collision-free; ordinary filenames
remain unchanged. Canvas/Bases links and managed-file validation use the same mapping.

`{"op":"export","characterId":"alice","maxChars":4000}` returns these as
paginated `{kind:"artifact", path, offset, text, continued}` rows. Offsets are
Unicode code-point offsets; concatenate in order separately for each path.
Export is a read: no files are written. It first returns three bounded
`{kind:"projectionTarget", artifact:"sheet"|"canvas"|"base", path, revision,
managed, sourceRevision?}` rows; absent files have revision `"missing"`.
The cursor pins both world state and target metadata; changes invalidate it.
Existing character/context projections
include bounded sheet/resource/skill/loadout rows, and world reads identify the
adopted ruleset. Canvas positions/colors are advisory, never permissions.

To persist the generated bytes, the current controller explicitly calls:

```json
{"op":"project","characterId":"alice","generation":1,"requestId":"sheet-v1","expectedRevision":"<world revision>","expectedArtifacts":{"sheet":"missing","canvas":"missing","base":"missing"},"accessToken":"<alice token>"}
```

Replace each `missing` with its exact exported SHA-256 revision when refreshing
an existing file. `project` is MUTATING, remains on `manage_roleplay_trpg`, and
requires chat, current control/generation, current world revision and all three
target revisions. It accepts no caller path or file content. It creates no game
turn, dice, event ledger or real reward. Successful output is
`{projected:true, sourceRevision, files:[{kind,path,revision}], warning}`.

The server validates all three targets before writing any. Normalization,
PathFilter, caller access, enterprise filesystem guards and every relative
ancestor's symlink checks apply. Each file is written through the existing
revision-checked filesystem writer with final actor/source/access checks and
change notifications. The internal grant permits one exact generated sheet
path for the duration of that write only; canonical records and generic
roleplay mutations remain blocked. Generated files have content integrity
markers: unmanaged files, old unsealed exports and manually edited artifacts
are never automatically overwritten, even with a supplied matching revision.
These markers detect edits; they are not authentication or permissions.

Same-source retry is content-idempotent: targets already equal to the desired
bytes are not rewritten, including an interrupted first creation. A stale world
revision is always rejected; refreshing requires a fresh export. `requestId`
is validated but does not create a separate historical projection receipt.
Only game-changing operations use the canonical request replay ledger.

On an ordinary later-member failure, existing preimages are restored with exact
revision checks, provided the actor still has access and the current bytes are
the bytes this operation wrote. Concurrent foreign edits are preserved, never
overwritten by rollback. Newly created files are preserved, never deleted; the
error identifies them and directs the caller to export again. Authorization
revocation, partial file writes or competing edits can leave an incomplete
rollback and are reported explicitly. This is not a crash-atomic multi-file
transaction: a process crash may leave a mixed-age derived bundle. The journal
remains authoritative; restore/regenerate from its source revision, and never
delete or rewrite canonical world/economy data to repair a projection.

Each file is limited to 256 KiB. Canvas has at most 64 nodes and 300 unique-ID
edges, with `mcpvault.omittedEdges` reporting omitted visual edges; the sheet
retains all prerequisite declarations. Positions/colors never grant access.

Required parent edits, deliberately not performed here:

1. Add the `roleplay.trpg` dynamic mapping in `endpoint-registry.ts` and dispatch
   in `createServer.ts` using the exported `ROLEPLAY_TRPG_ENDPOINT` definition.
   Require chat for writes and `respec_preview`. Expose only `read`, `export`,
   `respec_preview` as read operations in read-only mode. Preserve all existing
   roleplay read aliases. `ROLEPLAY_MUTATING_TOOLS` already includes the new tool.
   No sixth stable MCP tool is needed.
2. Add capability discovery/action guidance as needed in the parent control
   plane and agent pulse. Route learning/procedural consumers to the shared DAG
   validators explicitly; a valid graph must never authorize execution.
3. Keep `project` classified as mutating. It is listed in
   `ROLEPLAY_TRPG_ENDPOINT.projectionOperations`, not `readOperations` or
   `operationMap`; the service handles it as a guarded derived-file operation.
   Persistent output is implemented in this ownership slice; no extra parent
   filesystem bypass is required. Leave unmanaged Canvases untouched.
4. Parent runs global integration/type/build checks, generates committed `dist/`
   and owns deployment/release decisions. This worker did not touch global
   wiring, economy, filesystem, host provisioning, package configuration or dist,
   and did not commit, push, deploy or operate the live Vault.

Concrete alias/capability contract (also exported as `ROLEPLAY_TRPG_ENDPOINT`):

| Internal tool name | `op` values | Capability/auth | Read-only mode |
| --- | --- | --- | --- |
| `read_roleplay_trpg` | `read`, `export` | public within existing scope; optional principal still validated | allowed |
| `preview_roleplay_trpg` | `respec_preview` | authenticated `chat`; current controller + generation | allowed |
| `manage_roleplay_trpg` | `adopt`, `growth` | authenticated `chat`; host policy administrator | rejected |
| `manage_roleplay_trpg` | `encounter_start`, `encounter_end` | authenticated `chat`; current designated delegated scene GM | rejected |
| `manage_roleplay_trpg` | `learn`, `loadout`, `switch`, `respec`, `rest`, `turn_end`, `act` | authenticated `chat`; current controller + generation | rejected |
| `manage_roleplay_trpg` | `project` | authenticated `chat`; current controller + generation; world and three target revisions | rejected |

All three names dispatch to service endpoint `trpg` with `op` unchanged. Game
writes become canonical commands `trpg_<op>` (the exported `operationMap` is
exact); `project` persists only derived files, without a canonical turn.
Only `manage_roleplay_trpg` is a discoverable sidecar tool; aliases are internal
dispatcher names. Remap aliases before read-only rejection, add `chat` capability
requirements for manage/preview aliases, preserve the original access token and
authenticated principal, and report per-operation capability availability.
When roleplay is not configured, disable this endpoint; when administrators are
missing, mark writes unavailable, without incorrectly disabling public reads or
authenticated preview solely because the runtime is read-only. No registration,
permission or model-execution grant follows from a ruleset or route result.

Validation command for this ownership slice:

```powershell
npm test -- roleplay capability-graph --maxWorkers=1
```

The single-worker setting reduces this command's CPU concurrency. Other shared
checkout workers can still contend with the existing five-second HTTP test;
report any timeout and isolated rerun separately. It does not increase timeouts.

Worker verification for this change:

- `npm test -- roleplay capability-graph --exclude src/roleplay-mcp.test.ts --exclude src/roleplay-trpg-mcp.test.ts --maxWorkers=1`:
  15 files, 122 tests passed, including 12 projection-persistence tests and
  original-receipt revocation before retry and inside the writer callback.
- `npm test -- src/roleplay-trpg-mcp.test.ts --maxWorkers=1`: parent's dynamic
  TRPG integration test passed at its checked-in timeout (1 test).
- Earlier `npm test -- src/roleplay-mcp.test.ts --maxWorkers=1`: the existing HTTP test
  intermittently exceeded its unchanged 5-second body limit in the shared
  checkout. This is not reported as a passing default timing gate.
- Diagnostic `npm test -- src/roleplay-mcp.test.ts --maxWorkers=1 --testTimeout=20000`:
  1 test passed, all functional assertions completed (reported body 4.88 s).
  No persistent timeout setting was changed; parent must recheck default timing.
- Explicit-file strict TypeScript `--noEmit` checking of ten changed/new
  production modules and six owned test modules passed. Scoped diff whitespace
  checks passed. No full build, full repository suite, dist generation or live
  Vault verification was performed by this worker.

Exact ownership result: `src/capability-graph.ts`,
`src/capability-graph.test.ts`, `src/roleplay-trpg.ts`,
`src/roleplay-trpg.test.ts`, `src/roleplay-trpg-service.test.ts`,
`src/roleplay-trpg-projections.ts`, `src/roleplay-trpg-projections.test.ts`,
`src/roleplay-trpg-project.ts`, `src/roleplay-trpg-project.test.ts`,
`src/roleplay-boundary.ts`,
`src/roleplay-model.ts`, `src/roleplay-store.ts`, `src/roleplay-service.ts`,
`src/roleplay-projections.ts`, `src/roleplay-tools.ts`,
`src/roleplay-tools.test.ts`, and this document.
