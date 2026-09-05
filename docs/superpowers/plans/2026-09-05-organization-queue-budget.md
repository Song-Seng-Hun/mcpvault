# Ranked Inbox and knowledge-review queues with useful bounded output

Existing code dropped every item if the first candidate exceeded the item-only
budget. Inbox and review rows omitted revisions; Inbox planning consumed that
already-compacted queue and lost both target and classification. Final envelope
and indentation were not fully measured. The global dispatcher still limited
wire size, so this was loss of useful information rather than unlimited output.

Implement one shared final queue packer for Inbox, knowledge review and Inbox
planning. Full responses remain unchanged when they fit. Otherwise keep ranked
prefixes, then semantic compact rows, then exact source/revision/read locators.
Mark missing details and keep totals. Retry the same original arguments with
bounded overrides if a head locator cannot fit; never substitute a cheaper row
or loop at the maximum compact budget. Add revisions from query records.

Private collectors retain the same candidate count caps, ranking, scope gates,
snooze and review-policy behavior. Inbox planning and Reflect use these private
collections rather than a lossy public wire representation. No public bypass,
additional MCP tool, mutation, client installation or persistent index is added.

Red: eight real temporary-Vault tests failed before implementation. For both
formats all three endpoints returned no first candidate when its title had
20,000 characters. A moderate 7,000-character budget also lost review reasons
and Inbox classification. After implementation, a test using cascade depth 7
was corrected to valid depth 5: the existing documented range is 1..6 and was
not changed to satisfy the test. The corrected targeted suite passed 116 cases.

Verification scope: real-source revisions, oldest/review ranking, both formats,
bounded prefixes, no-skip same-request retries and impossible ceiling behavior,
empty queues, preserved review reasons/cascade settings, Inbox disposition,
dynamic MCP read-back and downstream Reflect behavior. Build/full tests,
compiled isolated MCP, diff review and fork-only delivery remain required.

The first dynamic smoke caught an incorrect assumed Inbox-plan endpoint ID.
The existing registry uses `mcp.get_wiki_inbox_plan` (default mcp namespace),
not `wiki.inbox_plan`. The implementation now uses endpointIdForTool for every
queue retry, and docs/tests use the verified registered ID. No alias or endpoint
rename was added to hide this integration failure.

Separate follow-up: evaluate review summary freshness against actual body
digests, because metadata-only candidate scans must not treat absent content
as an empty source. This packing change does not alter review eligibility,
transactional consistency of multi-producer scans, or source-change policy.

## Final verification

- Build exited zero. Full suite exited zero: 1,313 passed, one skipped, 101
  files, 67.65 seconds. Dedicated queue tests cover twelve cases plus a dynamic
  MCP regression; the previous Reflect tests exercise the private collectors.
- Compiled MCP retained five tools and passed 24 combinations: three registered
  endpoints, two formats and budgets 512/1200/7000/12000. Minimum-budget compact
  responses were Inbox 404, Inbox plan 457, review queue 468 characters; pretty
  responses were 365, 365, and 373. All retained the ranked first exact source
  and matching revision, and all stayed within the requested final wire budget.
- Larger review results retained overdue reasons and cascade depth 5; Inbox
  plans retained the knowledge disposition. A private other-model older note
  and a future-snoozed knowledge note were excluded from their respective queues
  and counts. The tiny downstream dashboard selected the long-titled Inbox
  source with its revision instead of an empty preview/category-only fallback.
- Both failed and successful smoke fixtures closed client/server and removed
  only their verified temporary Vault/account. No live Vault mutation, restart,
  new agent or client setup. Inline review confirmed ranking/eligibility and
  permissions were unchanged, internal collectors are private, and retry IDs
  derive from the existing endpoint registry rather than invented aliases.
