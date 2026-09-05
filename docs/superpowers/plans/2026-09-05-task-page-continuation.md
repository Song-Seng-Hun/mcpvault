# Task-page continuation implementation plan

Inline executing-plans/TDD. Autonomous implementation and fork-main publication
authorized; no new agents, live Vault edits, client setup or server restart.

## Design and alternatives

An offset alone can skip/duplicate tasks when earlier Markdown changes. Use an
offset plus expectedSnapshot SHA256 from the visible filtered task stream. Each
task contributes its owner revision/locator/identity to a deterministic hash;
status and normalized pathPrefix bind the query. Hidden owners contribute nothing.
Changed visible results reject continuation with a restart instruction. This is
stateless between calls, not an atomic filesystem census. Scope changes apply
the current predicate again before hashing/counting.

Retain only the requested task page while counting/hashing the ordered scan;
avoid the existing vault-wide array of all task bodies. This does not eliminate
the full scan, per-file extraction arrays, or large-file IO costs.

Move response packing to src/task-page.ts. Continuation advances by emitted
items, never by requested limit or dropped previews. Keep revisions and exact
locators; shorten optional text before dropping an entire page. If no locator
fits, return a bounded same-request larger-budget/non-pretty/single-item retry,
not an unchanged-offset next-page loop. A locator that cannot fit even that
ceiling is an explicit error. No credentials in actions. The next action uses
the original public pathPrefix, not the physical server path.

## Tasks

- [x] Add direct service regressions in src/task-pagination.test.ts: ordered
  pages, stale-owner rejection, changed query rejection, hidden edits not changing
  the fingerprint, offset validation, end-of-list.
- [x] Extend ListTasksParams/Result with offset/expectedSnapshot and fingerprint.
  Validate input, stream count/hash while retaining at most limit items, reject
  changed snapshot before returning data. Keep default first-page behavior.
- [x] Add public MCP tests following returned nextAction through all items with
  tight budgets, checking no gaps/repeats, source revisions, hidden exclusion,
  and token-free restart/retry actions. Implement shared bounded task-page packing
  and add the two optional arguments to registered schema/dispatcher.
- [x] Update guides, build, full tests, compiled isolated MCP smoke and diff-check.
  Commit source/generated dist and verify fork main publication separately.

## Evidence and remaining limits

- Baseline four regressions failed: no snapshot field, no guarded offsets/filter
  rejection, and public continuation stopped after two of seven tasks.
- Six new cases pass, including inaccessible storage failure and oversized
  locator retry/ceiling behavior without secrets. Target run with checkbox and
  public server coverage: 53 passed; prior filesystem-inclusive run: 229 passed,
  one skipped. Build succeeded.
- Full suite: 1140 passed, one skipped across 79 files (60.25 seconds).
- Compiled Client/InMemory MCP smoke followed scope://global/Tasks.md continuation
  through nine tasks exactly once with 1200-character pretty responses. The
  512-character retry was executable and returned one item; editing the source
  then rejected the prior continuation. Only the validated temporary fixture
  was removed after closing client/server. No live Vault writes or restarts.
- Inline review: full-page serialization is checked separately because it can
  omit nextAction; shorter prefixes have monotonic size and use binary search.
  No credentials or physical pathPrefix are copied into returned actions. Hash
  includes visible source revisions even when text is preview-clipped.
- Still not an atomic census or indexed constant-cost pagination. Inventory
  scan/read cost, per-file parsing size, and edits occurring during a scan remain
  separate work; the guard detects changed streams across requests, not OS CAS.
