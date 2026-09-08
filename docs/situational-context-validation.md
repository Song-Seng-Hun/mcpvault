# Situation context validation — 2026-09-08

## Method and measured results

Implementation began with failing contract/service tests (27 failures, one
existing literal-storage case passing). Review findings also received two
failing regressions before their fixes: diary-kind anchor/relation exclusion,
and a counterpoint displaced by a saturated evidence list.

Eight fixed synthetic cases compare the unchanged question packet with the new
situation packet: four backgrounds (NAS, LOCAL, Korean, mixed language), each
with execute/review intent. Both versions found the expected document and its
warning in all eight cases. The new mode removed the other-environment result
in all eight; it did not improve already-successful warning recall in this set.

| Measurement | Existing question packet | Situation packet |
| --- | --- | --- |
| Expected document and warning | 8/8 | 8/8 |
| Other-environment documents per call | 1 | 0 |
| Serialized response characters | 2,281–2,293 | 1,725–1,734 |
| Explicit source-body reads per call | 2 | 1 |
| Explicit revision reads per call | 2 | 2 |
| Explicit metadata-read calls per call | 2 | 2 |
| API calls | 1 | 1 |
| Observed elapsed milliseconds | 15–63 | 54–79 |

These are synthetic, single-worker Windows observations, not production latency
or token estimates. The new mode adds metadata eligibility and graph checks.
The fixture lacks the production shared graph, and the baseline runs first;
cold/warm order and native I/O are not controlled. Metadata catalog queries and
graph initialization are additional I/O, not covered by the three explicit
method counters. No speedup or universal relevance improvement is claimed.
These numbers include the final Vault-path clarification notice.

## Actual model behavior, separate from protocol assertions

Two isolated **gpt-5.6-luna** Codex CLI sessions ran sequentially. They received
only the NAS-operation / LOCAL-review task, not endpoint instructions. The
temporary MCP listener used port60190, not production8788. Plugins, shell,
subagents, web, and host memory were disabled. The harness used a provisioned
temporary account; this did not evaluate registration usability.

- NAS: 12 tool calls,22,975 returned-result characters. The agent retained the
  reconnect validation requirement, the untested network-partition caveat and
  the instruction not to enable automatic repair before verification.
- LOCAL: 5 tool calls,7,943 returned-result characters. The agent treated
  event-only operation as conditional on measured event delivery and rejected
  extrapolation to NAS. It produced a misleading client-filesystem citation for
  a Vault path; the new packet notice now explicitly distinguishes those paths.
- Neither model selected `wiki.context_pack`; they used projections, search and
  original-note reads. Thus condition-aware reasoning was observed, but natural
  selection of the new endpoint and a one-call model workflow remain unverified.
- No source note changed. No private canary appeared. Both child processes
  exited0; the temporary Vault/accounts were removed with no cleanup errors.

Evidence (local, redacted, not committed):
`.mcpvault/evaluations/learning-410d42af-bd3a-470f-9581-adcc8678023c/report.json`.
These trials preceded the final two review fixes; those fixes are covered by
automated regressions. The two-session cap was respected; no third model trial
was run to turn the incomplete discovery result into a claimed pass.

## Verification scope

Tests cover literal/Unicode activation, invalid and escaped YAML keys, common
writes/Properties validation, privacy before top-k, explicit and incoming
counterpoints, no second-hop keyword activation, revision changes/deletion/
moderation/access revocation, whole-response limits and guarded continuations.
The five-tool dynamic dispatcher covers query mode, legacy path-only mode and
invalid argument rejection. Existing question/corpus/helper regressions remain
part of the full suite. No Obsidian UI or external Gemini/Claude host trial was
performed in this change.

## Final integration and deployment

- `npm run build`: exit0; generated `dist/` matches the final source.
- `npm test -- --maxWorkers=1 --testTimeout=15000`: **279 files passed,
  3,794 tests passed,2 skipped,0 failed**,580.65 seconds. This includes the
  separately coordinated enterprise/notification changes. Final log:
  `.mcpvault/lorebook-full-final-20260908.log` (local, not committed).
- `git diff --check`: exit0. An earlier whole run exposed three compatibility
  failures: the complete Properties vocabulary exceeded4,000 characters by7,
  and the endpoint catalog required a numeric schema budget default. The
  compact description and documented legacy schema default now preserve the
  old contract; tiny-budget retries progress to a larger usable response.
- Compiled-code checks preserved a table condition and ignored a fake Warning
  heading inside a tilde fence while retaining the actual Korean warning.
- The existing shared HTTP server was replaced, without changing its launcher,
  plugin registration, Vault documents, accounts or legacy operating mode.
  An initial scheduler stop/start race left the task Ready with no process;
  after confirming that state, starting the same task succeeded.
- **Current Codex MCP connection** returned `mode:situation`, an exact current
  schema excerpt, successful revision-guarded continuation and the new
  `context_rules` property schema. Exactly one shared server remained running.
  No Codex restart or plugin re-registration was needed.
- Previous committed `dist/` is retained locally as
  `.mcpvault/lorebook-deployment-20260908/rollback-head-dist.zip`.

Source Markdown remains authoritative; neither automatic prompt insertion nor
host context retention is guaranteed. Actual-model endpoint discovery remains
the explicit limitation recorded above, not an automated-test pass.
