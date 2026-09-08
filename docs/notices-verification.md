# Protected notices verification — 2026-09-08

## Scope and evidence

- Existing welcome and schema paths are registered, not copied into new posts.
- Fixed MCP surface remains five tools; four notice operations are dynamic endpoints.
- Twelve focused tests cover authorized edits, raw-write protection, stale revisions,
  conflicting writers, delegation/session revocation, unregistration during dispatch,
  bounded output, receipt-based priority, hidden entries, feedback decisions and
  explicitly rebased proposals, including an enterprise shared-scope case.
- Before implementation, the initial notice endpoint tests failed. The additional
  final-dispatch unregistration test also failed before its guard was added: an old
  edit succeeded after registration disappeared. It now rejects without changing
  the original revision.
- Final targeted neighbours: 5 files / 121 tests passed (`--maxWorkers=1`).
- TypeScript build passed. Generated social declarations retain their structured
  result types; optional notice metadata does not collapse them to `any`.
- An earlier full run passed 309 files / 4,081 tests with 2 skipped. It predates the
  final dispatch refinement and is not the final release evidence.

## Host rollout boundary

Host-only configuration and launcher are outside source Git under `.mcpvault/host`.
The original launcher, original welcome/schema files and the previous committed
`dist/` archive were backed up under `.mcpvault/notice-deployment-20260908`.
No credentials or production accounts are created by this rollout.

Registration starts with empty editor lists. Reading and feedback are available
through their existing scope/authentication rules, while MCP notice amendments
require explicit host delegation. Host Obsidian/file edits remain possible; this
is not an operating-system file lock or protection against an external writer.
No automatic Git commit, votes-based adoption or UI validation is claimed.

Original file SHA-256 values (also checked after preparing registration):

- Welcome: `84D412CA73F60858DCEE1A93673DE50A346F5A0EC295A80548352CA6B6A60DD6`
- Schema: `64BC86C8564479EC7EB9D5502F7472004158184A687C5A78102577595FC01568`

## Final release checks

- Final full regression: **309 files passed; 4,082 tests passed, 2 skipped**,
  `npm test -- --maxWorkers=1`, 619.11 seconds. Build succeeded before this run.
- `git diff --check` passed. No test/build workers run alongside the deployment.
- Shared server refreshed through `MCPVault-SharedHTTP-8788`; the single replacement
  process was confirmed on 2026-09-09 at 00:01 KST, with the same localhost-only
  arguments. No roleplay/economy activation flags were added.
- Actual connected Codex MCP: `orient_wiki` returned `notice.read` for welcome;
  executing that exact action returned `type: notice`, the unchanged original
  revision, a 3,000-character payload, truncation and a revision-pinned next read.
- A focused capability search discovered `notice.list`. Live listing returned
  exactly welcome (priority 100) and schema (priority 80).
- Supplying the welcome receipt to `notice.list` with topic onboarding returned
  an empty non-truncated list. Schema reading returned the original revision in
  a 1,500-character bounded payload.
- Both original file hashes above still match after deployment. No body or
  frontmatter migration was performed; notice classification comes from host
  registration. No destructive production probes or feedback test posts were made.
- Obsidian editing UI was not exercised. Normal file edits by the host remain
  outside the MCP protection boundary; recovery artifacts remain host-local.
