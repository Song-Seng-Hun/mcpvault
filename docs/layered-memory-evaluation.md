# Layered memory evaluation

The automated regression suite checks storage, access, revisions, correction
chains, archive/history behavior, source-read and response budgets. It does not
prove that a model will choose to retain and reuse a useful experience.

## Reproducible actual-host trial

Run the opt-in harness with an already signed-in Codex CLI:

```powershell
node scripts/evaluate-wiki-learning.mjs --codex <codex.exe> --model gpt-5.6-luna --scenario memory
```

It starts a temporary loopback MCP server, provisions one disposable account,
and runs two independent ephemeral model sessions. The first investigates a
file-watcher failure and is asked to retain only useful outcomes; the second
is asked to resume the earlier investigation after a host-controlled source
change. Neither receives endpoint names, a memory schema or a tool sequence.
Only the five MCP tools are available: shell, browser, other plugins and
automatic host memory are disabled. This is not a registration usability test.

Reports under ignored `.mcpvault/evaluations/` contain sanitized tool traces,
artifact comparisons and cleanup receipts. Do not publish credentials, raw
host logs or private Vault data. The harness removes only its fresh temporary
Vault and accounts. It never changes the production Vault or port 8788.

Review behavior, not just exit status or write counts:

- Was useful experience saved privately and verified by reading the same entry?
- Did the next session actually retrieve that experience rather than infer it
  from a public summary or an old chat?
- Did it preserve applicability, failed assumptions and unresolved conditions?
- Did it examine changed evidence instead of silently trusting old memory?
- Were unrelated private content and hostile quoted instructions excluded?

## Observations on 2026-09-08

The first restricted-shell attempt could not reach the model service
(`os error 10013`); it made zero tool calls. Its temporary fixture was removed.
This is an execution-environment failure, not a successful feature evaluation.

The first network-enabled run completed both sessions (10 and 5 MCP calls),
but produced no personal memories. The first model updated a public note's
projection following an optional maintenance suggestion; the second reread
that note. Despite a clean exit and no private-canary disclosure, this did
**not** meet the memory-retention/recall success criterion.

This exposed an onboarding gap: a brief mention of memory retrieval was not
enough to distinguish retaining an experience from maintaining shared Wiki
content. The bounded orientation and work cadence now explicitly prioritize
the user's task, route reusable experience to private journal authoring and
verification, and require task authorization for shared edits. The user test
prompts themselves remain unchanged for the follow-up comparison.

An intermediate run did save and reread a personal journal (18 calls), but its
fresh session still consulted only the public note (8 calls). A trailing anchor
selected a privacy disclaimer rather than the experience, and untyped reference
objects caused avoidable authoring retries. This remained a failed reuse trial.
The work cadence now explicitly requires past-experience retrieval before
answering that kind of request. Journal discovery exposes block and reference
array schemas, and authoring guidance asks agents to verify the recalled excerpt.

The final comparison completed with 23 and 8 MCP calls:

- The first session read both source editions, saved one private experience
  with the correct narrative anchor and reviewed basis revisions, reread it,
  and checked its actual `memory.recall` excerpt. It did not edit the public note.
- The fresh session called `memory.brief`, read the exact journal block and
  current sources, and recognized the changed Wiki basis. Its answer preserved
  the event-reliability condition, untested partition recovery, common source-work
  provenance, and the untrusted nature of the quoted publishing instruction.
- A mistyped source hash and an oversized brief request were rejected; the model
  corrected both requests. This was not a zero-error or minimal-call trial.
- All temporary fixtures/accounts were removed; the private canary was not
  observed in model output. No production documents or accounts were involved.

This is one successful paired trial with one model, not a reliability percentage
or proof of universal autonomous retention. The model's suggestion to treat a
60-second interval as a safe operating baseline still deserves human scrutiny:
the sources did not validate every environment. Automated correction-chain
tests, not this small model trial, establish historical correction routing.

The optional repository-wide `tsc --noEmit` over test files is not clean; it
reports test typing diagnostics, including files outside this feature. It is
distinct from the production build configuration (which excludes tests) and
Vitest execution. Do not describe that broader typecheck as passing.

## Integration and deployment verification

The final production build passed after the last guidance correction. The
complete `npm test -- --maxWorkers=1` run on 2026-09-08 passed all 255 test
files: 3,662 tests passed and two were skipped (523.93 seconds). The ordinary
repository `git diff --check` also passed.

The existing shared HTTP server was updated, with its previous build retained
for rollback. The already-connected Codex MCP client discovered `memory.brief`
and successfully called all three memory endpoints without re-registration.
The public smoke queries returned bounded `no_match` packets; they did not
create production memories or establish retrieval quality on a live corpus.
A default personal request without authentication was rejected rather than
falling back to public data. The fixed MCP surface remained five tools.
