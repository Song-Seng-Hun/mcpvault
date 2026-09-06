# Bounded Maintenance Body Consumption Implementation Plan

> Execute inline with TDD and an independent review. Design and main integration
> are already user-approved; preserve unrelated local state.

**Goal:** Reduce maintenance body retention without stale write authorization.
**Architecture:** Four-row revision-checked body iterator over metadata pages.
**Tech Stack:** TypeScript async generators, Promise.allSettled, Vitest.

- [x] Add real fixture tests in src/maintenance-streaming.test.ts. Spy on real
  queryNotes/hydrateQueryNote to assert metadata-only queries and peak <=4, then
  change a selected candidate before enrichment and assert no new revision/plan.
  Run `npm test -- src/maintenance-streaming.test.ts --maxWorkers=1` for RED.
- [x] Add iterateNoteBodies to src/paged-query.ts with params and path/row
  predicates. Query limit500/includeContentfalse/includeTotalfalse, carry after
  cursor, then process groups:
  ```ts
  const results = await Promise.allSettled(group.map(note =>
    fileSystem.readQueryNoteBody(note, canAccessPath, canReadNote)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  for (const result of results) if (result.status === 'fulfilled') yield result.value;
  ```
  Avoid retaining previous groups or prefetching next ones. Capture next cursor
  from the metadata page, not a transformed returned body.
- [x] In maintenanceDebt import/use iterator with !isModerationHidden predicate.
  Store evaluatedRevision in candidate, remove it from public projection. During
  enrichment call fresh strict bounded readNoteMetadata; omit current-hidden
  rows, attach revision/curationPlan only when current.revision equals the
  evaluatedRevision. Keep missing/error candidates advisory with no write plan.
- [x] Add iterator tests for page boundaries, order despite completion order,
  denied/hidden rows, failed-sibling drain and early consumer termination. Add
  real fixture summary/MOC/ordinary reason parity, stale-body and current-hidden
  revision barriers, bounded output and unchanged raw files.
- [x] Run focused tests, build, independent review and full
  `npm test -- --maxWorkers=1`; `git -c core.safecrlf=false diff --check`.
- [x] Document measured body-group reduction and limits, commit explicit files
  including dist and push Song-Seng-Hun/mcpvault main only; verify remote HEAD.

## Evidence and resource boundary

- Initial real-fixture RED: four failures, two passes. Indexed hydration peak
  was 17 for 17 input notes; selected-source edits authorized old repair reasons
  with a new revision; an already-hidden row leaked into scan counts. Unindexed
  baseline doesn't use hydrateQueryNote but retains content in its query page.
- GREEN: six original tests passed. Expanded lifecycle/iterator coverage passed;
  broader five-file run passed 133 tests before final extra race cases.
- The body iterator has four active/retained group results at a time rather
  than full 500-row content pages; consumer-held objects and metadata remain
  separate. Tests use real 17-file IO plus a 1,201-row deterministic cursor
  harness, not a production RSS or latency benchmark.
- Independent review found hidden-row aggregate contributions survived removal.
  Reproduced RED, then removed observed-hidden scanned/reason/truncation counts.
  Single/mixed hidden and deleted-candidate tests now cover that boundary.
  Latest two-file targeted run: 16 tests passed. Build passed after explicit
  undefined-source/count handling. Delta review found no remaining actionable
  defects; reviewer closed. Full one-worker suite passed: 2,525 passed, one
  skipped, 170 files, 317.25 seconds, exit zero. Whitespace check passed.
- Design 9437d05 and implementation 9871025 were pushed to the user fork main;
  local HEAD and origin/main matched. Unrelated .agents/.mcpvault remain untracked.

## Subsequent inspection candidates (not implemented or verified here)

- maintenanceDebt's empty-MOC check still uses a raw wikilink regex, unlike
  fence-aware navigation helpers elsewhere; test fenced examples next.
- Its active-project next-action check still tests scalar next_action and
  waiting_for directly; inspect consistency with next_actions/actionable
  knowledge workflow rules before changing semantics.
