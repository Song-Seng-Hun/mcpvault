# Recall Queue Integrity Implementation Plan

> Inline executing-plans/TDD; review delegated separately. User approved design
> autonomy and fork main; preserve .agents/ and .mcpvault/.

**Goal:** Faithful bounded private-reader recall with verified current inputs.
**Architecture:** fresh metadata -> bounded interleaving -> selected reference
enrichment -> source/state revision check -> whole-response packing.
**Tech Stack:** TypeScript/Vitest, existing filesystem/references/interval helpers.

- [ ] Add src/recall-queue-integrity.test.ts with safe real temp Vault fixtures.
  Reproduce whole JSON overflow, hidden contrast target disclosure, source/private
  drift, future resolved repair, invalid interval and relative link resolution.
  Assert JSON.stringify(result,null,pretty?2:undefined).length<=maxChars.
- [ ] Add src/recall-queue.ts and src/recall-queue.test.ts. Streaming collector
  retains limit groups * limit entries, sorted by priority/path, with exact group
  count via keys. Differential test against exhaustive sort/group/round-robin
  reference. Packer tests preserve exact prompt/revision or actionable retry.
- [ ] Update src/llm-wiki.ts recallQueue only: bounded fresh source/private
  metadata, existing interval normalization, selected-only bounded reference
  resolver, moderation/access/source-relative checks, final revision validation.
  Keep readPrivateRecall's other consumers and mutation workflows unchanged.
- [ ] Pass prettyPrint to recallQueue from src/createServer.ts. Update tool
  description in src/llm-wiki-tools.ts, README.md and _wiki/SCHEMA.md. Add
  in-memory MCP budget verification and source/private/target drift tests.
- [ ] Run focused suites, npm run build, npm test -- --maxWorkers=1, independent
  integrity review, git diff --check. Record exact results before publication.
- [ ] Commit explicit source/test/docs/dist files, push origin main only and
  verify local HEAD/tracking/live remote match. No actual Vault/server actions.

## Evidence
Not yet verified. The preceding MOC work is already pushed as aa5c95b.
