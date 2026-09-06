# Distinct MOC Proposal Paths Implementation Plan

> Inline executing-plans with TDD; design approval and fork-main publishing are
> delegated. Keep unrelated .agents/ and .mcpvault/ untouched.

**Goal:** Distinct admitted groups never receive the same suggested note path.
**Architecture:** bounded groups -> pure deterministic path allocation -> existing
scope/revision checks and response projection. No new endpoint or index.
**Tech Stack:** TypeScript, node:crypto/node:path, Vitest, existing services.

- [ ] Add real-fixture regressions to src/moc-candidate-snapshot.test.ts and
  src/moc-rebalance-coherence.test.ts. Two domains A/B,A:B must produce two
  unique suggested paths; creationPlan.arguments.path must equal suggestedPath.
  Test 100-character-prefix candidate labels and 80-character rebalance labels.
  Run npm test -- src/moc-candidate-snapshot.test.ts
  src/moc-rebalance-coherence.test.ts --maxWorkers=1 and record RED.
- [ ] Add src/proposal-paths.test.ts, then src/proposal-paths.ts exporting
  allocateProposalPaths(items:Array<{path:string;identity:string}>):string[].
  Normalize slashes; count lowercased physical paths; reserve all input names.
  Sort collisions by identity/path using lexical comparison; append
  SHA256(identity).slice(0,12), then counters if already reserved. Return paths
  in original order. Tests cover reordered inputs, unique names unchanged,
  case-insensitive collisions and natural suffix-shaped destination conflicts.
- [ ] Import helper in src/llm-wiki.ts. Compute all candidate target paths before
  slice(boundedLimit), all branch targets before slice(boundedBranches). Identity
  includes full scope, basis kind/value (and root for rebalance). Carry chosen
  path into existing generation loops; add pathDisambiguated only on changes.
- [ ] Extend fixture tests: output-limit stability, visible/hidden existing
  disambiguated target, cross-scope separation, preview creates no files.
  Verify selected path matches draft context and notes.write arguments.
- [ ] Document advisory path suffixes in README.md, _wiki/SCHEMA.md and tool
  guidance. Run focused suites, npm run build, npm test -- --maxWorkers=1 and
  git diff --check; review implementation independently before publication.
- [ ] Explicit stage/commit source, tests, docs and generated dist; push only
  origin main and verify HEAD, origin/main and remote refs/heads/main.

## Evidence

Pending execution; no completion claimed.
