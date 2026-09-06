# Qualified Obsidian heading paths

## Source and reproduction

The official [Obsidian internal-link guide](https://obsidian.md/help/links),
checked 2026-09-06, documents multiple hash-separated subheadings. The current
ATX presence/selection helpers treated such paths as literal titles, rejecting
valid MOC entries introduced by the locator gate. Five of six new unit tests
failed before implementation, including valid path presence/selection and
duplicate-path ambiguity diagnostics.

## Implementation

Use a shared active ancestor stack over existing fence-aware ATX headings.
Presence checks match requested suffix paths without retaining a full outline;
flat-only requests preserve the old fast path. Selection prioritizes exact
literal titles for compatibility, then exact qualified paths, otherwise existing
flat partial matches. Sibling/ancestor headings close branches. Qualified paths
must follow the actual chain; no global joining of unrelated matching names.
Only matching candidate headings are retained by selection, not every computed
ancestor path. Reads and split previews use the same physical source snapshot.

No new MCP tool, client setup, or automatic note rewrite. Literal hash-bearing
titles retain precedence; duplicate qualified paths remain ambiguous for
section selection. This is not a full Markdown renderer, Setext implementation,
HTML/inline-format normalization, plugin heading parser or section-level
checkpoint model. The initially considered Setext compatibility check remains
separate; this batch addresses the explicitly documented subheading syntax.

## Verification

Targeted tests: 47 passed, including six new unit tests and two real-service
tests proving learning checkpoints, section reads and split previews select the
same intended branch/revision and reject cross-branch paths. Covers fences,
Properties, physical lines, level gaps, repeated names and old flat semantics.
Build passed. The first complete suite passed 1,827 tests with one existing skip
across 137 files. An isolated compiled five-tool MCP smoke verified qualified
learning routes, exact-branch section reads and split previews, cross-branch
rejection, bare-title ambiguity, and an unchanged source note. Compiled input
schemas expose the same qualified-path guidance. Independent read-only review
found no additional issues; the reviewer was closed after completion.
