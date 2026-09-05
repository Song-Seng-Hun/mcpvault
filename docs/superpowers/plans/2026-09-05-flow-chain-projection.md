# Budget-aware flow chain projection

> Execute inline with executing-plans and TDD. No agents or live Vault changes.

**Goal:** Preserve exact dependency classification and current flow response
semantics without constructing every detailed row of a chain that cannot fit.

**Architecture:** Trace all chain keys as today, selecting the lexical minimum
eligible predecessor without sorting its whole adjacency list. Project rows in
order while counting their exact compact JSON array length. Once that array
alone exceeds the response budget (and at least the compact four-row prefix is
available), stop projection and force the existing compact/minimal response path.
Never return the partial chain as the full response. No data cutoff in graph
classification, new endpoint, cache, persisted view or client setup.
Also defer blocked-lane dependency detail conversion until its row is admitted
to the existing lane limit. Every blocked item still contributes to totals.

**Alternatives:** A fixed chain cap would change responses that currently fit.
A separate paged chain endpoint could improve navigation but requires its own
revision-guarded contract. This batch instead preserves response behavior and
only removes detail construction proven unusable for the full response.

**Tech stack:** TypeScript, existing LlmWikiService, Vitest, committed dist.

- [x] Add a 3,000-node flow service regression using the real work graph and
  only an injected inventory boundary; count public-path conversions. Expect
  no more than inventory size plus 150 detail conversions at a 16,000-char budget.
  Run `npm test -- src/flow-chain-projection.test.ts` and observe the excessive
  conversion assertion fail, not an unrelated runtime or fixture error.
- [x] In `src/llm-wiki.ts`, replace predecessor filter/sort with a lexical-min
  scan. Accumulate chain row JSON lengths (`2 + rows + commas`) during projection;
  stop only after overflow with at least four rows available. Guard the full
  response return with complete-chain status. Keep the existing compact prefix.
- [x] Verify a short chain is complete, an oversized early row cannot masquerade
  as a complete chain, deterministic diamond ordering remains unchanged, and
  deep-chain statistics stay exact. Compare compiled baseline/current outputs
  after removing generatedAt on an isolated fixture across supported budgets.
- [x] Run targeted/full tests, build, compiled five-tool MCP smoke, diff check;
  document exact evidence and limits in this plan and the organization roadmap.
- [ ] Commit generated dist with source and push only the authorized fork main;
  verify remote SHA separately. No upstream PR or live-server restart.

**Remaining costs:** The complete metadata graph and chain-key array remain.
Other flow collections, oversized scalar values and final pretty-JSON budgets
require their own audits; this change does not claim a process-memory bound.

## Verification evidence

- Red: the 3,000-node service regression performed 9,028 public-path
  conversions, exceeding the expected 3,150 bound. Green compiled measurement:
  3,134 conversions with all 3,000 stageable nodes and depth 2,999 preserved.
- Targeted flow/dependency/LLM Wiki suite: 97 passed. Full suite: 1,257 passed,
  one skipped, 95 files, 62.55 seconds. Build and `git diff --check` pass.
- Compiled baseline/current response hashes match on 24 combinations: empty,
  two/20/3,000-node chains, oversized first title, and reversed-input diamond;
  budgets 1,024/2,000/7,000/16,000. Only generatedAt removed before hashing.
- Production MCP on a temporary Vault: five fixed tools, disposable registration,
  dynamic `wiki.flow_health`, 30 stageable tasks/depth 29, 29 blocked/one ready,
  truncated response 6,164 characters within 16,000. Hidden model task excluded.
  Client/server closed and only the verified fixture/account removed.
- Inline review confirmed predecessor tie ordering matches default string sort,
  overflow detection includes array delimiters/commas, and a partial chain cannot
  return through the full-response branch. Compact four-row prefix and all lane
  totals retain their original meaning. No upstream or live Vault changes.
- Fork commit/push is a separate final delivery check, not implied by these tests.
