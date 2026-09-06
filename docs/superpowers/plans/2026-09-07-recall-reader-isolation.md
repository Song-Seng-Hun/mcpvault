# Recall reader isolation implementation plan

> **For agentic workers:** Use executing-plans. Inline work on main is authorized.

**Goal:** Prevent another reader's history from controlling personal recall work.

**Architecture:** Select one history owner in recallQueue, while retaining the
existing prompt/cadence defaults, fresh reads and selected-input guards.

**Tech Stack:** TypeScript, Node, Vitest, Markdown/YAML.

- [x] Extend `src/recall-queue-integrity.test.ts` with real private-state fixtures.
  Seed a shared future `last_recalled_at` and failed repair history. An agent
  without state must get `never_recalled`, `unseen`, and `stateRevision: missing`.
  A hidden private record must produce zero recall tasks. Run
  `npm test -- src/recall-queue-integrity.test.ts --maxWorkers=1` and observe RED.
- [x] In `src/llm-wiki.ts`, after hidden-state rejection choose
  `const recallState = statePath ? privateState : note.frontmatter;` and use it
  for quality, repair status/path, confusion and last-recalled date. Preserve
  prompt/interval fallback and scope-checked shared contrast relations. Add the
  existing scalar-type interval guard and explicit missing-state revision.
- [x] Run focused queue/gaps/record/date tests and reviewPacket regressions;
  preserve the shared non-agent path and exact-size/recency checks.
- [x] Update README, `_wiki/SCHEMA.md`, memory policy and queue tool description
  with the distinction between shared templates and personal history.
- [x] Independent review, build, single-worker full suite and `git diff --check`.
  Commit generated dist together with source and tests.
- [x] Push fork main and verify live remote HEAD. No upstream PR or release.

## Evidence

- Added eight initial tests; seven failed against the old implementation. The
  already-resolved private repair regression was already passing and retained.
- After owner selection, 118 focused tests across four files passed. Added own
  repair/contrast preservation; 55 queue/policy tests passed. Build passed.
- Astra independent static review found no introduced actionable defect. No
  duplicate tests/builds were dispatched; reviewer closed after completion.
- Full single-worker suite passed: 182 files, 2839 passed, 1 skipped, 326.11s,
  exit 0. Build and `git diff --check` passed. No global completion claim.
- Implementation `6a73c2209833cb9b00bbc4708bdf2a8fa5fd15a1` was pushed to
  `Song-Seng-Hun/mcpvault` main. HEAD, origin/main and live remote main matched.

## Resource diagnosis refinement

The live parent process remains Codex, not an exited test runner. Existing repo
EOF/SIGTERM tests cover stdio disconnect. Plugin registration is still command
stdio, so implementing HTTP did not automatically migrate existing connections.
One scoped sample during verification: 24 Wiki stdio instances sum to 1356 MiB
working set; 24 computer-use launchers 980 MiB; 48 other plugin servers 2089 MiB;
one artifact-template picker 40 MiB. Additional verification processes were
excluded from these four groups. Working-set sums are not unique physical RAM.
Changing Wiki connection architecture alone cannot remove other plugin copies.
No process kill, configuration mutation, server restart or live Vault write.
