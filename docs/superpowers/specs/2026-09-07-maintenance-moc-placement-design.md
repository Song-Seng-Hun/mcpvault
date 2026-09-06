# Maintenance MOC Placement Semantics

User delegated design approval and authorized fork-main integration. No live
Vault changes, new services, permissions or tools are required.

## Evidence and choice

maintenanceDebt compares `moc` against lifecycle when deciding no_primary_moc.
But mocMembershipPreview blocks note_kind:moc and directs hierarchy changes to
moc_parent. SCHEMA documents moc_parent as optional. A root map therefore gets
an impossible membership recommendation. Truthy arrays/objects/whitespace also
hide missing primary entry points. Finally a generic MOC-candidate listing is
not inspection of the exact candidate source.

Changing the membership planner to accept maps would conflate membership and
hierarchy. Automatically assigning maps would invent author intent and require
extra reads. Instead fix only the advisory maintenance predicate and route:

- A normalized note_kind:moc never incurs no_primary_moc; an empty MOC still
  incurs empty_moc and receives its existing exact-source link repair route.
- Non-retired knowledge needs nonempty scalar primary_moc or legacy moc.
  Reuse hasAuthoredText. A mocs list or moc_parent alone is not a primary entry
  point. Text presence is not proof of target resolution or schema validity;
  existing lint and membership preflight retain those responsibilities.
- Placement inspection reads the selected note using wiki.read_projection,
  full view, maxChars5000. The existing wiki.moc_membership preflight remains
  the next operation, requiring explicit visible map selection and a complete
  additional set. Guidance must say to inspect a map before choosing it and
  must not imply omitted additionalMocPaths preserves existing membership.
- Keep date/inbox/review precedence, current-revision checks, hidden filtering,
  response budgets, and five fixed tools. No automatic note edits.

## Verification

Real temporary Markdown fixtures cover root/nested/normalized MOCs, empty maps,
missing and malformed scalar fields, legacy fallback, retired notes, mocs-only
notes and hidden/private candidates. Real MCP tests check bounded budgets and
exact inspection. Exercise membership preflight with an explicit map and
confirm it produces current-revision changes without modifying source bytes.
Run focused tests, build, independent review, full suite with one worker and
diff check before committing generated dist and pushing only the user fork.
