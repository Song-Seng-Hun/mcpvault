# Stack-safe dependency traversal

> Execute inline with TDD. No additional agents or live Vault operations.

**Goal:** Deep dependency chains and cycles must not exhaust the JS stack;
work-stage and downstream propagation queues must avoid repeated array shifting
and resorting without changing public dependency classifications or ordering.

**Architecture:** Extract the shared strongly-connected-component classifier
into `src/dependency-graph.ts` and replace recursive Tarjan traversal with explicit
DFS frames/iterators. Retain input-rank ordering and the original return contract.
All three existing work/MOC consumers use the same helper. Use cursor-based FIFO
queues for work propagation and topological stage calculation: the stage number
is order-independent and public stage rows/candidates are explicitly sorted.

**Trade-offs:** No graph-size cutoff or approximate cycle classification. Memory
remains O(nodes + edges) for the work graph, plus existing note/index data. This
does not resolve retained project-body memory or all other graph algorithms.

- [x] Reproduce deep-chain failure through the real work snapshot with synthetic
  inventory rows; run it before editing the production traversal.
- [x] Move classifier into dependency-graph.ts; implement iterative DFS keeping
  low-link, active-stack and rank semantics. Keep each frame's edge iterator.
- [x] Replace work propagation/stage array.shift and repeated sorting with
  cursor queues. Verify diamond depth, cycles, downstream blocking and ordering.
- [x] Compare classifier against a small reachability oracle over deterministic
  random graphs; test deep cycles, self-links, disconnected and excluded nodes.
- [x] Build/full tests/diff check/compiled traversal and isolated MCP flow smoke;
  document exact scale evidence and fork-only commit/push separately.

Commands: `npm test -- src/dependency-traversal.test.ts`, `npm run build`,
`npm test`, `git -c core.safecrlf=false diff --check`.

## Evidence and handoff

- Before implementation, the real work snapshot over 12,000 synthetic inventory
  rows failed at recursive visit with `Maximum call stack size exceeded`.
- Five tests pass, including that chain's exact terminal depth, a 30,000-node
  cycle, 150 independent reachability-oracle comparisons, self/outside edges and
  original rank order, and a 2,000-child frontier with exact unlock counts.
- Build/diff checks pass. Full suite: 1,247 passed, one skipped, 93 files,
  67.94 seconds. Strict optional-parent typing was corrected before this build.
- Compiled SCC smoke: 50,000-node chain and cycle both classified exactly.
  Separate isolated MCP fixture: five tools; diamond stages Root / A,B / C;
  four stageable tasks; depth two; two cyclic tasks and one cycle-blocked task;
  next-actions contains only Root. Test Vault/account removed afterward.
- Inline review verified low-link propagation and active-stack semantics,
  input-rank component order, selected-node filtering, and order-independent
  stage depths with explicitly sorted public projections. No new agents.
- Delivery: source/tests/docs/dist to the user fork main only. Commit and remote
  SHA verification are recorded in execution output, not inferred from tests.
- Remaining: retained project bodies, whole-index/graph memory and full deepest
  chain response construction. This is stack safety and queue-work reduction,
  not a representative whole-server throughput benchmark or fixed memory cap.
