# Distinct MOC Proposal Paths Implementation Plan

> Inline executing-plans with TDD; design approval and fork-main publishing are
> delegated. Keep unrelated .agents/ and .mcpvault/ untouched.

**Goal:** Distinct admitted groups never receive the same suggested note path.
**Architecture:** bounded groups -> pure deterministic path allocation -> existing
scope/revision checks and response projection. No new endpoint or index.
**Tech Stack:** TypeScript, node:crypto/node:path, Vitest, existing services.

- [x] Add real-fixture regressions to src/moc-candidate-snapshot.test.ts and
  src/moc-rebalance-coherence.test.ts. Two domains A/B,A:B must produce two
  unique suggested paths; creationPlan.arguments.path must equal suggestedPath.
  Test 100-character-prefix candidate labels and 80-character rebalance labels.
  Run npm test -- src/moc-candidate-snapshot.test.ts
  src/moc-rebalance-coherence.test.ts --maxWorkers=1 and record RED.
- [x] Add src/proposal-paths.test.ts, then src/proposal-paths.ts exporting
  allocateProposalPaths(items:Array<{path:string;identity:string}>):string[].
  Normalize slashes; count lowercased physical paths; reserve all input names.
  Sort collisions by identity/path using lexical comparison; append
  SHA256(identity).slice(0,12), then counters if already reserved. Return paths
  in original order. Tests cover reordered inputs, unique names unchanged,
  case-insensitive collisions and natural suffix-shaped destination conflicts.
- [x] Import helper in src/llm-wiki.ts. Compute all candidate target paths before
  slice(boundedLimit), all branch targets before slice(boundedBranches). Identity
  includes full scope, basis kind/value (and root for rebalance). Carry chosen
  path into existing generation loops; add pathDisambiguated only on changes.
- [x] Extend fixture tests: output-limit stability, visible/hidden existing
  disambiguated target, cross-scope separation, preview creates no files.
  Verify selected path matches draft context and notes.write arguments.
- [x] Document advisory path suffixes in README.md, _wiki/SCHEMA.md and tool
  guidance. Run focused suites, npm run build, npm test -- --maxWorkers=1 and
  git diff --check; review implementation independently before publication.
- [x] Explicit stage/commit source, tests, docs and generated dist; push only
  origin main and verify HEAD, origin/main and remote refs/heads/main.

## Evidence

- Real temporary-Vault RED:4 failures (expected2 distinct paths, received1),
  52 existing tests passed. Both sanitization and truncation reproduced in both
  candidate/rebalance services.
- Pure helper initially had a missing-module failure, then an identity-return
  stub produced3 assertion failures and1 pass. Implementation passed all4.
- Initial focused GREEN:60/3 files. Added grouping-kind identity, scoped
  isolation, visible/hidden destination handling and branch-limit regression;
  final focused GREEN:67/3 files,11.57s,exit0.
- Build exit0; diff check exit0. Luna Medium independent read-only review found
  no issues in allocator/service/tests; reviewer closed. Main reviewed the
  actual diff and docs; no source changes required by review.
- Full one-worker regression:178 files passed;2754 passed,1 skipped (2755),
  317.98s,exit0. Started2026-09-07 04:24:06 local. No failures/timeouts.
- Generated dist includes the allocator. Final diff check exit0. No live Vault,
  server, client setup, model download or upstream action occurred.
- Implementation ebbd1b1c75c6fcea4ecac6ac367ccc5d02fa20f2 published to the
  user fork main. HEAD, origin/main and live remote refs/heads/main matched.
  Unrelated .agents/ and .mcpvault/ retained. Review worker closed.
