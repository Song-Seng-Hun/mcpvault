# Maintenance Rule Parity Implementation Plan

> Execute inline using TDD and independent review. User has approved design
> decisions and fork-main commits/pushes; no upstream operations.

**Goal:** Correct MOC/work maintenance decisions with shared authored rules.
**Architecture:** One organization predicate and the existing graph link parser.
**Tech Stack:** TypeScript, Obsidian Markdown, Vitest, temporary real Vaults.

- [x] Add src/maintenance-rule-parity.test.ts with current-source matrix tests.
  Observe RED for fenced links, relative links, next_actions, malformed scalar
  text, non-project work, terminal project and exact-source inspect action.
- [x] Add needsAuthoredNextAction in src/organization.ts:
  ```ts
  return isOpenActionableKnowledge(frontmatter)
    && String(frontmatter.lifecycle || '').trim().toLowerCase() === 'active'
    && !hasAuthoredNextAction(frontmatter) && !hasAuthoredText(frontmatter.waiting_for)
    && !['waiting', 'blocked'].includes(authoredTaskStatus(frontmatter.task_status));
  ```
  Apply to active_project_without_next_action and active_work_without_next_action
  lint branches. Replace moc regex with extractObsidianLinkOccurrences(content,1).
- [x] In maintenanceDebt normalize kind/lifecycle with trim, use shared predicate,
  preserve project_without_next_action and add work_without_next_action. Both
  route to read_wiki_projection(path,view:full,maxChars:5000) and triage with the
  evaluated/current revision; required action hint is nextAction/nextActions/
  waitingFor. Replace MOC regex with the same bounded occurrence call.
- [x] Verify mixed literal/real links, internal missing targets, scope/moderation
  exclusions, exact output bounds and no source edits; run relevant old tests.
- [x] Update README/tool guidance, build, independent review, full one-worker
  npm test, git diff --check.
- [x] Commit explicit source/tests/docs/dist and push
  Song-Seng-Hun/mcpvault main; verify HEAD equals origin/main.

## Evidence

- RED demonstrated scalar/list/text/terminal/nonproject/inspect inconsistencies.
  The first MOC lint fixture lacked llm_wiki_type=knowledge and did not reach
  that lint gate; corrected before implementation. Corrected MOC-only baseline:
  8 failed / 6 passed, covering fences, inline/escaped literals, anchor-only
  links and relative Markdown. No source changes preceded these tests.
- Initial GREEN:64 tests. Added normalized states and private/hidden cases;
  new file now68 cases. Broader five-file suite:164 passed, including prior
  work-text, organization, backlinks and streaming tests. Build/diff check pass.
- Actual in-memory MCP test follows returned curationPlan.inspect to the exact
  question source within5000 chars, retains five fixed tools, and verifies the
  original Markdown was not modified. Existing streaming tests cover revision
  races and hidden aggregate cleanup.
- Review found nextAction missing from wiki.triage's published schema. Actual
  search_capabilities test reproduced an undefined property, then adding the
  existing scalar-action schema fixed it. Full suite was explicitly interrupted
  before this change; its partial run is not a verification result. Rebuilt and
  started a fresh full one-worker run. Three additional real-service repairs
  cover scalar/list/waiting alternatives, body preservation and stale-revision
  rejection; the new test file now71 passes. Delta review found no remaining
  actionable issue and reviewer was closed. Final fresh full one-worker suite:
  2,596 passed, one skipped, 171 files, 330.12 seconds, exit zero. Build and
  whitespace checks passed.
- Design a73f0df and implementation c45c80c were pushed to the user fork main;
  verified local HEAD equals origin/main. No upstream contribution or live
  Vault changes. Unrelated .agents/.mcpvault remain untracked.
