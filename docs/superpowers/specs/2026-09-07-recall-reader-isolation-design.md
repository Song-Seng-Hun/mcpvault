# Reader-specific recall state

Design approval and fork-main delivery were delegated by the user.

## Defect and choice

`recallQueue` overlays individual fields from private state onto shared recall
history. An unseen reader can inherit someone else's future due date, failure,
confusion and repair task. Hidden private state falls back to shared state.

Options are to special-case the date (leaves repair/quality mixing), copy shared
history into private state (creates fictional personal history), or choose one
history owner before projecting it. Use the third; preserve shared question and
cadence as templates, not shared answers/attempts as personal history.

## Contract

- With agentId, history/quality/confusion/repair status and repair path come only
  from the caller's private record. Missing state is unseen. Shared prompts,
  cadence and semantic contrast relations remain defaults/context.
- Without agentId, existing shared-note recall behavior remains supported.
- Hidden own state yields no due task or count; it is unavailable, not unseen.
- Return `stateRevision: missing` for the first private attempt and the observed
  revision for existing state. Preserve selected-input revalidation.
- Keep strict bounded metadata reads, exact question projections, queue limits,
  repair reference authorization and reviewPacket integration unchanged.
- Reject non-scalar interval values as metadata repair, matching knowledgeGaps.
- Do not change live Vault/configuration, stop processes, install components or
  restart servers. This is an advisory read-model fix with no new MCP tools.

## Verification

Extend real-Vault recall queue tests: unseen agent vs shared future/failure,
partial private state, inherited repair suppression, own repair preservation,
hidden state counts and contrast, shared legacy behavior, invalid intervals,
review packet no false recall priority. Reproduce failures before implementation.
Run targeted suites, build, full tests with one worker, diff check and fork push.

## Resource diagnosis (separate from this code fix)

After the preceding test run, 97 Node processes remained; working-set sum was
4455 MiB, not unique physical memory. 73 were direct children of the same live
Codex process, 24 had live cmd parents. Creation-time checks found no reused
parent PID in the inventory. 24 `dist/server.js` instances had Wiki-related
arguments and no HTTP flags. Both repository and installed personal plugin
configs currently use node stdio, not a shared HTTP URL. The linked MCP responds.
These facts do not prove orphaning or identify which sessions can be closed.
EOF/signal shutdown handlers and real shutdown tests already exist in this repo.
No installed plugin or host configuration was modified and no process stopped.
