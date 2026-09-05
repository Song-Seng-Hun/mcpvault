# Work inventory and selective project hydration

> Execute inline with executing-plans and TDD. No agents or live Vault changes.

**Goal:** Dependency projections use one captured metadata inventory, and project
planning reads only the bodies required by its current project classification.

**Architecture:** Add an internal FileSystemService inventory reader, not an MCP
endpoint. Capture metadata through one index list, filter paths and visibility,
and retain that cohort. Hydrate selected project bodies with existing revision
checks and bounded complete-source reads. Revalidate the visible index inventory
after hydration. Changed membership/revisions fail with the existing path-free
query restart error. The no-index fallback captures one path list and parses
each source once; it is not an atomic snapshot of external filesystem writers.

**Alternatives:** Locks across pages cannot constrain external editors; shared
historical snapshots add retention/eviction complexity. A request-local inventory
fits the already whole-inventory work graph without adding long-lived state.

**Tech stack:** TypeScript, VaultMetadataIndex, VaultIoCoordinator, Vitest.

- [x] Add `src/work-inventory.test.ts`: reproduce impossible readiness across
  the 500-row page boundary; assert unrelated bodies are not hydrated; reject
  body revision and off-project dependency drift. Preserve scope filtering.
- [x] In `src/filesystem.ts`, implement `readQueryInventory(canAccessPath,
  canReadNote, includeContentFor?)`. Use one metadata list; no-index paths use
  normalized, filtered bounded reads. Hydrate in drained batches of 16 with the
  existing 8 MiB source cap. Reject changed visible cohorts after hydration.
- [x] In `src/llm-wiki.ts`, use this reader for workDependencySnapshot and share
  the exact current-project predicate between hydration and projectPacket.
- [x] Run targeted tests and build, full tests, diff check, and compiled MCP
  project/next-action fixture; document remaining external-writer limitations.
Delivery: commit source/tests/docs/dist and verify fork-only main push separately
in execution output; do not infer delivery from local validation.

Commands: `npm test -- src/work-inventory.test.ts`, `npm run build`, `npm test`,
`git -c core.safecrlf=false diff --check`.

No new client setup, tool, background service, persistent snapshot, lock,
automatic knowledge mutation, or task-state policy is introduced.

## Evidence

- Before implementation, the impossible cross-page readiness, unrelated body
  reads, and off-project dependency drift tests failed for their intended
  assertions. Existing body-revision protection already passed and is retained.
- Eleven focused regressions pass: these include >500-row coverage, private and
  moderation-hidden exclusion, addition/deletion/hiding during hydration,
  invisible private changes, no-index single-pass reads, 16-read scheduling,
  and real complete-source size failure.
- Build and diff check pass. Full suite: 1,226 passed, one skipped, 90 files,
  59.02 seconds.
- Compiled fixture rejected a changed prerequisite after hydrating only
  Project.md. Public MCP retained five tools, returned one blocked project,
  excluded the private model project and respected the tested response budget.
  Owned temporary Vault/account removed; no live Vault or server changes.
- Inline review checked scope/path guards, cohort comparison and failure drain.
  Whole-graph/body memory and project response packing remain separate audits.
