# Faithful Bounded MOC Candidate Order

Design approval and fork-main integration are delegated by the user. No new
client services, live Vault mutation, or server restart.

## Evidence and alternatives

The current mocCandidates admits the first 12 entries per group before sorting
by nav_order. A high-priority entry arriving later is silently lost. Its draft
then links only eight of those 12 entries, although notePaths/orderedEntries
promise the larger set and may report entriesTruncated:false.

1. Recommended: sort the already bounded admission sample before selecting 12,
   and use those exact entries in all projections. This preserves explicit
   author priority without extra filesystem passes or unbounded output.
2. Cap every projection at eight: consistent, but unnecessarily loses useful
   bounded context and still needs sorting before selection.
3. Return all knowledge: violates bounded-context and resource requirements.

## Contract

- Keep graph admission capped at 50 identities and fresh revision validation.
- Collect admitted entries (at most 50 total), sort each selected group using
  existing nav_order/title/path order, then retain its first 12.
- notePaths, orderedEntries, draft links and notes.write content use that same
  selected set and order. No additional eight-link projection cut.
- Report entryTotal as the number of admitted sample entries in the group;
  entriesTruncated means that sample group was reduced to 12. This is not a
  complete Vault-wide count or a top-12 guarantee outside the graph sample.
- Preserve whole-envelope maxChars admission/trimming. Larger accurate drafts
  may fit fewer groups; truncated remains explicit. Do not shorten individual
  drafts after selecting membership, fabricate dependencies, or write notes.
- Retain scope separation, safe exact links, expectedRevision:missing and final
  bounded revision checks for every returned entry.

## Verification

Use real fixture notes with a controlled graph sample to isolate ordering from
graph dashboard budget pruning. Test late nav_order priority, title tie order,
arrival-order independence, 9/12/14 entry projection equality, sample totals,
budgets, scope and revision regressions. Existing in-memory MCP checks remain.
Run targeted tests, build, full suite with one worker, and diff check. Include
dist in the fork-only commit/push. No performance percentage without benchmark.
