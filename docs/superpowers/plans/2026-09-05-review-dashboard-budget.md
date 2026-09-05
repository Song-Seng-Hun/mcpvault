# Useful bounded Reflect dashboards

The wire dispatcher already imposes a budget. The dashboard service previously
returned an oversized two-row-per-section fallback, measured no final pretty
format and retained false `truncated: false` flags after slicing collections.
This could leave the agent with only generic truncation metadata on the wire.

Implementation: separate private shared collection from public packet packing.
Keep the full report when it fits, otherwise reduce section samples, then row
details and graph projections. Preserve collection totals and truthful omission
flags. At tiny budgets select one exact source with a notes.read action;
category priority is explicitly documented, not represented as global ranking.
Oversized head locators cannot be silently skipped and ceiling retries cannot
loop. Empty work samples do not certify graph health. No summed dashboard count
is invented because one note can belong to multiple categories.

Red evidence: six cases failed before edits. A 512-character service budget
returned 41,815 compact / 42,705 pretty characters for a large title. The
6,000-character case returned 22,196; empty work at 512 returned 2,102 pretty
characters. These are service sizes, not final MCP wire sizes.

Dependency regression found and fixed: reviewPacket consumed the public
dashboard's sections after packing, assuming they always existed. Two existing
512-character review-packet tests failed. Private collectReviewDashboard now
provides the bounded-row discovery to both consumers before public packing;
no public bypass option or extra endpoint was added. The subsequent targeted
suite passed 110 tests, including both regressions and catalog-event freshness.

Validation: extend service matrix across budgets/formats, graph-only and
positive-total/no-preview cases; dynamic MCP must retain exact source/revision
and successfully follow notes.read. Run build/full tests, compiled isolated
MCP, inline review and diff check before committing generated dist to fork main.

Remaining separate audits: Inbox and knowledge-review producers still apply
their own preview budgets before the dashboard receives them. Category actions
make omissions explicit but do not repair those producer contracts. Discovery
is shared code, not an atomic transaction spanning every independently sampled
graph/Inbox/knowledge view. Do not claim the full organization goal complete.

## Final verification

- Dedicated dashboard suite: 13 cases, including both formats at five budgets,
  graph-counter preservation, missing producer rows, exact locators and retry
  ceiling behavior. Added dynamic MCP read-back test. Final targeted run: 104
  passed. Earlier catalog/read-barrier integration also passed.
- Build exited zero. Full test process exited zero: 1,300 passed, one skipped,
  100 files, 65.04 seconds. Diff whitespace check passed.
- Compiled isolated MCP retained five tools. With a 20,000-character title,
  compact dashboard lengths at 512/1200/6000/9000/18000 budgets were
  258/258/3248/3248/3248; pretty lengths were 332/332/5665/5665/5665.
  Tiny views selected the overdue source; larger views retained section totals.
  Source reads matched exact returned revisions in all ten cases. Another
  model's earlier-deadline private task was excluded from targets and counts.
- The compiled dependent review packet succeeded at a 512-character pretty
  budget (431 characters), confirming it no longer assumes public dashboard
  sections survive compaction. Existing snoozed-priority and revision-safe
  curation tests pass after the shared private discovery change.
- Fixture clients/servers closed; only the verified temporary Vault/account
  was removed. No live Vault mutation, restart, new agent or client setup.
- Inline review confirmed the only external signature addition passes pretty
  formatting to the packer; identity/access predicates and work classification
  are unchanged. Shared collection is private, not a public budget bypass.
