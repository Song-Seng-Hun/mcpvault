# Review queue date integrity

## Confirmed defect and scope

The raw read-side Date.parse/String path bypassed organization date validation.
Impossible days and date arrays could become overdue timestamps or future
snoozes; invalid preservation could enable retention-due recommendations.
Moderation-hidden knowledge also entered the queue and its total.

Use the shared scalar/calendar validator through organizationDateTimestamp.
Keep invalid authored fields visible as bounded repair reasons, never rewrite
Markdown, never infer preservation expiry from invalid data, and distinguish
invalid last-review evidence from missing review history. Retain valid future
snoozes, ISO offsets, leap days and legal holds. Filter moderation before counts.

## Verification

- RED: 26 failures and one valid-date control passing across 27 new tests.
- GREEN: 83 passed across date integrity and review dashboard regression suites.
- Actual in-memory MCP tests cover the five-tool surface, 512/1024/12000-character
  JSON budgets, hidden-note rows/totals and read-only source preservation.
- Full suite, compiled build and independent review recorded below when finished.

## Resumed verification and source freshness

- Delayed watcher regression: five failures reproduced against actual files and
  a real metadata index (hide, unhide, new snooze, malformed replacement snooze,
  and change to a non-knowledge source). Only watcher startup is suppressed.
- Re-read bounded source metadata before metadata-only admission and snooze
  decisions, including the shared cascade projection; preserve the existing
  body hydration revision barrier. Skip absent notes in impactReport as well.
- Cascade scanned counts are updated only after current visibility validation;
  three regression failures exposed hidden/non-knowledge count leakage.
- Two additional RED tests reproduced hidden body-policy notes aborting the
  queue. Such indexed notes now refresh visibility before hydration. The
  independent read-only review found the same defect; its narrow re-review
  confirmed the fix and all three consumers' undefined guards, with no blockers.
- Targeted verification: 127 tests passed across five date/body/dashboard/queue
  suites with one worker; `npm run build` passed, with generated `dist` output.
- Full verification: `npm test -- --maxWorkers=1` passed 2,172 tests, with one
  existing skip, across 146 files in 271.78 seconds. `git diff --check` passed.
- The read-only reviewer confirmed no remaining blockers in the scoped recheck
  and was closed after completion. No live Vault edits or server restarts.
- Cost tradeoff: current metadata checks add bounded source I/O rather than
  trusting a stale watcher snapshot. No new retained body cache or client setup.

## Explicit follow-up

Strict date classification in this batch changes collectReviewQueue, including
its use by Reflect. The shared body helper also tightens source admission for
the cascade and impact projections; impactReport's date classification itself
is not yet converted.
Remaining raw snooze consumers in knowledgeGaps, reviewPacket and unusedKnowledge
need aligned validation, as do work defer/due scheduling, next-actions ordering
and other maintenance reads. Invalid defer must not accidentally release work
or descendants. No claim that every date consumer is fixed.
