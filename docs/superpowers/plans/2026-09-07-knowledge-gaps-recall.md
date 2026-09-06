# Knowledge gaps recall implementation plan

> **For agentic workers:** Use executing-plans. User approved inline work on main.

**Goal:** Make knowledge gaps respect current personal recall without unbounded bodies or invented state.

**Architecture:** Keep the existing service endpoint, fresh bounded metadata iterator,
own private state overlay, limited candidates and final selected-input guards.

**Tech Stack:** TypeScript, Node, Vitest, ordinary Markdown/YAML.

- [ ] Add real-Vault regression tests in `src/knowledge-gaps-recall.test.ts`.
  Seed `Note.md` and its hashed private recall record. Assert a private-only
  prompt appears, a private 30-day interval suppresses a 1-day shared due signal,
  hidden state never appears, and source/private changes cause refresh errors.
  Run `npm test -- src/knowledge-gaps-recall.test.ts --maxWorkers=1`; verify RED.
- [ ] Repair `src/llm-wiki.ts`: replace obsolete `readPrivateRecall` with local
  fresh strict metadata reads, use `privateState?.recall_prompt ?? sharedPrompt`
  and `normalizeReviewIntervalDays(privateState?.recall_interval_days ?? sharedInterval)`;
  keep personal history separate, emit revisions, and revalidate selected inputs.
  Add long-prompt `notes.read` Property continuation and whole-envelope budgets.
- [ ] Run targeted tests and fix only reproduced problems. Check MCP adapter
  pretty-print forwarding and source schema/docs alongside service tests.
- [ ] Update `README.md`, `_wiki/SCHEMA.md`, and `src/llm-wiki-tools.ts` with the
  private overlay, current revisions, unavailable behavior and progressive prompts.
- [ ] Review the diff; run `npm run build`, `npm test -- --maxWorkers=1`, and
  `git diff --check`. Include generated `dist/` changes. Publish to fork main
  and verify local HEAD against live remote main; no upstream contribution.
