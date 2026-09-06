# Knowledge gaps recall implementation plan

> **For agentic workers:** Use executing-plans. User approved inline work on main.

**Goal:** Make knowledge gaps respect current personal recall without unbounded bodies or invented state.

**Architecture:** Keep the existing service endpoint, fresh bounded metadata iterator,
own private state overlay, limited candidates and final selected-input guards.

**Tech Stack:** TypeScript, Node, Vitest, ordinary Markdown/YAML.

- [x] Add real-Vault regression tests in `src/knowledge-gaps-recall.test.ts`.
  Seed `Note.md` and its hashed private recall record. Assert a private-only
  prompt appears, a private 30-day interval suppresses a 1-day shared due signal,
  hidden state never appears, and source/private changes cause refresh errors.
  Run `npm test -- src/knowledge-gaps-recall.test.ts --maxWorkers=1`; verify RED.
- [x] Repair `src/llm-wiki.ts`: replace obsolete `readPrivateRecall` with local
  fresh strict metadata reads, use `privateState?.recall_prompt ?? sharedPrompt`
  and `normalizeReviewIntervalDays(privateState?.recall_interval_days ?? sharedInterval)`;
  keep personal history separate, emit revisions, and revalidate selected inputs.
  Add long-prompt `notes.read` Property continuation and whole-envelope budgets.
- [x] Run targeted tests and fix only reproduced problems. Check MCP adapter
  pretty-print forwarding and source schema/docs alongside service tests.
- [x] Update `README.md`, `_wiki/SCHEMA.md`, and `src/llm-wiki-tools.ts` with the
  private overlay, current revisions, unavailable behavior and progressive prompts.
- [x] Review the diff; run `npm run build`, `npm test -- --maxWorkers=1`, and
  `git diff --check`. Include generated `dist/` changes.
- [x] Publish to fork main
  and verify local HEAD against live remote main; no upstream contribution.

## Evidence and review

- Initial 14 regression cases failed against the old implementation. The interval
  table was corrected to pass an array as a value rather than a Vitest argument
  row; the array case then reproduced Number-coercion acceptance. This projection
  rejects non-scalar interval types before using the existing range normalizer.
- 75 nearby tests passed across knowledge gaps, date integrity and recall writes.
- Added absent-to-present state, hidden source/access checks, maximum-size no-loop
  behavior, and epistemic ranking/snooze checks. These verified existing guards
  introduced in the initial patch rather than requiring additional behavior.
- Astra read-only reviewer found hidden state was incorrectly counted as unseen
  recall, displacing actionable questions. Two extended tests reproduced it;
  suppressing due calculation for unavailable state fixed both. Reviewer closed.
- Latest focused run: 62 tests in 2 files passed; build passed after correcting
  explicit undefined candidate types under exactOptionalPropertyTypes.
- Whole-suite verification passed: 182 files, 2830 passed, 1 skipped, 325.62s,
  exit 0 (`npm test -- --maxWorkers=1`). `git diff --check` passed. Source and
  generated dist are ready for fork-only publication.
- Implementation `fff3abd251f31116d810c2ea44747d47064d46e6` was pushed to
  `Song-Seng-Hun/mcpvault` main; HEAD, origin/main and live remote main matched.

## Remaining audit (not claimed fixed here)

The separate `recallQueue` still falls back from absent personal history to
shared `recall_quality` and `last_recalled_at` (current source around 4178-4180).
Its hidden-state handling also needs a matching no-invented-due check. Reproduce
those behaviors in the next increment and align reader-state semantics across
recallQueue/reviewPacket, without conflating shared question/cadence defaults
with another reader's history. No global completion is claimed by this plan.

## Host resource follow-up

Read-only process inventory after the full suite exited found 97 Node processes:
24 each for `./mcp/server.mjs`, `./server.mjs`, computer-use `launch.mjs`, and
relative `dist/server.js`, plus one Codex artifact-template-picker server.
Summed working sets were 4455 MiB (shared pages may be counted more than once;
not unique physical memory). Relative paths do not identify their working
directories or prove ownership. Many start times preceded this increment.
No processes were stopped or configurations changed. Investigate their parent
lifetimes and cleanup contracts before blaming tests or stopping a live server;
this may matter more to desktop memory than individual query optimization.
