# Dense backlink reuse implementation plan

> Execute inline with executing-plans and TDD. Existing main branch, one worker,
> no contact with other agents; fork-only deployment/commit/push authorization.

**Goal:** Avoid repeated resolved-link scans for frequently read targets after
the full reverse index exceeds its existing 16,384-occurrence cap.

**Architecture:** Preserve the sparse index and authoritative read checks. Add a
separate occurrence-cache module used only by the overflow fallback, scoped to
the existing caller-predicate/current-membership/generation view. Cache complete
raw occurrence lists, never response pages, permissions, counts or verification.

**Tech stack:** TypeScript, existing Markdown resolver, Vitest and Node.

## Decision and constraints

The user approved the preceding cross-model review's measured optimization and
targeted module extraction. Raising the full-index cap has unbounded scaling;
an unbounded global source/target Set loses occurrences and visibility context.
Instead use target-keyed LRU storage: at most 64 targets / 12,288 occurrence
references, plus one at-most-4,096-reference active fill. Larger targets stream
without caching. Interrupted/failed generators never publish partial entries;
overlapping readers stream independently without allocating another fill.
Empty results also count toward the target limit. The limits bound references,
not exact heap bytes or all concurrent request allocations.

Invalidation and access-membership changes replace the context. Hits still pass
current author access, revision validation, projection, relation filters, paging
and output-budget rules. No persisted cache or new public API. Markdown, manual
checkboxes, standalone comments and source rereads remain unchanged. This does
not eliminate metadata census, solve hub-heavy oversized targets, or promise O(1)
whole queries. Continuity semantic tolerance and reactive work queues remain
separate candidates requiring explicit dependency/authority designs and evidence.

## Execution checklist

- [x] Reproduce overflow repeated scans using real Markdown and public graph
  results; observe failure of reuse assertion before runtime changes.
- [x] Add `src/graph/backlink-occurrence-cache.ts` with bounded LRU and complete
  traversal admission; connect `src/vault-graph.ts` overflow fallback only.
- [x] Test exact occurrences, empty/oversized targets, eviction, early return,
  throws, overlapping fills, current ACL/revision/alias changes and bounded reads.
- [x] Add a repeatable distributed-dense scenario beside the existing disposable
  benchmark. Compare current and baseline runtimes with the same generator;
  separate resolver reuse from NAS transport, model quality and runtime load.
- [x] Run targeted tests, build, architecture checks, full official safe suite,
  self-review (solo user instruction), diff/staged content and secret checks.
- [x] Preserve rollback; deploy tested build on existing NAS-backed runtime,
  verify public read-only MCP and canonical bytes; verify the existing branch
  and user-fork delivery destination.

## Review feedback disposition

Accept dense-cache measurement and focused extraction. Existing safe runner and
directory-event repair are retained. Do not adopt checkbox auto-rewrites,
readback removal, automatic note-embedded skill execution, comment migration or
an unmeasured Merkle protocol. Runtime skill evaluation already has a trusted
host callback; configured real-model evaluation is a separate operational claim.

## Results

Implementation and targeted verification are complete. The seven-file targeted
suite passed 73 tests. Strict build and architecture checker passed. The initial
benchmark assertion expecting exactly one cold read per file failed at 48 vs 32;
cold graph initialization may invalidate/retry a batch, also observed in both
unmodified and modified benchmark runtimes (N+16 reads). The test now requires
at least the full inventory; exact counts/revisions and zero warm-body-read
assertions are unchanged. No production freshness mechanism was weakened.

Solo self-review followed the code-review checklist per the user's no-agent
instruction: completion-only admission, error/finally behavior, finite retained
references/keys, empty results, simultaneous reads, current ACL and generation
checks, unchanged sparse behavior and source verification. This is not an
independent-agent review. A small cache consumes additional memory and does not
speed up all cache misses; these trade-offs are recorded in the measurement doc.

### Final verification and deployment

- Official run `backlink-cache-final1`: 486 files / 6,842 assertions, 6,838 passed,
  zero failures and four pre-existing Windows skips. All 49 batch receipts are
  complete with no failed/interrupted batch. Minimum observed free RAM was
  3.367GiB. Total execution/verification was approximately 41.5 minutes.
- Source/build/test/runtime basis:
  `730fac96f1193f25f507b0cd28a0baf34c085cc8f1dd25d22c3193ffc0497eb7`.
  `npm run build -- --singleThreaded` passed again after the suite; the official
  coverage verifier confirmed identical current bytes. Architecture contract
  checker and diff whitespace checks passed; no contract pins changed.
- A 32-document disposable diagnostic observed initial full invalidation before
  the first batch read, confirming the cold N+16 body-read observation. The
  diagnostic and both initial/repeated benchmark reports are host-local only.
- Deployment `20260913-backlink-cache`: 972 byte-matched generated files. The
  existing scheduled service was restarted into the new immutable release.
  The previous `20260913-safe-graph-shared` release and launcher were retained.
  Exact stopped writer locks were recovered only after process identity/exit
  checks. Original, roleplay and economy bytes/checkpoints were unchanged.
- Live public read-only MCP verification passed: fixed five tools, orientation
  primary read, source-pinned reads, compilation readiness still diagnostic
  (`automaticApplication: false`), and unavailable-path non-disclosure.
  Assertion responses: 339/512 chars (partial) and 1,843/4,000 chars. Backlink
  responses: 466 chars under both 1,024/4,000 budgets, one revision-bearing row.
  No production fixture document or public community action was created.
- Staging is limited to the 13 implementation/test/measurement/documentation/
  generated files. Host configuration, rollback/measurement/test receipts and
  seven unrelated research files remain excluded. Staged path checks and
  scoped content review found no credentials; pattern scanning is not treated
  as a complete secret detector.
- Delivery unit: the commit containing this execution record, on existing
  `main`, to `https://github.com/Song-Seng-Hun/mcpvault.git` only. Normal push and
  remote/local HEAD equality verification follow the final staged review.
  No PR, package, release, upstream contribution, new agent or Telnet operation.

### Remaining boundaries

This delivers the verified dense-query optimization and targeted graph module
extraction, not all seven speculative architecture changes. It does not claim
NAS/full-MCP speedup, real-model quality gains, global heap bounds or cross-call
reuse when callers create fresh predicate functions. Automatic synthesis and
native lifecycle binding remain off; NAS direct-write protection remains outside
scope. Semantic continuity tolerance and reactive dependency scheduling remain
separate design candidates, not silently enabled behavior.
