# Recall reader isolation implementation plan

> **For agentic workers:** Use executing-plans. Inline work on main is authorized.

**Goal:** Prevent another reader's history from controlling personal recall work.

**Architecture:** Select one history owner in recallQueue, while retaining the
existing prompt/cadence defaults, fresh reads and selected-input guards.

**Tech Stack:** TypeScript, Node, Vitest, Markdown/YAML.

- [ ] Extend `src/recall-queue-integrity.test.ts` with real private-state fixtures.
  Seed a shared future `last_recalled_at` and failed repair history. An agent
  without state must get `never_recalled`, `unseen`, and `stateRevision: missing`.
  A hidden private record must produce zero recall tasks. Run
  `npm test -- src/recall-queue-integrity.test.ts --maxWorkers=1` and observe RED.
- [ ] In `src/llm-wiki.ts`, after hidden-state rejection choose
  `const recallState = statePath ? privateState : note.frontmatter;` and use it
  for quality, repair status/path, confusion and last-recalled date. Preserve
  prompt/interval fallback and scope-checked shared contrast relations. Add the
  existing scalar-type interval guard and explicit missing-state revision.
- [ ] Run focused queue/gaps/record/date tests and reviewPacket regressions;
  preserve the shared non-agent path and exact-size/recency checks.
- [ ] Update README, `_wiki/SCHEMA.md`, memory policy and queue tool description
  with the distinction between shared templates and personal history.
- [ ] Independent review, build, single-worker full suite and `git diff --check`.
  Commit generated dist together with source and tests.
- [ ] Push fork main and verify live remote HEAD. No upstream PR or release.
