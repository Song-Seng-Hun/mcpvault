# Maintenance Snooze Attention Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent deliberately snoozed maintenance defects from repeatedly owning the bounded review packet while keeping them visible in explicit health reports.

**Architecture:** Add one exact-path, visibility-filtered metadata batch read to the existing disposable Vault index and expose it through `FileSystemService`. Filter the already coalesced review priorities through that metadata before selecting a revision-safe curation plan, with a hard scan cap and honest snooze/truncation metadata.

**Tech Stack:** TypeScript, Node.js, Vitest, Obsidian Markdown/YAML Properties, existing Vault metadata index and dynamic MCP endpoint adapters.

---

## File structure

- `src/vault-index.ts`: exact-path metadata lookup over the current disposable index.
- `src/filesystem.ts`: narrow visibility-aware metadata adapter with a filesystem fallback.
- `src/llm-wiki.ts`: bounded snooze filtering and review-packet response contract.
- `src/llm-wiki.test.ts`: end-to-end routing, explicit-report visibility, expiry, scope, and output bounds.
- `README.md`, `_wiki/SCHEMA.md`: progressive user-facing semantics.
- `dist/`: generated build output.

### Task 1: Prove the starvation defect

**Files:**
- Modify: `src/llm-wiki.test.ts`

- [ ] **Step 1: Write the failing routing test**

Create two visible notes with deterministic actionable defects. Set the first
note's `review_snoozed_until` to `2099-01-01`, request a one-item review packet,
and assert that the second note owns `curationPlan`, the first remains in the
explicit graph report, and the packet reports one skipped priority plus the
next reappearance date.

- [ ] **Step 2: Run test to verify RED**

```bash
npm test -- src/llm-wiki.test.ts -t "review packet skips future-snoozed priorities"
```

Expected: the current packet selects or returns the snoozed note and has no
`snoozedPriorities` contract.

### Task 2: Add bounded exact-path metadata lookup

**Files:**
- Modify: `src/vault-index.ts`
- Modify: `src/filesystem.ts`

- [ ] **Step 1: Add `VaultMetadataIndex.getMany`**

Normalize and deduplicate at most 500 requested paths, call `ensureFresh`, and
return only note entries that pass `PathFilter` and `canAccessPath`. Preserve
request order and return defensive frontmatter objects.

- [ ] **Step 2: Add `FileSystemService.readNoteMetadata`**

Delegate to the index when present. In the fallback, normalize each bounded
path, apply access checks, parse only the required files, and return
`QueryNote[]` without body content. Missing or concurrently deleted files are
omitted.

- [ ] **Step 3: Run TypeScript build**

```bash
npm run build
```

Expected: the new API compiles without changing public MCP tools.

### Task 3: Filter review attention without hiding defects

**Files:**
- Modify: `src/llm-wiki.ts`
- Modify: `src/llm-wiki.test.ts`

- [ ] **Step 1: Implement bounded candidate filtering**

Sort coalesced priorities as before, inspect no more than
`min(500, max(limit * 8, 32))` candidates, batch-read their metadata, and skip
valid future snoozes. Collect at most `limit` actionable items, count only
visible skipped candidates, compute the earliest future date, and set
`priorityScanTruncated` if sorted candidates remain outside the scan.

- [ ] **Step 2: Preserve revision-safe selection**

Build `curationPlan` only from the first unsnoozed returned priority. Keep the
existing current-body reread and `expectedRevision` behavior unchanged.

- [ ] **Step 3: Add edge and security assertions**

Cover all-visible-candidates-snoozed, expired snooze, hidden model-scope note,
and a small `maxChars` response. Assert hidden notes do not alter public snooze
counts/dates and explicit health output still reports visible snoozed defects.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
npm test -- src/llm-wiki.test.ts -t "snoozed priorities"
```

Expected: all matching tests pass.

### Task 4: Document and verify the complete contract

**Files:**
- Modify: `README.md`
- Modify: `_wiki/SCHEMA.md`
- Regenerate: `dist/`

- [ ] **Step 1: Add concise progressive guidance**

Document that snooze suppresses only bounded action routing, never health or
exception evidence, and describe `snoozedPriorities`,
`nextSnoozedReviewAt`, and `priorityScanTruncated`.

- [ ] **Step 2: Run complete verification**

```bash
npm test -- src/llm-wiki.test.ts -t "snoozed priorities"
npm run build
npm test
git diff --check
```

Expected: build succeeds, all tests pass with only the existing intentional
skip, and no whitespace errors are reported.

- [ ] **Step 3: Commit and push the fork only**

Stage tracked source, tests, docs, and generated `dist/` only. Exclude
`.agents/` and `.mcpvault/`. Commit with:

```bash
git commit -m "fix: prevent snoozed maintenance starvation"
git push origin main
```

Verify local and `origin/main` resolve to the same commit. Do not create a PR,
release, tag, package publication, or upstream contribution.
