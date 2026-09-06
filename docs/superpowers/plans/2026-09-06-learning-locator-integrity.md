# Authored learning locator integrity

## Evidence

The learning path resolved document identity but copied heading/block fragments
without checking them. Repeated document links were deduplicated into one entry,
allowing a later broken fragment to escape. Nine baseline tests failed: missing
headings/blocks, repeated-target fragments, fenced/non-anchor examples, missing
locator diagnostics on resume, and a grouped body-read contract. Existing
source revision checks already invalidated a previously saved route after a
body edit; they did not prevent capturing that newly broken route again.

## Fix

Collect locator occurrences only for selected entries. Group by visible physical
target; read once per group with the existing 8 MiB cap and captured revision.
Use fence-aware requested-heading and requested-block presence sets; retain no
source-body cache. Add unresolved_body_locator diagnostics with source MOC,
line, target and bounded locator fields. Keep the authored document for repair,
but make navigationComplete false, including compact/checkpoint projections.
Continuity rejects recapture until repair; ordinary work notes remain available.

No new client installation or stable MCP tool. Markdown, authorization and
final captured-source rechecks remain authoritative. The cap applies to added
locator reads, not every existing learning-path source read or total heap.

Supported locator semantics reuse the existing case-normalized ATX heading
and terminal block projections. This is not full Obsidian/plugin heading
compatibility, duplicate-heading disambiguation, root self-link validation or
section-granular/repeated-section progress. Those remain separate work rather
than being implied by this patch.

## Verification

Fifteen new tests pass: broken and valid fragments, repeated references,
fences, terminal ID boundaries, nested-map repair, case/percent decoding,
compact gates, source visibility and one grouped bounded hydration. Earlier
combined learning/budget/checkpoint/snapshot suites passed 48 tests before the
last five new cases were added. Independent read-only review found no concrete
scope/hash/bounded-read/traversal issue. Final build passed; the full suite
passed 1,819 tests with one skip across 136 files (76.92 seconds).
`git diff --check` passed. Compiled isolated MCP smoke verified five tools,
missing-locator diagnostics, checkpoint rejection, revision-safe repair,
successful recapture and stale resume after anchor deletion. No live Vault or
running user server was modified.
