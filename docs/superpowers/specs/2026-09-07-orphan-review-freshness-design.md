# Orphan review action freshness

## Evidence and contract

The review packet checks candidate content revisions, but an incoming link can
change on a different note after candidate admission. Two deterministic tests
add a Wiki or Community backlink during the final target hash read; the old
packet incorrectly returns an `orphan_note` repair with an unchanged revision.

Before returning orphan priorities, re-query their current orphan membership
using the existing scope-filtered graph and candidate predicate. Reject with
the existing bounded refresh error when a returned candidate is no longer an
orphan. Do not mutate notes, change identities, or expose new MCP tools.

## Alternatives and cost

- A global generation guard would reject unrelated activity and can starve a
  busy community. Do not use it.
- A complete orphan snapshot comparison also rejects unrelated orphan changes.
- Selected membership revalidation checks at most the returned priority limit
  (30) in one graph query. Reuse graph visibility and incoming-link semantics;
  Community records may supply links even though they are not repair targets.

The extra query traverses the visible graph once, not once per target. No
snapshot hash or body cache is added. Non-orphan packets perform no extra query.
With a persistent graph this checks observed indexed changes; without one the
existing temporary graph is rebuilt. It is not an atomic filesystem census,
does not prevent changes after return, and does not certify other diagnostic
sections as a transactionally consistent snapshot. Revision-safe writes and
inspection remain necessary.

## Verification

Cover visible Wiki/Community backlinks, shared-index invalidation, private and
moderation-hidden sources, fenced examples, self links, unrelated activity,
secondary orphan priorities, bounded output and refresh errors. Retain the
existing revision and recall tests. Run focused tests, build, full tests with
one worker and diff checks. Publish only to the authorized user fork.
