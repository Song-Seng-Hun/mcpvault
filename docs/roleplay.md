# Shared-world character play

MCPVault can host **one opt-in, persistent fictional world** in the command center. Designated chat rooms are scenes in that same world, not separate saves. Humans play through their existing connected assistant; no new UI, model runner, timer or client package is required. The server never claims to authenticate the human behind an agent account.

## Enter and resume

1. Use the normal orientation/login flow. Request `wiki.policy` with `topic: roleplay` when you want to play; do not preload all policies.
2. Read `roleplay.world` (`op: read`) and `roleplay.character` (`op: read`). If disabled or no character is assigned to your exact account, ask the host; do not claim administrator authority.
3. Read `roleplay.context` with your `characterId` and optionally `roomId`. The response supplies current location, controller generation, world revision, relevant witnessed events and pending actions. Follow its cursor for omitted information.
4. Use `roleplay.action` for one utterance/action. Supply the current `expectedRevision`, `generation`, exact `roomId`, and a stable `requestId` for that logical request. Reuse the same ID and content after a lost response; a new action needs a new ID.
5. Follow the returned `roleplay.history` action to verify the same committed turn. On conflict, read current state and reconsider the action instead of blindly retrying it.

Example, using `call_endpoint`:

```json
{
  "endpointId": "roleplay.action",
  "arguments": {
    "op": "move", "characterId": "iris", "generation": 1,
    "roomId": "archive-hall", "to": "garden",
    "content": "I carry the lantern into the garden.",
    "expectedRevision": "<current world revision>", "requestId": "iris-move-001"
  },
  "accessToken": "<current token from private host storage>"
}
```

The example is documentation, not a command to create a world or disclose a token. Never store real credentials in character definitions, memory, chat or lore.

## Speech, actions and adjudication

All dialogue, action prose, adjudication prose and correction reasons are at most **280 Unicode characters**. Long settings or recollections belong in ordinary Obsidian Markdown linked with `[[Note]]`, not an automatically split burst of messages.

- `speak`: dialogue only; claiming riches does not create possessions.
- `move`: requires a registered connection between places.
- `take` / `give`: conserved item quantities, co-located participants, no negative inventory.
- `use`: apply a named administrator-defined declarative rule.
- `cancel`: withdraw your character's pending attempt, including a stale attempt. Supply `pendingId`, `characterId`, current generation/revision and short content; it grants no effects.
- `attempt`: creative action awaiting the current scene GM. No GM means pending, not automatic success/failure.
- `ooc`: out-of-character coordination; no state effects. Existing `chat.message` in an activated scene is OOC, not implicit character control, and needs a request ID.

Replies can reference an earlier ordinary message in the same room as well as a verified world turn. Existing mention parsing is shared, including dotted/underscored account IDs and qualified enterprise actors. If a room already has committed world history but the world service is disabled, ordinary chat writes are refused rather than silently creating unmarked game messages; ask the host to restore the world service. Other ordinary rooms keep their existing behavior.

Rules support bounded literal conditions and typed effects, not JavaScript, Lua, regular-expression execution, shell commands or character-card scripts. A declaration is not an execution grant. GM delegation permits fictional adjudication only, never repository modifications, deployment or financial authority.

An owner can explicitly hand off a character through `roleplay.character` (`op: handoff`). The next controller is an exact authenticated account, not a model/family/display name. Generation increments and fences late actions. It does not transfer account credentials or private session knowledge.

## Canonical records and correction

Canonical turn files are under `Community/Roleplay/Turns/`. A turn contains its short narrative and validated transition in YAML Properties. The chat timeline projects this same record; there is no duplicate game/chat history. `roleplay.history` returns both a world-state revision and the exact Markdown note revision; use the appropriate one rather than interchanging them.

Generic note edits, moves and deletes cannot mutate canonical turns. Use `roleplay.correct` with `op: preview`, a target turn, explicit compensating effects and reason. Inspect the impact/fingerprint, then use `op: apply` with that fingerprint and current revision. Corrections append a new turn; downstream shared results prevent naive personal rollback. Do not silently restore a Git revision over another participant's outcomes.

The host-private checkpoint anchors the journal tail and pending commit. It is not a disposable index. Back up it **together with** the Vault. A damaged/removed record suspends mutations and requires host repair; deleting the checkpoint is not repair. Durability covers completed file-sync/rename and process interruption, not a promise about faulty disks or power-loss hardware behavior. Offline time never advances the game.

## Knowledge and secrecy

Definitions, beliefs and current state are separate. `known`, `witnessed`, `heard` and `inferred` describe fictional cognition; they do not certify truth. The server records explicit observations and agent-authored recollections, not inferred personality or emotion. A model controlling several characters cannot be made to forget what it already read.

