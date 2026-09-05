# Revision-pinned note continuation

**Goal:** Prevent agents from silently combining outline/line pages from different revisions, without retained server sessions or client installation.

**Architecture:** Keep the five-tool MCP surface. The existing two bounded read adapters accept an optional SHA-256 `expectedRevision`, check it after visibility against the same ParsedNote used for projection, and automatically include it in returned continuation arguments. Drift produces a bounded `revision_conflict` with a fresh-outline restart action. This rejects stale continuation; it does not lock files or retain historical bodies.

**Alternatives:** Caller-only comparison is easy to forget. Retained snapshots add privacy/lifetime/memory costs. Stateless revision comparison preserves the existing architecture and makes the safe path automatic.

**Execution:** Inline under the user's autonomous fork-only authorization; no new agents. Use executing-plans, TDD and verification-before-completion.

## Contract and files

- `src/createServer.ts`: two schemas/handlers and bounded projection formatters. Preserve authorization before revision comparison. Continuations carry `{expectedRevision: revision}`. At small budgets minify/omit redundant display metadata before reducing content. Never return a zero-progress cursor or a truncated executable path. If identifiers cannot fit, return `response_budget_too_small` plus `retryArguments` for the same request, preserving its revision.
- `src/projection-continuation.test.ts`: real temporary Markdown and public `call_endpoint` integration. No live Vault writes or test-only production hooks.
- `src/wiki-policy.ts`, `_wiki/SCHEMA.md`, `README.md`, roadmap: describe conflict/retry, optional compact metadata, no historical snapshot guarantee.
- `dist/`: generated alongside source.

## Steps

- [x] Add tests for automatic guards and unchanged multi-page reconstruction at 512 characters, both line and outline endpoints.
- [x] Add tests for real edit between pages, hidden edits, malformed guards, long paths, and pretty-printed/tiny responses. Require no hidden body or hash on rejection and executable fresh restart on visible drift.
- [x] Run `npm test -- src/projection-continuation.test.ts` and observe missing guard/progress failures.
- [x] Add schema `expectedRevision: {type: 'string', pattern: '^[a-fA-F0-9]{64}$'}` and handler comparison after the existing readable-note check. Both use the already-read `note.revision`; no second read.
- [x] Include the guard in nextAction. Fit full responses first, compact only if needed. Ensure every successful truncated page advances. Check full-final-page fit before binary truncation; do not split surrogate pairs.
- [x] Run targeted continuation, projection consistency, and server tests. Update policy/docs with the verified contract.
- [x] Run `npm run build`, full `npm test`, and `git diff --check`. Review changes and verify compiled public endpoint behavior before fork-only commit/push.

## Completion evidence

- Initial RED: 8 failures demonstrated missing guards, ignored malformed guards, zero-progress outline and unusable long-path fallback; two visibility tests already passed.
- Additional Unicode-title regression failed on a dangling high surrogate before prefix correction. Corrected the long-conflict fixture to actually exceed 512 characters; its same-request budget retry stays a conflict.
- Targeted continuation/consistency/server: 60 passed. Policy tests exposed both stale expectations and an actual 2000-character discovery regression; shortened guidance rather than increasing the test budget. Policy: 17 passed.
- Final build exited 0; full suite: 65 files, 1013 passed, 1 skipped (42.46 seconds); diff whitespace check passed.
- Compiled `dist/src/createServer.js` public MCP smoke passed: exactly five tools, a bounded guarded page, real disk edit, conflict rejection and fresh-outline restart. An initial smoke import used the wrong dist root and was corrected before verification; no production failure was inferred from that harness path error.
- Inline review kept same-snapshot authorization before conflict, stateless cursors, default response metadata, no mutating endpoint/schema, and no dependencies. JSON fitting caps candidate text by response budget rather than serializing an entire oversized body.
- Limitations remain explicit: no old-snapshot retention, no cross-request disk lock, no guard for manually unpinned reads, and no blanket consistency claim for other adapters. Long identifiers require a larger bounded request; abbreviated heading text is navigation, not complete source evidence.
