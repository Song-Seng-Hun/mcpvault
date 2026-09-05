# Review freshness must compare actual bodies, not missing projections

Metadata-only queryNotes omits content. Review queues, impact reports and
cascade seeds used hash(note.content || '') and on_link_change used the absent
body as an empty link set. This falsely marked current summaries stale and
unchanged edit/link baselines changed, potentially creating cascade seeds.

Design: reuse the filesystem's revision-checked hydration via one bounded
single-row reader. Check path permission and the metadata admission predicate
before I/O; read a complete source under the existing 8 MiB ceiling; check
revision, scope and current moderation/type after reading. Preserve path-free
snapshot/read errors. No persistent body cache, new MCP tool or mutation.

Only hydrate when an actual summary digest comparison or body-dependent policy
needs it. Query/impact/cascade collection keep their existing metadata scans;
manual notes without projections do not get extra body reads. Cascade retains
only digest and computed link-change facts instead of all link-policy bodies.
Unknown body content is no longer comparable to an empty source hash, and
body-dependent signal evaluation refuses a missing body if a caller bypasses
the preparation step. Actual empty sources remain valid and actual edits still
trigger review. Stored summary/review baselines are never rewritten.

Red: four of five real-Vault cases failed before edits: a current summary was
summary_stale, an unchanged on_any_edit body became note_edited/cascade seed,
an unchanged link baseline became link_changed, and a selected-source race
returned a report instead of rejecting the mixed revision. The real-empty and
real-edit control already passed. Corrected link fixture to use actual stored
{path, revision} baseline entries before confirming its red case.

Validation includes indexed and no-index queries, empty vs absent bodies,
source edit races, pre-I/O scope denial, new quarantine, 8 MiB rejection,
selective hydration and private exclusion. Targeted integration passed 113;
the expanded dedicated suite passed eight. Dynamic MCP, build/full suite,
compiled isolated smoke and diff review precede fork-only delivery.

Remaining boundaries: individual revision checks are not a single atomic
transaction over cascade, queue and evidence-target scans. Source/link targets
retain their existing retrieval/validation contracts. This change removes
false freshness signals; it does not certify every organization mechanism.

## Final verification

- Build exited zero. Full suite exited zero: 1,322 passed, one skipped,
  102 files, 66.64 seconds. The dedicated eight cases include both indexed
  and no-index metadata queries; an additional dynamic MCP regression verifies
  current vs changed summaries/bodies through the real dispatcher.
- Compiled five-tool MCP, both compact and pretty formats: wiki.review_queue
  and wiki.impact_report selected only Changed.md with summary_stale and
  note_edited. Fresh.md (valid summary/edit baseline), Linked.md (unchanged
  body-link baseline), Empty.md (actual empty-source hash), Target.md and an
  inaccessible other-model changed note were not reported as false positives.
  The visible cascade had exactly one actual changed-body seed.
- Selective hydration test reads only the projected summary note, not ordinary
  manual notes or a private note. Denied reads perform no bounded-reader I/O.
  Changed/quarantined revisions reject, and a source larger than 8 MiB rejects
  without hashing partial content. These checks supplement existing catalog
  event and review-policy integration coverage.
- Fixture clients/servers closed and verified temporary Vault/accounts removed.
  No live Vault mutation, server restart, agent creation or baseline rewrite.
  Inline review checked all metadata-only review/body-digest call sites and
  verified that cascade records no longer retain complete link-policy bodies.
