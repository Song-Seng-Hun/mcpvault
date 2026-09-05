# Bounded flow frontier selection

> Execute inline with TDD and executing-plans. No agents or live Vault changes.

**Goal:** Preserve flow's exact stage totals, recommendation order, deepest tail
and unlock ranking without retaining all stage keys or all detailed candidates.

**Design:** Count stage memberships and the lexical minimum deepest tail in one
pass. Select only the first requested stages with existing boundedTopK, then
scan keys retaining a sorted four-key prefix per selected stage. Stream stage-0
nodes with dependents into boundedTopK as lightweight rank candidates; count all
eligible nodes but hydrate only winners. Preserve localeCompare path ranking
and original iteration order when comparisons tie. Graph classification and
stageByPath stay authoritative and unchanged.

**Alternative:** Merely filter before mapping removes independent-node waste
but still retains all useful candidates. Replacing the whole work graph would
be a materially wider audit. This bounded-selection batch handles the verified
projection waste while keeping the current metadata snapshot contract.

- [x] Reproduce 3,000 independent work nodes being converted again for zero
  unlock candidates. Run `npm test -- src/flow-frontier.test.ts`.
- [x] Refactor src/llm-wiki.ts with stage totals, bounded keys and streamed
  top-K lightweight unlock candidates. Keep exact totals and stable tie order.
- [x] Test ranking against full-sort oracle, shuffled stage membership, wide
  frontiers and short/deep dependency regression suites.
- [x] Compare compiled baseline/current outputs across deterministic fixtures,
  limits and budgets; exercise five-tool MCP on an isolated Vault; build/full
  tests and diff check.
- [ ] Document verified behavior and remaining O(V+E) graph/metadata costs;
  commit generated dist and push only the authorized fork main.

No claim of fixed process memory or measured production latency. Stage totals
still require one entry per distinct stage and the input metadata graph remains.

## Verification evidence

- Red: 3,000 independent ready tasks performed 6,004 path conversions despite
  zero unlock candidates. Green compiled run: 3,004 conversions; exact stage
  totals and lexical four-item stage preview preserved.
- Full-sort oracle: 40 roots with varied single/shared dependents; top-three
  order and scores match, candidate total stays 40 and both stage totals/previews
  remain exact. Targeted flow/dependency/LLM Wiki suite: 107 passed.
- Compiled baseline/current response hashes match all 108 combinations of six
  fixtures (empty, independent, deep chain, wide unlock frontier, diamond,
  cyclic/held work), three limits, three budgets and compact/pretty output.
  Only generatedAt is excluded from comparison.
- Build: exit 0. Full suite: 1,267 passed, one skipped, 97 files, 66.96 seconds.
  `git diff --check` passes. Inline review checked stable comparator ties,
  selected-stage limits, exact deepest-tail ordering and omitted candidates.
- Actual compiled five-tool MCP on a temporary Vault: 39 visible work nodes,
  33 ready/six blocked, stage totals 33/six, unlock order Root-A/Root-B/Root-C
  with scores three/two/one. Other-model private node excluded. Closed MCP
  client/server and removed only verified temporary Vault/account.
- Delivery to the authorized fork is verified after commit; these local tests
  do not imply a live server restart or upstream contribution.
