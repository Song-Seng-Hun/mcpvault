---
id: evolution-host-contract
kind: architecture-contract
description: Connect trusted host evidence without turning client labels into grants.
keywords: [evolution, authority, host, adapter, permission, 권한]
use_when: A host integrates evolution; not a client authorization recipe.
parent: index.md
previous: index.md
next: endpoints.md
---
# Host boundary

`CreateServerOptions.evolution` takes trusted callbacks; MCP never loads code.
Storage uses `loadEvolutionStorage` and existing private local HostWork records.
Its config contains version=1, enabled, and canonical vaultPath; no credentials.
Config alone grants nothing. `authority` must recheck actor, runtime and scope.
`attest` binds opaque event tokens to the exact feedback and real interaction.
`verifyEvidence` checks all referenced revisions and current read access.
`profile` pins case/target/holdout IDs before checking a candidate.
`evaluate` supplies measured results, provenance and optional receipt hash.
`proveUse` attests next-task/next-session delivery, use, revision and outcome.
Never attest a client claim merely because its token or account ID is present.

| Owner | Adapter boundary |
| --- | --- |
| Persona | Typed private expression overlay; exact-result withdrawal |
| Wiki | Existing checked compilation job; source policy and publication guards |
| Skill | Native promotion plus reviewed-delivery adapter; both must agree |
| Fiction | Existing controlled character belief/attitude proposal only |
| Computer | One existing hardware/software fact; same world and current revision |

Skill delivery prepare/apply must use existing reviewed admission; no automatic approval.
Wiki/skill/world automatic undo is unavailable; reviewed native recovery remains required.
Private indexes are account-scoped; explicit shared-owner entries require host attestation.
IDs must be unique within the verified owner namespace (use opaque UUIDs).
Colliding IDs fail closed; they never overwrite another account's records.
Indexes cap at 1,024 private plus 1,024 shared IDs. Capacity requires host review.
`ServerRuntime.runEvolutionOpportunity` accepts an existing approved session bridge.
One cycle, five minutes, two candidates, one refinement; no new-evidence means no generation.
Cancellation fences later writes. Non-cooperative work retains its slot until settled.
Actual event-hook wiring is host-specific and is not automatically installed.
