# Shared-world roleplay evaluation — 2026-09-08

## Scope and method

Two GPT-5.6 Luna medium sessions ran **sequentially**, with no implementation workers active. Both used an isolated Lantern Archive world and synthetic accounts. Their only task-specific instructions were the task goal, the five stable tool names and a transport invocation shape; no action recipe or rule IDs were supplied. A small local adapter forwarded calls through an actual Streamable HTTP MCP server and supplied the fixture token. This was a real model behavior evaluation over MCP, **not native Codex plugin schema injection**, a Gemini/Claude host test, or a production world test. Missing fixed-tool schemas in the adapter are a possible source of discovery overhead.

The compiled server used for both sessions predates the final registered-action context hints. The fixture, credentials and world records were removed afterward; production accounts, rooms and economy were not modified.

## Observed behavior, not inferred success

1. Session one acquired one key in `hall`, moved to `garden`, and reread the character context. Independent server inspection confirmed the location and inventory. It used 16 tool calls, including two failed discovery/schema attempts and a guessed nonexistent `roleplay.observe`. It reread after the combined work rather than after each mutation.
2. Between sessions, a separate fixture participant switched off the shared power. Session two recovered the persisted key/location and noticed the changed power state. It did **not** discover the registered `restore-power` rule. Instead it submitted an unregistered attempt and tried GM resolution/delegation operations, which the server rejected. A further goal-only continuation in the same session led to a request for the peer to restore power, not a successful unlock. Final independent inspection still showed power off, key held, and no opened-vault flag.

Therefore state persistence, observation of a peer change and unauthorized-adjudication rejection were observed. **The end-to-end model goal of using the recovered item to open the vault did not pass.** No third session was spawned to conceal that failure. Character acting quality and automatic model wakeups were not measured.

## Changes prompted by the evaluation

- Context now returns bounded `registered_action` hints with rule IDs, condition-match status and the exact `use` argument shape, before recommending GM-only creative attempts. The status is advisory; execution revalidates all state/control constraints.
- Lore retrieval without an explicit query uses the current location and only explicitly linked, accessible fiction notes.
- Reviewed core memory can be updated without resending a definition. Selected active beliefs can be retired only with a reviewed core summary and reason; source events remain intact.
- Long character definitions and belief lists no longer precede the compact current state/core memory and registered-action hints.
- Final chat integration tests also cover the shared qualified-mention grammar, replies to pre-game room messages and refusing ordinary writes into a world room when the world service is offline.

The MCP protocol regression now reads the hint, restores power, rereads, uses the conserved key to open the vault, and rejects a second use. It also proves that reading action hints does not mutate the state. This **automated regression passed**; the separately authorized model follow-up below now supplies behavioral evidence for this particular scenario.

## Authorized follow-up with improved hints

One fresh GPT-5.6 Luna medium session (`01a08144-b606-7042-b75d-53ff25cba4c2`) used the current compiled implementation. The isolated fixture reconstructed the prior stopping point through canonical take/move operations, then a peer switched power off. This was a newly constructed fixture, not recovery of the previously deleted evaluation world, and this run did not test a server restart. A transport-only interrupted setup before the completed run supplied no usable behavioral result.

The model received only the goal (continue as Iris and open the garden vault), the same five tool names, and an authenticated test-adapter invocation. No rule IDs, power-restoration recipe or follow-up hint were supplied. It made 13 MCP calls, all successful: orientation, pulse, active capabilities, four capability searches, world read, three context reads, and two registered actions. After the initial context it used `restore-power`, reread context, used `unlock`, and reread again. It did not request GM powers or submit an unregistered attempt.

Independent fixture inspection confirmed `iris.location = garden`, `iris.flags.vault-open = true`, `moss.flags.power-on = true`, and key quantities `character:iris = 0`, `place:garden = 1` (one conserved key). Thus the previously failed goal **passed in this single follow-up**, including adaptation to peer-modified state and post-mutation verification. The worker was closed; the generated fixture accounts/world were removed and its server exited. Production state was not changed.

Limitations remain: this is the same local adapter over actual MCP, not native plugin schema delivery or another vendor host; one successful run establishes neither a success rate nor acting quality. Four discovery searches also leave room to reduce navigation overhead. No production source changed during this follow-up and the full suite was not rerun; the earlier build/regression evidence remains separately dated.

## Verification coverage

Tests cover two independent HTTP clients racing for one item, revision/control generation conflicts, declarative-rule bounds, private reference rejection, fiction exclusion before retrieval ranking, canonical chat body projection, prepared-write recovery, writer/recovery fencing, tamper detection, downstream correction dependencies and existing funded-quest evidence validation. Production economy and roleplay activation remain opt-in and OFF during deployment.

The offline-room guard exposed an existing metadata-index bug: a supplied but nonexistent folder prefix was treated as no prefix and could return unrelated candidates. The shared index now treats it as an empty set. A regression covers unfiltered/filtered queries and counts before creation, after creation and after deletion of the final file. The chat guard also explicitly restricts canonical paths and committed-record metadata.

Full-suite/build/deployment evidence is recorded in `roleplay-implementation-checklist.md`; fixture protocol tests and model behavior results must remain separately reported.

During final regression the existing six-cycle workshop integration test exceeded its 20-second timer both in the suite and alone. The same unchanged scenario/assertions, run against the saved pre-change compiled build, passed in 20,677 ms; the current compiled build passed in 19,364 ms. These single observations do not establish a speedup, but show that the old timer is below the baseline's observed I/O duration. Only that file-backed scenario's timeout was increased to 60 seconds; its six cycles and all assertions remain unchanged. Other timeouts and `--maxWorkers=1` were retained.
