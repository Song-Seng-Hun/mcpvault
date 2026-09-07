# Orphan review freshness implementation plan

**Goal:** Do not return an orphan repair invalidated by an observed incoming link.

**Architecture:** After final revision guards, gather physical paths of returned
priorities whose reasons include `orphan_note`. One existing `findOrphanNotes`
query uses the caller's visibility and a separate candidate-set predicate.
Compare membership, not global generation; use the existing refresh error.

**Tech stack:** TypeScript, FileSystemService/VaultGraphIndex, Vitest.

## Steps

- [x] Reproduce with real notes/graph and an incoming Wiki or Community link
  introduced during the final target hash read. Existing code: 2 fail, 17 pass.
- [x] In `src/llm-wiki.ts`, add bounded membership validation after the loop over
  `revisionGuards`. Use `priorities`, `physicalPathByPublicPath`, `canAccess`,
  `includeCandidate` and `changed`; do not restrict backlink source visibility.
- [x] Extend `src/review-action-revisions.test.ts` with persistent graph,
  secondary-priority, no-extra-query and privacy/usability regression coverage.
- [x] Run `npm test -- src/review-action-revisions.test.ts src/vault-graph.test.ts src/agent-pulse.test.ts --maxWorkers=1`: 3 files, 74 passing tests.
- [x] Run `npm run build`, `npm test -- --maxWorkers=1` and
  `git -c core.safecrlf=false diff --check`; inspect generated `dist/`.
- [x] Independent Luna Medium review: no introduced findings; reviewer closed.

## Verification evidence

Build and diff check passed. The complete single-worker suite started at
2026-09-07 14:22:28 local time and exited 0 after 393.21 seconds: 198 test files,
3,034 passing tests and two existing skips (3,036 total).

Publication follows this validated tree: commit source/tests/docs/generated
output to the existing authorized fork main, verify the remote SHA, deploy
with verified process identity and recheck native MCP. Those post-commit
results are recorded in the task result rather than a self-referential commit.

Standing user approval permits direct main implementation and fork publication;
no upstream contribution or additional client installation is authorized.
