# Authoritative organization dates must be real scalar calendar values

## Evidence and contract

Date.parse silently normalized impossible days (February 30, non-leap-year
February 29, April 31), and String coercion admitted singleton date arrays.
Raw malformed validity metadata could disappear into unspecified or current
instead of invalid. This corrupted task timing, review and temporal knowledge
classification even though Markdown remained unchanged.

Share one scalar/calendar validator across organization date normalization,
review-date normalization, 17 explicit lint checks and temporalValidity. Check
the authored Gregorian day before Date.parse; do not compare an offset date to
its UTC calendar day. Retain real leap days, offsets, historical four-digit
years and the original string (apart from trimming). Optional API null/blank
inputs still mean absence; an explicitly malformed/null raw YAML date is
invalid and must be repaired deliberately. No automatic source rewrites.

Actual MCP tests additionally revealed catalog entries exposed moderation-hidden
notes. Apply the existing moderation predicate before catalog totals, entries
and facets, including summary-only projections.

## Verification

- Date RED: 28 failed, 15 controls passed.
- Date GREEN: 102 passed with organization and workflow timing suites.
- Actual MCP exposed three catalog hidden-note failures; adding the filter
  made all 98 date/excerpt tests pass. Invalid source metadata is excluded
  from current validity results and remains visible as invalid for repair;
  hidden identities do not enter entries or summary facet counts.
- Independent date review found duplicate clarified_at lint checks. Added
  exact-one assertions for all 17 fields: one RED, then removed the earlier
  optional-input validator and retained the strict raw-source validator so null
  is still invalid. Targeted date/organization/MCP rerun: 132 passed.
- First full run caught that same duplicate while the correction was underway;
  2,136 passed, one failed, one skipped. Fresh final rerun: 2,137 passed,
  one skipped across 145 files (97.82s).
- Fresh build and diff check passed. Reviewer closed. Compiled isolated MCP
  smoke covers calendar/type rejection, valid offsets, one lint issue, invalid
  temporal projection, hidden-note entries/facets and non-mutating bounded reads.

This does not claim every historical direct Date.parse call elsewhere in the
project now shares this validator. Audit remaining raw scheduling/read consumers
separately; do not claim all date-dependent behavior is proved by these tests.
