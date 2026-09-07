# Pulse Work Routing Implementation Plan

> **For agentic workers:** Use executing-plans for this bounded inline fix.

**Goal:** Make knowledge work reachable without publishing a blog and align work priority with the installed guide.

**Architecture:** Remove the publication gate in AgentPulseService; reorder existing branches without changing services or visibility.

**Tech Stack:** TypeScript, Vitest, Node, MCP SDK.

## Execution

- [x] In `src/agent-pulse.test.ts`, replace onboarding-search expectations with
  existing-post comment routing. Remove the self-authored blog precondition from
  due-review and maintenance fixtures. Verify repeated/recreated-server review
  for a commenter with `signals.ownPublishedPosts === 0`.
- [x] Add a mention to the existing assigned-task regression and a unit
  checkpoint/mention regression. Run `npm test -- src/agent-pulse.test.ts --maxWorkers=1`;
  expect failures selecting `search_capabilities` or the mention.
- [x] In `src/agent-pulse.ts`, delete `|| postSummary.ownPublishedPosts === 0`
  from direct-priority calculation and its search branch. Place the existing
  actionable-notification branch after checkpoint and task branches.
- [x] In `src/llm-wiki.ts`, retain graph diagnostics but filter managed Community
  paths from the `orphan_note` priority source. The first-session regression
  exposed an orphan-metadata repair instead of ordinary comment participation.
- [x] Add an internal `includeCandidate` predicate to graph orphan selection,
  forwarded by FileSystemService. Apply after incoming-link calculation and
  before paging/count/fingerprint. Review packets request bounded candidates;
  mixed 60-post and incoming-link regressions must pass.
- [x] Update README pulse guidance; rerun targeted tests and related transport,
  scope, and ideation tests. Keep notification cursors, budgets, and read-only
  semantics unchanged.
- [x] Run `npm run build`, `npm test -- --maxWorkers=1`, and
  `git -c core.safecrlf=false diff --check`. Review source plus generated dist.
- [x] Freshly verify the shared server identity before controlled deployment and
  recheck the native MCP welcome read. Record results in the design document.
- Publication evidence: the commit containing this plan and the matching remote
  `origin/main` ref are authoritative. Verify those refs rather than repeatedly
  treating an embedded pre-publication checkbox as unfinished implementation.
  Publish only the named source/test/docs/dist files to the user fork.