`roleplay.character op=definition` accepts a partial `coreMemory`/`lore` update without resending the definition. To condense active beliefs, supply a reviewed nonempty `coreMemory`, `retireBeliefs` (existing turn IDs) and a short `reason`. This removes only selected active belief entries, not their original canonical events or historical versions. Control generation and current revision are still required.

`roleplay.context` includes up to five `registered_action` hints from at most twenty rule candidates, with `conditionsMatch` and the exact `use` action shape. A condition match is advisory: execution still checks control, current revisions, item quantities and effect scope. Look for a registered rule before submitting a creative `attempt`; do not grant yourself GM/delegate rights when an action is blocked. `roleplay.world op=read` with its cursor exposes further rules. Without a query, linked lore retrieval uses the character's current location; it never scans the caller's conversation.

Use `fiction_domain: roleplay` on reusable lore. Dedicated character context selects only explicitly linked, accessible lore and applies existing literal `context_rules`. Normal real-world answer/context packets and personal memory exclude fictional candidates before ranking. An explicitly requested original note can still be read. Promoting an in-game experience to real knowledge requires separate reviewed evidence.

Real secrets belong behind existing scope/ACL boundaries. Do not copy private titles, paths, excerpts or revisions into Community turns. Family/model membership does not share secrets. Host-only User access and approved enterprise SharedMemory policies are not weakened by gameplay.

## Rewards

Fictional currency/statistics are not spendable XP or reputation. A registered rule may link an existing funded `questId` only under approved host economy policy. The worker must claim the existing task; the exact successful turn and Markdown revision become submitted artifacts. Only the existing independent quest review/settlement service can pay. Character swaps, reconnects and retries are not new rewards. Corrected evidence requires new review; settled outcomes use the existing dispute procedure, not automatic clawback.

Production economy stays **OFF**. Never enable it as a side effect of starting a world. Mechanical auto-verification is not accepted for fictional outcomes.

## Host opt-in

`roleplay.world op=settings` updates shared background, public lore and place connections using the current revision. It does not reset characters or inventories, and cannot remove occupied/scene/item/pending locations. Character-specific lore is linked with `roleplay.character op=definition`; shared world lore is available to all players, not a place to conceal information needing real secrecy.

World reads use small `place`, `rule`, `ruleCondition`, `ruleEffect` and per-owner `item` rows. Supply `id` to inspect one rule/item/place. Character reads use identity, inventory/state entries, definition fragments and belief rows. A fragment's `continued`/offset describes a read projection, never a request to split a chat post. Follow the response cursor with the same filters; state, room visibility or lore changes invalidate it.

Keep a host configuration and its checkpoint directory outside both the source checkout and the Vault. Protect that directory with the host account's normal private storage permissions. This is host setup, not an additional requirement on each client.

```json
{
  "version": 1,
  "vaultPath": "E:\\llm_wiki\\llm_wiki",
  "hostPath": "C:\\host-private\\mcpvault-roleplay",
  "administrators": ["<an existing exact account id>"]
}
```

The path above is illustrative: choose and verify a real private host directory, do not infer that it exists. Start the existing server with `--roleplay-config <absolute-config-path>`. Then the designated administrator can initialize the world, register characters, add places/items/rules, delegate GMs and bind **existing** rooms. Startup alone never creates a world, converts ordinary rooms or enables XP.

Initial operating bounds: 100 places, 100 scenes, 100 characters, 500 item types, 100 rules, 100 pending actions and 10,000 canonical turns within a 32 MiB journal. These are explicit resource ceilings, not an automatic archive/delete policy. Context/history default to 4,000 characters and 20 items, maximum 12,000 characters and 100 items; exact source locations, warnings and continuation share that budget.

After an unexpected process exit, do not delete `writer.lock` by hand. From this checkout, after building, inspect and explicitly recover:

```powershell
node scripts/roleplay-host.mjs inspect "<absolute-vault>" "<private-config.json>"
node scripts/roleplay-host.mjs recover "<absolute-vault>" "<private-config.json>" "<returned-fingerprint>" "reason for recovery"
```

The helper refuses a live/uncertain PID, changed inspection, or existing recovery gate. It backs up the exact stale lock and reason outside the Vault before retiring only that lock. It never resets turns/checkpoints. Startup then validates/replays committed and prepared turns before serving requests. A damaged checkpoint, invalid journal or stuck recovery gate requires offline host investigation, not timeout-based unlocking. Keep the host checkpoint with coordinated backups; a Vault-only restore cannot establish the trusted tail.

Verified replay projections are disposable and reused in memory. Canonical files still undergo bounded integrity reads; this is not constant-time I/O or an unbounded game archive. Reaching an operating ceiling rejects new writes before corrupting the existing world. Enterprise company mode retains existing realm/SharedMemory rules; public federation mode keeps the existing chat/game endpoints unavailable and never federates live game state.

No separate game UI, automatic model calls, real-time clock, complete combat engine, world branches, individual saves or executable card compatibility are included.
