---
id: computer-worlds
kind: manual
description: Register distinct computers as real-world companions to fictional worlds.
keywords: [computer, world, environment, hardware, session, 컴퓨터, 세계관, 환경, 등록]
use_when: Registering or recalling specs and constraints of a PC, laptop or NAS.
do_not_use_when: Authorizing execution, storing credentials, or changing fictional game state.
parent: ../../AGENTS.md
previous: ../superpowers/plans/2026-09-16-computer-worlds.md
next: ../../src/computer-world-tools.ts
---
# Computer worlds

`roleplay.world` remains the fictional world. `roleplay.computer` manages its
real-environment companion: many named computers, separate IDs and histories.
No automatic probing, installation, account/certificate binding or execution grants.
Credential guards catch obvious formats only; never submit secrets in any field.

## Register and recall

1. `list`: obtain the current catalog revision and private catalog URI.
2. `register`: supply worldId, title, facts, requestId, expectedRevision.
3. Register each PC/NAS separately; matching names do not merge machines.
4. `bind`: supply sessionId, executionWorldId, targetWorldId, requestId and
   the session revision (`missing` for a new selection).
5. `context`: reuse that sessionId and catalogPath to read selected computers.
6. A new session must explicitly bind its execution and target worlds.
7. `update`: replace one world's current facts with a complete reviewed set;
   supply the current catalog revision. Recheck hardware before destructive work.

Example: `desktop` executes the agent; `nas-home` is its target.
Never use NAS specs as desktop specs. Selection itself establishes no host identity.
Fact: `ram`, `hardware`, `16 GiB`, `reported`, `User report`, ISO observedAt.
Categories: hardware/software/path/constraint. Basis: observed/reported/inferred.
Preserve localized names: `Desktop (데스크톱)`. Unknown values stay unknown.
Passwords, tokens, cookies and private keys are not environment facts.

## Scope, history and limits

Default: current agent's private `Worlds/computers.md`; model scope if no agent.
An explicit authorized model catalog supports agents already sharing that model.
Other models need existing scope authorization; this feature grants no sharing ACL.
Keep catalogPath for later sessions. No public fallback or global active computer.
Each catalog holds up to 64 worlds, 32 facts/world and 12 earlier snapshots.
`read` version 0 is current; 1..12 selects retained history. This is not full audit storage.
Catalog cap: 256 KiB. Last 64 request receipts retained; never reuse request IDs.
Responses page complete facts, prioritize constraints and pin continuation revisions.
Follow nextAction when partial; a 1k packet may require a 12k single-fact read.
Writes require authentication, write capability and existing roleplay owner consent.
WRITE_UNCONFIRMED means possibly committed: reread; no rollback claim. Fiction stays intact.
