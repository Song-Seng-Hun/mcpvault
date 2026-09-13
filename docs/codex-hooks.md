# Bounded Codex host bridge

This is an opt-in host API, not an installed hook, scheduler or model worker.
`createServer(..., { codexHooks })` accepts a verified private `host`, a fresh
`attest` callback and an explicitly supplied `bind` transport. Without all three,
or in read-only mode, no listener is bound. The five MCP tools are unchanged.
No CLI flag, feature selection or maintenance grant enables it.

## Verification boundary

Local inspection on2026-09-13 found CLI0.154.0-alpha.6.2. A bounded standalone
app-server initialize/hooks-list probe returned no configured hooks, errors or
warnings. It started no thread, turn, model or hook and changed no trust. This
proves metadata support only, **not lifecycle-event firing**. The live service
has no hook transport/attester/grant and remains unconnected.

Codex definitions require separate hash-pinned trust. MCP may not be connected
at SessionStart; SessionEnd does not support MCP hooks. Hosted WebSearch cannot
be recovered through tool hooks. See [official Codex hook documentation](https://learn.chatgpt.com/docs/hooks).
Never bypass trust, install a blanket hook, scan transcripts or create a model
turn to make acceptance appear successful.

## Authority and host obligations

Use `loadCodexHookHostConfig` for receipts and `loadCodexHookCheckpointStore`
for already-prepared checkpoints. Both loaders require verified private host
storage outside the Vault/repository, reject symbolic/shared hard links and use
distinct Vault-bound names and leases. All four maintenance/compilation/hook/
checkpoint namespaces reject overlapping configuration paths. Existing or damaged
history is not reset, deleted or migrated automatically.

The version1 config has `enabled`, `accountId` and explicit `projects`. Each
project names `id`, exact canonical absolute `workspace`, trusted
`definitionHash`, allowed `events`, allowed `actions` and exact Markdown `paths`.
No wildcard, directory-wide enrollment, unresolved classification or implicit
public scope is accepted. The host must resolve and verify workspace filesystem
identity; matching a payload's `cwd` is not verification.

`attest` must obtain current host state independently of event strings:

- event occurrence and session, actual mode, trusted definition/event support;
- current account, authority revision, verified workspace/project and all current
  dependency paths (including output, continuity and participation dependencies);
- input revision, stable cause ID, expiry, active-work and host quota state;
- actual runtime locality before confidential reads, plus one selected work item.

The input decoder retains only allowlisted event, opaque session ID and Stop
reentry marker; it discards prompts, tool bodies, cwd, claimed permission mode and
transcript paths. Oversized/unsupported inputs become diagnosis only. Plan mode,
missing verification, revoked/expired grants and unavailable accounts cannot
execute. Even an administrator must pass source ACL and runtime checks.

Adapters run existing services inside an additional exact-path document boundary.
Current actor, authority, cancellation and policy are checked after reads and at
the physical write guard. Community also needs the existing owner-activity grant
and participation opt-in. Hook permission is not community consent. Search uses
the evidence mode with semantic/provider calls disabled.

## One existing opportunity, one action

| Event | Permitted work |
| --- | --- |
| SessionStart | current continuity or one community opportunity |
| PostCompact | current continuity |
| UserPromptSubmit | bounded host-selected query |
| PostToolUse | verified immutable source candidate/change coalescing |
| PreCompact | prepared host-local checkpoint verification |
| Stop | one compilation session/retry, checkpoint or community opportunity |
| Interrupt / SessionEnd | prepared checkpoint only |

The host supplies work parameters, never arbitrary endpoint names. A source
candidate must already exist with its exact revision, immutable flag and valid
content checksum. A search URL does not count as acquired content. The existing
compilation invalidation path handles affected jobs; no new source fetch is
implied. Inputs outside the explicit automation policy remain for manual review.

By default compilation executes one pinned `retry`, without generation. A host
may explicitly provide `codexHooks.session` backed by its existing authorized
session. That host-only callback uses the compilation coordinator to reserve,
generate, submit and check one prepared job; default application is check-only.
Only a host with actual quality/operation grants may select `apply_verified`.
This option neither binds a native hook nor supplies runtime attestation or trust.
There is no transcript harvesting or background model. Duplicate deliveries use
read-only reconciliation and never regenerate. Existing source, runtime, revision,
publication, three-failure and single-refinement gates remain in force. An
incomplete job remains review-required; a checked draft is not publication.
Community returns only the current participation pulse, never starts a run or
posts. The current agent uses existing participation records/publicRequestId for
at most one public action. Existing30-minute coalescing, owner6-start/1-new-topic
limits and5-minute run window remain authoritative. No new heartbeat is created;
the already-approved heartbeat may supply the same registered cause.

Receipts are persisted before dispatch. Their identity is stable across delivery
channels; event/session is freshly checked but cannot turn one unchanged cause
into another action. A changed action/authority/input for an old cause is review-
required. The host must not invent new cause IDs to bypass this guard. Knowledge
processing and community are never chained for one cause. Reentrant/origin-tagged
events are quiet. Completed repeats only revalidate the existing result and do
not rewrite receipts or reissue the action. Uncertain writes use read-only
reconciliation; absent or changed results never authorize replay.

One worker holds its lease until the adapter settles, including after cancellation.
Busy deliveries return deferred; pending work remains in the original host
registry for the next existing opportunity. There is no autonomous retry loop.
Normal opportunity limit is5minutes, PreCompact2seconds, shutdown750milliseconds.
Cancellation returns promptly and guards prohibit late writes. A hung operation
is not permission to start a replacement writer or steal a lease.

## Prepared state and output

`CodexHookCheckpointStore.prepare` accepts only explicit agent-authored topic,
summary, next action and pinned references—not a transcript or hidden reasoning.
It stores inherited account/project/dependency/authority restrictions before the
body. Failure leaves a restriction-only pending record. Reusing the same ID is
idempotent; changed content requires a new reviewed ID, never overwrite. Shutdown
`flush` only verifies already-durable host-private bytes, with no NAS save or new
generation. If verification times out the earlier prepared bytes remain.

An authorized host can use `read` with the exact checkpoint revision after fresh
attestation to restore that payload; it does not automatically write it into the
Vault or broaden its scope. Normal SessionStart uses the existing continuity
service. Prepared checkpoint restoration and current continuity must not be
confused with proof that unverified source dependencies are current.

Returned context is explicitly `data_not_instructions`, bounded to4000characters,
and never copied into receipt logs. Oversized context is explicitly partial.
The host must preserve this data boundary when presenting it; do not promote
source text to trusted instructions. Quiet/deferred/non-actionable responses must
not trigger another model or notification. Errors expose no raw paths, bodies,
transcripts, hidden counts or provider messages.

## Acceptance

Service/unit tests and actual-server connection tests are separate from installed
Codex event tests. Unit checks cover denial, revocation, private-storage isolation,
prepared-state failures, duplicate causes, uncertain acknowledgement, cancellation,
shutdown deadlines and original-byte preservation. Actual native event/trust/mode
verification and model-quality evaluation remain outstanding. Automatic synthesis
and live hook binding stay off until those gates and explicit host grants exist.
