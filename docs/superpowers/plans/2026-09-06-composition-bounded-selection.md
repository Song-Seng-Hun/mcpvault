# Bounded composition selection

## Verified baseline

Composition review retained every candidate before sorting and slicing, even
though output was limited to 30. A real 46-candidate test requesting three
observed a 46-element candidate sort. Every note also built a complete outline
despite retaining only eight heading locators in its result.

## Changes

- Extract the existing max-heap into reusable incremental `createBoundedTopK`.
  Keep synchronous `boundedTopK` as its compatible wrapper; snapshots copy the
  array so inspecting them does not invalidate later insertions.
- Composition scans keep at most K candidate summaries, with unchanged
  score/public-path comparison. Continue reading/evaluating all eligible notes
  and counting every match; never stop at the first K matches.
- Preserve stable scan order when distinct Unicode paths compare equally in
  the locale collator. A private scan ordinal is the final comparator key and
  is stripped from response rows. This preserves prior stable-sort ties.
- Heading summary iterates the same fence-aware physical heading parser,
  counts all headings/prose characters, and retains at most eight locators.
- Preserve source validation, physical lines, hidden/private filtering, full
  result totals, first-target budget behavior, and read-only/advisory semantics.

## Bounds

Selection is O(N log K), final sort O(K log K), candidate retention O(K).
Heading locator retention is O(8), not an entire outline. This is not a claim
of bounded total Vault memory or streaming filesystem reads: one current raw
note and paged metadata are still processed, and all eligible notes are read.

## Verification gates

- Red/green 46-candidate sort bound; late higher score and deterministic ties.
- 10,000 incremental items, retained size <=K, snapshot inspection then further
  inserts, invalid capacities, and all existing synchronous callers.
- 2,000 headings with matching fences/Properties/CRLF/ATX closers: exact totals
  and first eight physical locators; long-body scoring beyond the retained prefix.
- Existing composition drift, permissions, fence and compact/pretty tests.
- Build, full suite, independent review, compiled selector/MCP smoke, diff check,
  generated dist, user-fork-only commit/push.

Verified: 28 focused tests passed, including the real-disk Unicode tie
regression found by Astra (red before ordinal fix). Build and fresh full suite
passed: 1,570 passed, one skipped, 116 files. The compiled selector retained
at most 30 items over 100,000 inputs and selected the exact top 30. Compiled
MCP selected the exact top three of 62 visible candidates, preserved 50-heading
counts with eight locators, checked source revisions and 512-character
compact/pretty output, and excluded private/hidden notes. Temporary Vault
removed. Astra re-reviewed the ordinal fix with no remaining actionable
finding and was closed. `git diff --check` passed.
