# Vault-backed MCP guidance Implementation Plan

> **For agentic workers:** Use executing-plans inline. One bounded AST worker
> owns scripts/guidance-source.ts and its test; the main agent owns integration.

**Goal:** Store reusable MCP prose in protected Vault Markdown and safely consume
validated local revisions, with an explicit coverage/conflict inventory.

**Architecture:** Source IDs and a generated default catalog feed a leaf
AsyncLocalStorage renderer and a host-bound Vault catalog. Notice protection and
feedback handle edits; a host sync command manages source-default upgrades.

**Tech Stack:** TypeScript AST, existing Markdown/Properties, NoticeService,
FileSystemService, existing MCP/REST dispatcher, Vitest.

## Tasks

- [x] Inventory/instrument source: `scanGuidanceSource(source,file)` and
  `instrumentGuidanceSource(source,file)` in scripts/guidance-source.ts, with
  literal/template/error/duplicate/id-stability/excluded-data tests. Keep default
  expression evaluation once: `guidanceText(id, expression)`;
  `guidanceError(new Error(expression), id)` preserves internal error semantics.
- [x] Add failing tests for src/guidance-runtime.ts and src/guidance-catalog.ts:
  `guidanceText(id, original)` returns original without a context; within an
  injected renderer it resolves only that explicit ID. Never alter arbitrary
  object bodies. Validate placeholder sets and ambiguity; reject malformed
  documents and retain original prose. Concurrent contexts stay isolated.
- [x] Implement protected collection and notice adapters. Bind ID/path and
  source revision to the compiled catalog, not user metadata. Test generic
  write/delete/move denial, delegated revision-safe edits, live revocation,
  feedback revision guards and source-conflict re-review.
- [x] Implement host source sync: missing -> create exclusively; unchanged
  baseline -> CAS update; local edit + source change -> retain and diagnose.
  Use canonical paths and refuse links. Export an index/coverage report without
  runtime arguments. Test idempotent sync, conflicts and user-file preservation.
- [x] Wire the common createServer dispatcher, selected endpoint descriptions,
  policies, startup instructions and annotated errors. Apply existing response
  budgets after rendering. Test live next-call edits and two-server isolation;
  exception messages remain unchanged for internal control flow.
- [x] Run mechanical instrumentation, review its diff, generate the catalog,
  classify remaining candidates instead of hiding omissions. No generic
  translation of body/content/text or structural enum/code fields.
- [x] Document author/editor/host flows and gradual discovery. Run targeted
  tests, `npm run build`, `npm test -- --maxWorkers=1`, `git diff --check`.
- [x] Back up and sync the production Vault, refresh the shared server, verify
  real MCP guidance and unchanged ordinary data. Record precise remaining limits
  and client-cache behavior in `docs/vault-guidance-verification.md`.

Publication constraint: verified source/tests/docs/dist go to the user's fork
main only. No upstream PR, release or package publication.
