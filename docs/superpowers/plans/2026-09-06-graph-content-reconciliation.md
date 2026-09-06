# Graph content reconciliation

## Problem and evidence

The existing graph stat shortcut could retain stale links, aliases, tags and
moderation indefinitely when missed watcher events coincided with identical
size, mtime and ctime. Tests rewrite real files while pinning only observed
stat fields. Five initial regressions failed before the fix: incoming links
(standalone/shared catalog), moderation hiding, unchanged audit execution,
and failure/retry behavior. Ordinary warm-read reuse already passed.

## Implemented boundary

- Add an independent 15-minute query-triggered full content audit.
- Hash bounded source reads; reuse parsed fields when the hash matches.
- Preserve normal stat and dirty fast paths, staged generation-checked
  publication, batch draining and concurrent refresh coalescing.
- Only successful full content verification advances the audit deadline.
- Keep Markdown authoritative and existing caller visibility checks intact.
- No client installation, new MCP tool, background process or live Vault edit.

The audit reads every eligible source in batches of 16, at most 8 MiB per
source. The initiating query pays total I/O/latency. This is not a total memory
or latency bound, OS-atomic snapshot, or guarantee for other read models.
Fifteen minutes is a default, not a benchmark-derived optimum. A rolling audit
would require separate cursor/churn/failure state and is not implemented here.

## Verification

Targeted graph suites: 30 tests passed, including 16 new content-audit tests.
Coverage includes watcher/no-watcher and standalone/shared catalog paths,
real same-stat edits, aliases/orphans, moderation, scope filtering, ordinary
reuse, independent deadlines under repeated full/dirty refreshes, concurrent
callers, generation changes, read failure retry, oversized sources, and
40-source batching without reparsing unchanged Markdown.

Read-only independent review found no actionable issues in deadline tracking,
failure/generation handling, immutable parsed-entry reuse or batch draining.
Final verification: `npm run build` passed; complete `npm test` passed with
1,784 tests and one skip across 133 files (80.34 seconds); `git diff --check`
passed. An isolated compiled smoke pinned observed stat metadata and suppressed
watch events while rewriting real temporary files: graph and MCP backlink
queries recovered incoming links after the audit deadline. An unchanged audit
read three sources without parsing them again. MCP still exposed exactly five
tools. This is not a test against the user's running server or live Vault.
