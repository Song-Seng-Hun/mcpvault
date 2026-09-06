# Scoped, Revision-Coherent MOC Candidates

User delegated design approval/main integration. No live Vault writes or new
services. This is a read-only proposal, not a transaction or permission grant.

## Evidence

mocCandidates runs graphHealth, scans the entire Vault again, then mixes that
scan's frontmatter with a fresh read's revision. The graph's uncovered rows lack
revision provenance. Private scope:// output paths also fail physical path
matching. Simply fixing matching would let private entries be grouped into the
fixed public Knowledge/MOCs destination. Raw title aliases can inject links in
the generated Markdown.

## Design

1. Include each uncovered graph row's existing source revision. Resolve public
   addresses through ScopeAccessPolicy, then read at most50 exact candidate
   metadata rows fresh/strict with MAX_NOTE_CONTENT_BYTES. Reject missing,
   hidden, mismatched or invalid snapshots with a generic refresh error. No
   second full-Vault metadata scan and no source bodies retained for proposals.
2. Group by source scope root plus existing domain/subject/project/tag/folder
   basis. Reuse canvasScopeRoot for global/Community/model/agent roots; output
   addresses via toPublicPath. Destination is scope-root/Knowledge/MOCs/name.md.
   Require canReferenceFrom for every member. The human-only User scope remains
   inaccessible. Never combine same-topic private, Community and Global groups.
3. Generate plain canonical Obsidian wikilinks from physical paths (not MCP
   URIs), without untrusted aliases. For paths not representable as wikilinks,
   use a percent-encoded relative Markdown link. Escape single-line displayed
   basis/title text so source metadata cannot inject extra scaffold links.
4. Destination collision reads use fresh visible metadata. A hidden destination
   is not disclosed; absent/not-visible gets only conditional expectedRevision:
   missing creation. Visible collision gets bounded notes.read, not overwrite.
   Creation always rechecks current permissions/revision in existing services.
5. Validate all returned source and visible destination revisions once more
   with assertCurrentContextSources (bounded up to80 identities). This checks
   observed inputs, not a Vault-wide atomic graph snapshot; suggestions remain
   advisory. Preserve graph partialness and group-entry truncation in the output.
   Fit the complete response envelope by dropping tail suggestions; if even one
   cannot fit, return explicit truncated metadata, never an oversized response.

## Validation

Real temporary notes plus controlled hooks after actual graph reads exercise
source edits/deletion/hiding, final-read drift, private/public topic separation,
safe Markdown resolution, hidden/visible destination collisions, budgets, and
no second query scan. No live accounts or notes. Re-run graph-population/link
tests and full one-worker suite, build, independent integrity review and diff
check. Commit dist and push only the user fork.
