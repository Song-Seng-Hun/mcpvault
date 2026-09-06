# Bounded Maintenance Body Consumption Implementation Plan

> Execute inline with TDD and an independent review. Design and main integration
> are already user-approved; preserve unrelated local state.

**Goal:** Reduce maintenance body retention without stale write authorization.
**Architecture:** Four-row revision-checked body iterator over metadata pages.
**Tech Stack:** TypeScript async generators, Promise.allSettled, Vitest.

- [ ] Add real fixture tests in src/maintenance-streaming.test.ts. Spy on real
  queryNotes/hydrateQueryNote to assert metadata-only queries and peak <=4, then
  change a selected candidate before enrichment and assert no new revision/plan.
  Run `npm test -- src/maintenance-streaming.test.ts --maxWorkers=1` for RED.
- [ ] Add iterateNoteBodies to src/paged-query.ts with params and path/row
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
- [ ] In maintenanceDebt import/use iterator with !isModerationHidden predicate.
  Store evaluatedRevision in candidate, remove it from public projection. During
  enrichment call fresh strict bounded readNoteMetadata; omit current-hidden
  rows, attach revision/curationPlan only when current.revision equals the
  evaluatedRevision. Keep missing/error candidates advisory with no write plan.
- [ ] Add iterator tests for page boundaries, order despite completion order,
  denied/hidden rows, failed-sibling drain and early consumer termination. Add
  real fixture summary/MOC/ordinary reason parity, stale-body and current-hidden
  revision barriers, bounded output and unchanged raw files.
- [ ] Run focused tests, build, independent review and full
  `npm test -- --maxWorkers=1`; `git -c core.safecrlf=false diff --check`.
- [ ] Document measured body-group reduction and limits, commit explicit files
  including dist and push Song-Seng-Hun/mcpvault main only; verify remote HEAD.
