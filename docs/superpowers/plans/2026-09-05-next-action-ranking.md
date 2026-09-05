# Complete-cohort next-action ranking

> Execute inline with TDD and executing-plans. No agents or live Vault changes.

**Goal:** An agent choosing one action must not miss the best eligible action
because it happened to occur after the first limit*4 action candidates.

**Design:** Make the existing eligibility scan a synchronous generator after
the coherent work snapshot is captured. Stream every eligible action into
boundedTopK, retaining only limit winners. Preserve all existing context,
capacity, workflow and dependency filters/counters; maintain authored order for
equal-ranked actions using an internal ordinal not included in public rows.
Keep existing deadline/status/service/unlock/context/path ordering, but recognize
the valid Unix epoch timestamp (zero) instead of treating it as missing.

**Alternative:** Raising the first-window cap only moves the silent ranking
failure; collecting all rows then sorting raises memory with action count.
The streaming heap evaluates the complete eligible cohort with O(limit) retained
candidate rows. The metadata graph and context totals still occupy memory.

- [x] Reproduce missed late deadlines, missed late unlock prerequisites and
  epoch-zero ranking; preserve equal-score authored order.
  Run `npm test -- src/next-action-ranking.test.ts`.
- [x] Modify src/llm-wiki.ts: generator over the existing scan, full-cohort
  boundedTopK with stable ordinal, finite timestamp handling. Never weaken gates.
- [x] Compare rankings to a full-sort oracle across input orders and limits,
  verify capacity/context/workflow exclusions and existing dependency tests.
- [x] Run targeted/full tests, build and compiled dynamic MCP on an isolated
  Vault. Document complete-cohort ranking and open response-budget gaps.
- [ ] Diff check; commit generated dist and push authorized fork main only.

**Follow-up found during this audit:** nextActions still measures compact JSON
only and can return an oversized single row; reviewDashboard's compact fallback
has no final size check. These remain explicit output-projection audits rather
than being disguised as solved by the ranking correction.
The outer dispatcher does enforce the wire budget; the user-facing failure is
loss of actionable content to generic compaction, not unlimited wire output.

## Verification evidence

- Red: an urgent deadline and a root with five immediate unlocks, each placed
  after 20 ordinary actions, both lost to Early-0 at limit one. A Unix epoch
  deadline also lost to a year-2000 deadline. All three now rank correctly.
- Stable authored action order and absence of internal ordinal fields verified.
  Full-sort oracle agrees for 120 actions across three input orders and limits
  one/three/seven. Capacity-unknown, high-energy, waiting and dependency-blocked
  work remain excluded; context filtering and counters stay exact.
- Targeted suite: 111 passed. Build: exit 0. Full suite: 1,273 passed, one
  skipped, 98 files, 59.50 seconds. `git diff --check` passes.
- Compiled five-tool MCP: contexts @deadline and @unlock each contain 20 earlier
  ordinary tasks plus their winning late task. Z-Urgent is selected by deadline;
  Z-Root is selected with five immediate unlocks while its five children remain
  blocked. An earlier-deadline private other-model note is excluded.
- Tiny-budget probes yielded only 44 characters for next-actions and 33 for
  reviewDashboard, confirming outer generic compaction erases useful work detail.
  Source inspection traced this to enforceResponseBudget/compactOverflowValue;
  preserving action/retry context in service projections is the follow-up.
- Closed fixture MCP client/server and removed only the verified temporary
  Vault/account. No live Vault mutation or restart. Inline review checked that
  the heap consumes the generator fully before totals/diagnostics are projected.
- Fork delivery is verified separately after commit; no upstream contribution.
