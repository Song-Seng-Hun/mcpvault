# Final-format flow budgets and honest truncation

> Execute inline with TDD and executing-plans. No agents, live Vault writes or restart.

**Goal:** `wiki.flow_health` honors maxChars for final compact/pretty JSON and
does not label shortened dependency collections as complete.

**Design:** Pass prettyPrint from the common dispatcher into the service's
optional final options argument. Use one final-format fit predicate for all
response branches. Compact collections must update their own truncated flags;
deepest-chain previews expose their total and truncation explicitly. Keep exact
paths/revisions, never clip identities. If minimal detail still cannot fit,
return a bounded summary and a same-request retry that preserves original
identity/parameters and overrides only budget, limit and indentation. A ceiling
request already using limit one and no indentation gets no retry loop.

**Alternatives:** Raising the minimum budget would break existing clients;
string slicing can produce invalid JSON or broken identities. Final-format
projection fits the existing five-tool/control-plane contract without either.

**Files:** src/llm-wiki.ts, src/createServer.ts, src/llm-wiki-tools.ts,
src/flow-budget.test.ts, README.md, _wiki/SCHEMA.md and roadmap; committed dist.

- [x] Reproduce pretty-format overruns, false nested completeness, absent retry.
  Run `npm test -- src/flow-budget.test.ts` and inspect assertion failures.
- [x] Pass options through dispatcher; measure every returned representation in
  the selected format. Guard the final fallback as well as full/compact/minimal.
- [x] Update collection flags and chain preview total/omission; ensure retry
  cannot drop original filters/identity or loop at the response ceiling.
- [x] Add large scalar, ceiling, chain preview and dispatcher coverage. Run
  targeted tests, build, full tests and compiled MCP smoke on an isolated Vault.
- [ ] Update progressive docs and record evidence/remaining gaps. Diff check;
  commit and push only the authorized user fork main, verify remote SHA.

Scope does not include changing graph classification, adding a cached snapshot,
or claiming complete pagination for this dashboard. A truncated dashboard is
still a sample; source reads must compare the returned current revision.

## Verification evidence

- Red: final pretty responses measured 1,255/1,920/7,018 characters for budgets
  1,024/1,600/7,000. At 7,000 compact characters, eight incomplete prerequisites
  became two rows while retaining truncated=false. The minimum response also
  lacked the same-request retry. All five original assertions now pass.
- Added chain total/preview, large scalar/emoji and ceiling no-loop tests, plus
  dispatcher indentation coverage in the existing real-Vault LLM Wiki suite.
  Targeted: 100 passed. Build: exit 0. Full suite: 1,265 passed, one skipped,
  96 files, 60.85 seconds. `git diff --check` passes.
- Compiled MCP, eight fixture work notes plus one hidden other-model note:
  compact response lengths 932/1,506/4,979/9,823 and pretty response lengths
  831/1,473/2,138/15,379 at budgets 1,024/1,600/7,000/16,000 respectively.
  Measured actual returned text, not an independently reserialized estimate.
- Five fixed tools, registration and dynamic `wiki.flow_health` verified.
  Applied the returned retry overrides to the original request; WIP=5,
  blockedAfterDays=9 and waitingAfterDays=17 survived. Hidden note excluded.
  Client/server closed; only the verified temporary Vault/account removed.
- Review checked each return's final-format fit, nested collection total versus
  emitted count, exact path/revision preservation and ceiling retry behavior.
  Summary responses reuse the existing optional/omitted-section result contract
  used by the Reflect consumer. Whole graph/candidate memory and other dashboard
  budgets remain open, independent audits.
- Fork commit/push is verified after this local evidence; no live deployment or
  upstream contribution is inferred from passing tests.
