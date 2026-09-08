# Protected notices implementation plan

> Execution: inline, with single-worker tests. The user approved host-only management with explicitly delegated authenticated accounts.

**Goal:** Protect existing welcome/guidance Markdown while making important notices discoverable and revisions reviewable through community feedback.

**Architecture:** A host-private, live-reloaded registration file is the authority for notice identity, path, priority and editors. Markdown remains the content authority and Git the history. A filesystem mutation guard rejects generic changes (including ancestor moves); only a revision/fingerprint checked notice service can write its exact target. Four dynamic endpoints reuse the five-tool surface. No new database, scheduler or notification ledger.

**Tech stack:** TypeScript, existing FileSystemService/ScopeAccessPolicy/ReferenceService, Node AsyncLocalStorage, Vitest.

## Approved design and constraints

- Register existing paths, not copies. Host configuration controls designation/delegation; note Properties cannot grant authority. Empty editor lists mean host-file management only, not first-registrant ownership.
- Provide `notice.list`, `notice.read`, `notice.preview`, `notice.revise`. Preview/apply bind content, reason, current revision, proposal reference and host policy fingerprint. Generic writes, frontmatter edits, delete and move must reject protected paths.
- Orientation points to the registered onboarding notice. Pulse can prioritise a relevant or changed notice using caller-supplied revision receipts; no automatic full-text reinjection or persistent read-tracking ledger. Notices never override user/system instructions.
- Extend `community.post` feedback with notice ID/revision as an alternative to code sourcePaths. Existing comments remain the discussion mechanism. Store adopted/deferred/rejected decisions with proposal revision in protected notice Properties; Git preserves earlier decisions. No votes-based adoption or automatic public copying of private references.
- Scope/access checks precede selection, counts and diagnostics. Outputs have a total JSON character budget and revision-pinned continuation. Direct OS edits are outside the MCP boundary, and host config errors fail closed.
- Production migration initially registers only the existing public welcome and public schema after inspecting paths, preserving contents. Other detailed policies remain progressively loaded rather than all becoming mandatory reading.

## Tasks

- [x] Add failing tests in `src/notices.test.ts`: registered read, unauthorized raw writes, ancestor movement, authorized preview/apply, stale revision/fingerprint, authority revoked, hidden notices, feedback without code path, bounded output. Existing no-config callers retain their regression coverage.
- [x] Implement `src/notices.ts` (host registry, exact-target mutation grant, bounded read/preview/revise), `src/notice-tools.ts` (four schemas), filesystem guard callback.
- [x] Wire `src/createServer.ts`, `src/endpoint-registry.ts`, `src/agent-pulse-tools.ts`, `src/social.ts`, `src/social-tools.ts`: dynamic endpoints, write capability/read-only rejection, priority routing, common feedback validation.
- [x] Document host JSON schema and actual flows in `docs/notices.md`, README and public schema; add progressive policy discovery.
- [x] Run targeted notice and neighbouring tests, `npm run build`, `npm test -- --maxWorkers=1`, `git diff --check`: final 121 targeted tests; 309 full files / 4,082 passed, 2 skipped.
- [x] Back up host launcher/config, register verified welcome/schema without rewriting body, restart shared server, verify live bounded reads and generic mutation rejection in isolated tests (no destructive live probes).

Publication constraint: commit only verified source/tests/docs/dist to user fork main
and push; no upstream PR, release or package publication. See Git history for the
publication receipt and [verification evidence](../../notices-verification.md) for
the final test and live-server results.
