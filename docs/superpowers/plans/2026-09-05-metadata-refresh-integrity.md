# Metadata refresh integrity implementation plan

> Execute inline with executing-plans and TDD. No agents or live Vault changes.

**Goal:** Work, review and organization queries must not return a metadata refresh already invalidated by an observed change during its IO.

**Architecture:** Bring metadata refresh publication under a monotonic observed-change guard. Stage full/dirty batches and publish only if their generation remains current. Drain catalog notifications after IO, retry up to three times, and fail with a path-free retry error under continuing churn. Full unknown-path resets force source reads even if stat fields match. Dirty reads use the existing 32-read batch bound and drain failures before returning.

**Tech stack:** TypeScript, existing VaultMetadataIndex/VaultFileCatalog/VaultIoCoordinator, Vitest deterministic notification and read gates.

## Scope and trade-offs

The workDependencySnapshot audit found two later tasks: capture a single logical
metadata inventory instead of merging independently changing pages, and hydrate
only planning-relevant project bodies. Correct index publication is their
prerequisite, not proof they are solved. A read lock across the filesystem would
not protect external writers; retained copies introduce unrelated state. Use
observed-generation guards and explicit retry failure. Stat-only periodic
reconciliation remains unchanged for unnotified files; this is not an atomic
filesystem snapshot or a guarantee of OS notification delivery.

## Tasks

- [x] Add failing tests for a newer dirty update, unknown reset during IO,
  same-size/mtime reset, sustained churn, and bounded dirty scheduling. Retain
  existing storage-error recovery tests.
- [x] Centralize full invalidation; preserve force-read obligations. Stage
  batches and discard invalidated refreshes rather than publishing old values.
  Post-drain the catalog and retry at most three generations.
- [x] Verify next-action behavior over the refreshed metadata, including a
  prerequisite reopened during IO. Update guidance and the outstanding audit.
- [x] Run targeted tests/build/full suite/diff check and compiled read fixture.

## Verification and handoff

- Baseline: all six original regression cases failed for their intended stale
  result, missing new entry, unchanged-stat reset, churn, batch, or work-readiness
  assertion. No production change preceded this evidence.
- Targeted: 51 tests passed across metadata integrity, catalog barrier, metadata
  index and storage failure suites. Added concurrent callers, received-during-IO
  catalog events, and failed-batch drain/retry coverage (nine new tests total).
- Build passed. Full suite: 1,215 passed, one skipped, 89 files, 61.47 seconds.
- Compiled isolated fixture returned the newer revision, exposed exactly five
  MCP tools, and `wiki.next_actions` offered the open prerequisite but excluded
  its dependent task. The temporary fixture/account were removed.
- Inline review checked generation publication, retained retry obligations,
  concurrent refresh sharing, error redaction and compatibility. No new agents.
- Delivery is source/tests/docs/dist to Song-Seng-Hun/mcpvault main only; commit
  and remote SHA verification are recorded separately in the execution output.

Commands: `npm test -- src/metadata-refresh-integrity.test.ts src/catalog-read-barrier.test.ts src/index-io-failures.test.ts`, `npm run build`, `npm test`, `git diff --check`.
