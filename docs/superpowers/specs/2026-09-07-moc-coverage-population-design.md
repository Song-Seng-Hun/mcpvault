# MOC Coverage Population

Design approval and fork-main integration are delegated by the user. Keep
Markdown authoritative, no live Vault edits, no extra services/client setup.

## Evidence

graphHealth includes llm_wiki_type:knowledge MOCs in knowledgePaths. MOC coverage
then reuses this broad set for its denominator, linked totals and uncovered
list. Thus a valid root map becomes uncovered knowledge and mocCandidates can
propose another map for existing maps. Graph map discovery also uses raw
note_kind equality while maintenance and hierarchy planners normalize the kind.
Existing integration coverage uses MOCs without the knowledge managed type and
therefore does not exercise this mismatch.

## Choice

Do not remove MOCs from the full knowledge graph or usage statistics: maps are
still authored knowledge and must remain in hierarchy, connectivity and usage
views. Do not require cyclic links or artificial parents just to reach100%.
Instead use the existing mocPathSet to define a coverage-only population:
knowledgePaths.has(path) && !mocPathSet.has(path). Calculate its size by
subtracting known map keys from knowledgePaths.size without another full set.

Use this predicate for each map's linked/direct/indirect knowledge counts,
coverage ratios, uncovered entries and global MOC coverage totals. Keep
linkedNotes and nestedMocs structural counts unchanged. mocCandidates already
consumes this coverage view and should no longer propose maps for maps.
Normalize note_kind with trim/lowercase once during graph collection and use
that same kind for map discovery. No change to retired-note retention semantics,
target resolution, source access, or managed type inference.

## Contract and verification

Coverage measures visible non-map knowledge reached through authored MOC links,
not primary_moc metadata presence or epistemic truth. Empty eligible population
has ratio1 and total0, not an invitation to create another map. Full graph usage
counts remain broader and can differ from MOC coverage totals intentionally.

Real temporary-note tests cover managed/unmanaged and normalized maps, nested
maps and cycles, maps-only inventory, genuinely uncovered notes, hidden/private
maps/notes, optional snapshot visibility and no source mutation. Real MCP output
must fit its budget, retain five tools, and agree with the service. Existing
link-resolution and maintenance tests must remain green. Run build, scoped
review, full one-worker suite and diff check; include dist and push fork only.
