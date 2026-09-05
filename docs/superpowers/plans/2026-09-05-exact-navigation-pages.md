# Exact graph navigation pages implementation plan

> Execute inline with executing-plans and TDD; no new agents or live Vault changes.

**Goal:** Navigation results must retain callable public locators and never invent clipped paths, links or headings when fitting the context budget.

**Architecture:** Extract graph response packing into `src/navigation-page.ts`. Project physical paths to public scope URIs before size admission. Preserve all identity/locator/revision strings; only descriptive context/title may shrink. Retain existing four graph endpoints and five-tool MCP surface. Opt in to indexed source revisions for public backlinks/outlinks without changing internal default responses.

**Tech stack:** TypeScript, existing graph/filesystem services, Vitest, in-memory MCP.

## Design

The existing serializer truncates every string and can return a zero-row page
pointing at the same offset. Keeping all strings unbounded violates context
limits. Choose exact locators, bounded descriptive previews, and whole-row
packing with binary prefix selection. Follow-ups advance by actually returned
rows and keep pretty printing. If one exact locator cannot fit, return a compact
same-request retry (maxChars 12000, limit 1, prettyPrint false), never skip it.
At that ceiling return an explicit error. Never echo tokens or internal paths.

Scope projection applies to row paths and top-level source/target paths before
packing, and the continuation uses the canonical public source/target. Auth is
retained locally. Locator strings authored in links/Properties remain exact;
they are not rewritten to look like source text that was never authored.

Source revisions describe the parsed graph entry, not cross-file atomic current
truth. Ordinary graph offsets remain advisory across concurrent edits; this
batch does not introduce snapshot-pinned graph pagination or remove the existing
100000 offset ceiling. When it is reached, flag the pagination limit rather than
emit an invalid continuation. Read the source revision before editing.

## Steps

- [x] Add public long-path/link/heading and scoped-continuation tests. Add pure packing tests for oversized single entries, prefix packing, ceiling failure and offset limit. Confirm regressions before implementation.
- [x] Add the packer, adapt four dispatcher paths, and expose opt-in source revisions through graph/filesystem types. Preserve existing exact small output semantics except documented revision fields.
- [x] Update dynamic descriptions and README/schema/roadmap. Run targeted and full tests, build, whitespace checks and a compiled MCP scope/continuation fixture.
- [ ] Commit source/tests/docs/dist and push only the authorized fork main after verification.

## Verification and review evidence

- Full regression suite: 1184 passed, one skipped, 86 files (60.80 seconds).
  `npm run build` and `git diff --check` passed.
- Baseline public regressions failed on clipped long path/link/heading and
  physical scope target paths. The offset-ceiling regression independently
  returned zero rows even though a larger prefix fitted; split prefix search
  now handles both monotonic metadata regions.
- Targeted integration: 55 tests passed in four files, then the expanded
  navigation suite passed all eight tests. Build passed. Existing exact-output
  tests now verify added source revisions against actual fixture bytes.
- Compiled MCP fixture: exactly five stable tools; authenticated scope URI
  continuation callable; parsed source hash equals fixture file bytes; 1024-char
  oversized-link retry preserves its full 1500-character heading at the larger
  budget. Owned temporary fixture removed; live Vault untouched.
- Inline review (no additional agents): checked all four dispatch paths,
  projection before JSON budgeting, original-argument retry without token echo,
  opt-in internal revision compatibility, exact source locators, and explicit
  offset ceiling. No mutation, permission, or snapshot-atomicity semantics added.
