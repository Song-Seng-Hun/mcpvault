# Maintenance Rule Parity Implementation Plan

> Execute inline using TDD and independent review. User has approved design
> decisions and fork-main commits/pushes; no upstream operations.

**Goal:** Correct MOC/work maintenance decisions with shared authored rules.
**Architecture:** One organization predicate and the existing graph link parser.
**Tech Stack:** TypeScript, Obsidian Markdown, Vitest, temporary real Vaults.

- [ ] Add src/maintenance-rule-parity.test.ts with current-source matrix tests.
  Observe RED for fenced links, relative links, next_actions, malformed scalar
  text, non-project work, terminal project and exact-source inspect action.
- [ ] Add needsAuthoredNextAction in src/organization.ts:
  ```ts
  return isOpenActionableKnowledge(frontmatter)
    && String(frontmatter.lifecycle || '').trim().toLowerCase() === 'active'
    && !hasAuthoredNextAction(frontmatter) && !hasAuthoredText(frontmatter.waiting_for)
    && !['waiting', 'blocked'].includes(authoredTaskStatus(frontmatter.task_status));
  ```
  Apply to active_project_without_next_action and active_work_without_next_action
  lint branches. Replace moc regex with extractObsidianLinkOccurrences(content,1).
- [ ] In maintenanceDebt normalize kind/lifecycle with trim, use shared predicate,
  preserve project_without_next_action and add work_without_next_action. Both
  route to read_wiki_projection(path,view:full,maxChars:5000) and triage with the
  evaluated/current revision; required action hint is nextAction/nextActions/
  waitingFor. Replace MOC regex with the same bounded occurrence call.
- [ ] Verify mixed literal/real links, internal missing targets, scope/moderation
  exclusions, exact output bounds and no source edits; run relevant old tests.
- [ ] Update README/tool guidance, build, independent review, full one-worker
  npm test, git diff --check. Commit explicit source/tests/docs/dist and push
  Song-Seng-Hun/mcpvault main; verify HEAD equals origin/main.
