# Maintenance Snooze Attention Routing

Date: 2026-09-05
Status: Approved for autonomous implementation

## Purpose

MCPVault already records deliberate review deferral in ordinary Obsidian
Properties: `review_snoozed_until` and `review_snooze_reason`. The dedicated
review queue honors that state, but the broader `wiki.review_packet` rebuilds
priorities from graph, lint, recall, and workflow projections without applying
the same rule. A deferred top defect can therefore be selected by every idle
agent pulse and starve every actionable item behind it.

This change makes snooze a routing concern, not a truth filter. Explicit
health, graph, lint, and exception views continue to report the defect. Only
the bounded next-action list and `curationPlan` skip a note whose snooze date is
still in the future.

## Chosen design

After the existing projections have coalesced findings by path and sorted them,
the review packet asks the disposable metadata index for exactly those visible
candidate paths. It inspects at most a fixed multiple of the requested result
limit, filters future snoozes, and stops after collecting the requested number
of actionable priorities. It never opens candidate bodies merely to inspect a
Property.

The packet reports:

- `counts.snoozedPriorities`: visible candidates skipped in this bounded scan;
- `nextSnoozedReviewAt`: the earliest valid future snooze date observed;
- `priorityScanTruncated`: whether uninspected candidates remain.

An expired, invalid, or absent snooze is actionable. A candidate that vanished
or became inaccessible between projections and metadata lookup is omitted from
the action list and cannot contribute to counts or dates.

## Alternatives rejected

1. Round-robin state would be lost on restart and could let critical findings
   drift behind routine ones.
2. A separate acknowledgment database would create an alternate source of
   truth and complicate Obsidian/Git portability.
3. Removing snoozed findings from graph and lint reports would make maintenance
   dashboards falsely healthy.
4. Reopening every note body would make idle pulse cost proportional to body
   size rather than bounded metadata.

## Bounded and security semantics

- Exact-path metadata reads normalize paths, apply `PathFilter`, and apply the
  caller access predicate before returning data.
- The index is advisory and refreshes dirty entries before lookup; Markdown
  frontmatter remains authoritative.
- The scan cap is independent of Vault size. If the cap prevents a full answer,
  the response says so instead of claiming completeness.
- Hidden candidates cannot influence returned counts, dates, paths, or
  truncation details.
- Tiny response compaction preserves the selected action first; normal and
  compact review packets preserve snooze routing metadata when it fits.

## Acceptance criteria

1. A future-snoozed highest-ranked defect remains visible in graph/exception
   reporting but is absent from review priorities and cannot own the plan.
2. The next unsnoozed candidate is selected with its current revision.
3. When all inspected candidates are snoozed, no unsafe plan is invented and
   the earliest reappearance time is returned.
4. Expired snoozes become actionable again.
5. Hidden snoozed notes cannot affect public counts or dates.
6. Candidate metadata lookup reads no note bodies and remains bounded.
7. Existing `maxChars`, fixed-five-tool, read-only, revision, and scope
   contracts remain unchanged.
8. Targeted tests, build, full tests, and `git diff --check` pass; generated
   `dist/` is committed with source.

## Delivery boundary

Commit and push only to `Song-Seng-Hun/mcpvault` branch `main`. Do not create a
pull request, release, tag, package publication, or upstream contribution.
