# Graph reconciliation after preserved-mtime edits

## Reproduced failure

Timed graph refresh reused an entry when size and mtime matched. A missed
watcher edit from `[[Former]] #old` to `[[Target]] #new`, with the original
mtime restored, stayed invisible to a query for Target. The prior source
snapshot guard cannot inspect an incoming author absent from the cached edge
set. Tags and moderation state also stayed old. Four real-file regressions
failed before the production change; the unchanged-body reuse test passed.

## Change

Store ctimeMs in the disposable GraphEntry and include it in the reuse check.
No new endpoint, client setup, daemon, persistent schema or source mutation.
Reuse existing stat I/O and bounded source reads. Full resets, dirty-path
reads, source revision/access guards and refresh generation barriers remain.

## Verification requirements

- Same size and exact mtime, changed ctime: newly introduced incoming edges
  are discovered by querying the unchanged destination.
- Standalone/shared-catalog modes, no watcher and real watcher with change
  listeners removed: exercise actual timed reconciliation and directory reuse.
- Alias, tag, orphan and moderation projections refresh from changed bodies.
- Unchanged repeated reconciliation performs zero additional body reads;
  a single changed source is read once rather than rereading the whole Vault.
- Read failure rejects and remains retryable; an observed edit during a read
  is not erased by refresh; newly found edges remain caller-scope filtered.
- Focused tests, build, full suite, diff check and isolated compiled smoke.

## Boundaries

ctime is a filesystem change hint, not a hash or permission grant. Queries
before the reconciliation interval can still have an incomplete edge set.
All-stat-preserved edits, directory inventory freshness and unobserved edits
during stat/read remain separate audits. Reconciliation is query-triggered,
not a self-running background timer; Markdown remains authoritative.

## Verified results

- Four regressions failed on the old implementation; the final dedicated
  suite passes 14 tests, including actual watchers with dropped change events.
- `npm run build` passed. Full `npm test`: 1,633 passed, one skipped across
  121 files (84.60 seconds). `git diff --check` passed.
- Compiled isolated-vault smoke retained exact size/mtime, recovered the new
  incoming edge through a shared catalog with dropped watcher events, read the
  changed graph body once and added zero body reads on the next reconciliation.
  The compiled MCP server exposed exactly five tools and returned the new
  backlink through `call_endpoint`.
- Astra's read-only review found two coverage gaps, both addressed in the
  four-mode tests; final review found no actionable introduced issue. The
  reviewer was closed. No live Vault or upstream repository was modified.
