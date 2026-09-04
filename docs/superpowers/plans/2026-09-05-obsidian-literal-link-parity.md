# Obsidian Literal Link Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent inline-code and escaped Obsidian link examples from becoming backlinks, graph edges, or unresolved-link findings while preserving exact real-link locators.

**Architecture:** Add a dependency-free scanner in `src/backlinks.ts` that builds a one-byte-per-UTF-16-code-unit mask for fenced blocks, closed backtick code spans, and escaped link openers. The existing extractor applies that mask to one line at a time, runs its current regular expressions on the equal-length projection, and returns link text and context from the original line. All backlink, outlink, unresolved-link, graph, MOC, impact, and Canvas consumers inherit the correction through the shared extractor.

**Tech Stack:** TypeScript, Node.js, Vitest, Obsidian Markdown/YAML, Git

---

### Task 1: Lock the literal-boundary contract with failing tests

**Files:**
- Modify: `src/backlinks.test.ts`

- [ ] **Step 1: Add inline-code and real-link adjacency coverage**

Append these tests inside the existing `describe('Obsidian link extraction', ...)` block:

```ts
  test('ignores closed inline code while preserving adjacent real links and exact locators', () => {
    const content = '## References\n`[[Fake]]` [[Real#Section]] and `[bad](Missing.md)` [real](Real.md#^proof)';

    expect(extractObsidianLinkOccurrences(content)).toEqual([
      expect.objectContaining({ target: 'Real', line: 2, heading: 'References', targetHeading: 'Section' }),
      expect.objectContaining({ target: 'Real.md', line: 2, heading: 'References', targetBlockId: 'proof' }),
    ]);
  });
```

- [ ] **Step 2: Add multi-backtick, multiline, unmatched-delimiter, and escape coverage**

```ts
  test('handles multi-backtick and multiline code spans without hiding links after unmatched runs', () => {
    const closed = [
      '``code with ` and [[Hidden]]`` [[Visible]]',
      '`multiline',
      '[[AlsoHidden]]',
      'continues` [shown](Shown.md)',
    ].join('\n');
    expect(extractObsidianLinkOccurrences(closed).map(match => ({ target: match.target, line: match.line }))).toEqual([
      { target: 'Visible', line: 1 },
      { target: 'Shown.md', line: 4 },
    ]);

    expect(extractObsidianLinkOccurrences('`unclosed [[StillVisible]]\n[also](Still.md)').map(match => match.target)).toEqual([
      'StillVisible',
      'Still.md',
    ]);
  });

  test('ignores escaped link openers but keeps links after an even backslash run', () => {
    const content = String.raw`\[[EscapedWiki]] \[escaped](Missing.md) \\[[VisibleWiki]] [visible](Visible.md)`;
    expect(extractObsidianLinkOccurrences(content).map(match => match.target)).toEqual([
      'VisibleWiki',
      'Visible.md',
    ]);
  });
```

- [ ] **Step 3: Prove backlinks and unresolved-link reads inherit the shared behavior**

```ts
  test('keeps literal examples out of backlink and unresolved projections', () => {
    const content = '`[[Target]]` [[Target]] \n\\[[EscapedMissing]] [missing](Missing.md)';
    expect(findBacklinkMatches(content, 'Target.md')).toHaveLength(1);
    expect(findUnresolvedLinkMatches(content, ['Target.md']).map(match => match.target)).toEqual(['Missing.md']);
  });
```

- [ ] **Step 4: Run the focused test and confirm the intended RED state**

Run: `npm test -- src/backlinks.test.ts`

Expected: the new tests fail because inline-code and escaped examples are still extracted; all pre-existing fence and locator tests remain green.

### Task 2: Add one shared, offset-preserving literal scanner

**Files:**
- Modify: `src/backlinks.ts`
- Test: `src/backlinks.test.ts`

- [ ] **Step 1: Add mask helpers beside the extractor**

Add a `LiteralRun` interface and helpers after `FENCE_PATTERN`:

```ts
interface LiteralRun {
  start: number;
  length: number;
}

function isEscaped(content: string, offset: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && content[index] === '\\'; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function markRange(mask: Uint8Array, start: number, end: number): void {
  mask.fill(1, start, end);
}

function buildLinkLiteralMask(content: string): Uint8Array {
  const mask = new Uint8Array(content.length);
  const backtickRuns: LiteralRun[] = [];
  let fenceChar = '';
  let fenceLength = 0;
  let lineStart = 0;

  while (lineStart <= content.length) {
    const newline = content.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    const rawLine = content.slice(lineStart, lineEnd);
    const line = rawLine.replace(/\r$/, '');
    const fence = FENCE_PATTERN.exec(line);

    if (fenceChar || fence) {
      markRange(mask, lineStart, lineEnd);
      if (fence) {
        const markers = fence[1]!;
        const trailing = fence[2]!;
        const char = markers[0]!;
        if (!fenceChar) {
          fenceChar = char;
          fenceLength = markers.length;
        } else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') {
          fenceChar = '';
          fenceLength = 0;
        }
      }
    } else {
      for (let offset = lineStart; offset < lineEnd; offset += 1) {
        if (content[offset] === '[' && isEscaped(content, offset)) mask[offset] = 1;
        if (content[offset] !== '`' || isEscaped(content, offset)) continue;
        const start = offset;
        while (offset + 1 < lineEnd && content[offset + 1] === '`') offset += 1;
        backtickRuns.push({ start, length: offset - start + 1 });
      }
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }

  const nextSameLength = new Int32Array(backtickRuns.length).fill(-1);
  const lastByLength = new Map<number, number>();
  for (let index = backtickRuns.length - 1; index >= 0; index -= 1) {
    const run = backtickRuns[index]!;
    nextSameLength[index] = lastByLength.get(run.length) ?? -1;
    lastByLength.set(run.length, index);
  }
  for (let index = 0; index < backtickRuns.length;) {
    const closer = nextSameLength[index]!;
    if (closer === -1) {
      index += 1;
      continue;
    }
    const opening = backtickRuns[index]!;
    const closing = backtickRuns[closer]!;
    markRange(mask, opening.start, closing.start + closing.length);
    index = closer + 1;
  }
  return mask;
}

function applyLineMask(line: string, lineOffset: number, mask: Uint8Array): string {
  const projected = line.split('');
  for (let index = 0; index < projected.length; index += 1) {
    if (mask[lineOffset + index]) projected[index] = ' ';
  }
  return projected.join('');
}
```

- [ ] **Step 2: Route extraction and heading recognition through the equal-length projection**

At the start of `extractLinkOccurrences`, build the mask and track each original line's absolute offset. Remove the extractor's duplicate fence state. For each line, derive `searchableLine = applyLineMask(line, lineOffset, literalMask)`, use `searchableLine` for heading and link regular expressions, and use `line.slice(match.index, match.index + match[0]!.length)` plus the original `line.trim()` for returned link/context. Advance `lineOffset` by the untrimmed split line length plus one after every iteration, including a limit-triggered final iteration.

- [ ] **Step 3: Replace the stale inline-code comment with the exact supported contract**

Document that matching fenced blocks, matching inline backtick spans, and escaped link openers are ignored; unmatched delimiter runs remain ordinary text; top-level indented code is outside this scanner's stated parity.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- src/backlinks.test.ts`

Expected: all tests in `src/backlinks.test.ts` pass, including existing mixed-order, fence, anchor, backlink, and unresolved-link coverage.

- [ ] **Step 5: Commit the tested parser correction**

```bash
git add -- src/backlinks.ts src/backlinks.test.ts
git commit -m "fix: ignore literal Obsidian link examples"
```

### Task 3: Close the durable feedback loop and align documentation

**Files:**
- Modify: `_wiki/issues/codeblock-wikilink-false-positives.md`
- Modify: `_collaboration/discussions/llm-wiki-review-and-feedback.md`
- Modify: `README.md`
- Modify: `_wiki/SCHEMA.md`

- [ ] **Step 1: Resolve the Error Book entry with a separate retrospective state**

Set `status` and `issue_resolution_status` to `resolved`, set `issue_retrospective_status` to `captured`, add `resolved_by: codex`, and use one current UTC timestamp for `resolved_at` and `updated_at`. Replace the open resolution with:

```md
## Resolution

- status: resolved
- Resolved by codex: the shared extractor now ignores matching fenced blocks, matching inline backtick spans, and escaped link openers while preserving real-link offsets and locators. Regression coverage verifies backlinks and unresolved-link projections.

## Retrospective

- status: captured
Literal examples must be excluded in the shared extractor so every derived graph view inherits the same semantics. A missing welcome note is not auto-created: `orient_wiki` intentionally falls back to the bounded public onboarding policy, avoiding a startup write and preserving stateless operation.
```

- [ ] **Step 2: Resolve the originating legacy discussion without erasing history**

Set `status: resolved`, add `codex` to `participants`, update `updated_at`, and append this decision entry under `## Decision log`:

```md
- <same UTC timestamp> · codex · resolved — Matching fenced blocks, matching inline backtick code spans, and escaped link openers are now excluded by the shared link extractor; regression tests cover backlink and unresolved-link inheritance. Missing welcome content continues to use the bounded onboarding-policy fallback by design. See [[_wiki/issues/codeblock-wikilink-false-positives]].
```

- [ ] **Step 3: State literal behavior consistently in public documentation**

Update the Wiki links feature summary and the `get_backlinks`, `get_outlinks`, and `find_unresolved_links` sections in `README.md` to say that matching fenced blocks, matching inline backtick spans, and escaped link syntax are ignored. Add the same exact boundary to `_wiki/SCHEMA.md` near the Obsidian link authoring rules. Do not claim support for top-level indented code.

- [ ] **Step 4: Remove the duplicated sentence fragment in the synthesis documentation**

Change:

```md
to this endpoint to reopen the same candidate without session state.
  plan. It never merges or deletes the input notes.
```

to:

```md
to this endpoint to reopen the same candidate without session state. It never
merges or deletes the input notes.
```

- [ ] **Step 5: Check documentation and frontmatter hygiene**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Commit the documentation and workflow closure**

```bash
git add -- README.md _wiki/SCHEMA.md _wiki/issues/codeblock-wikilink-false-positives.md _collaboration/discussions/llm-wiki-review-and-feedback.md
git commit -m "docs: close literal link parsing feedback"
```

### Task 4: Verify every dependent surface and publish only to the user fork

**Files:**
- Modify by build: `dist/**`
- Verify: `src/backlinks.test.ts`
- Verify: `src/createServer.test.ts`
- Verify: `src/llm-wiki.test.ts`

- [ ] **Step 1: Run focused parser and adapter tests**

Run: `npm test -- src/backlinks.test.ts src/createServer.test.ts src/llm-wiki.test.ts`

Expected: all selected tests pass with no new skip or failure.

- [ ] **Step 2: Build committed distribution output**

Run: `npm run build`

Expected: TypeScript compilation exits zero and updates tracked `dist/` output for the source change.

- [ ] **Step 3: Run the entire regression suite**

Run: `npm test`

Expected: every non-skipped test passes; the pre-existing intentional skip count does not increase.

- [ ] **Step 4: Verify diff and repository scope**

Run: `git diff --check`

Expected: no output.

Run: `git status --short`

Expected: only intended tracked build output plus the preserved untracked `.agents/` and `.mcpvault/` directories are present.

- [ ] **Step 5: Commit generated output if the build changed it**

```bash
git add -- dist
git commit -m "build: refresh literal-aware link parser"
```

If `git status --short -- dist` is empty, do not create an empty commit.

- [ ] **Step 6: Push the verified main branch to the user's fork and prove parity**

Run: `git push origin main`

Expected: push succeeds only to `https://github.com/Song-Seng-Hun/mcpvault.git`.

Run: `git rev-parse HEAD`

Run: `git ls-remote origin refs/heads/main`

Expected: the local and remote commit hashes are identical; no pull request, release, tag, package publish, or upstream operation occurs.

## Review Corrections Applied

An independent review found additional CommonMark boundary cases after the
initial GREEN state. The delivered implementation also:

- treats an escaped backtick as unable to open a span in ordinary text but as a
  valid raw closer after a span has opened, because escapes do not operate
  inside code spans;
- prevents a multiline candidate from crossing ATX/Setext headings, block
  quotes, interrupting list starts, thematic breaks, recognized HTML block
  starts, blank lines, or fences;
- recognizes a heading on the masked projection but captures its full locator
  text from the original line;
- verifies CRLF offsets, mismatched fence markers and lengths, dynamic endpoint
  descriptions, and endpoint-level backlink/outlink/unresolved behavior; and
- states linear mask plus delimiter-metadata memory honestly instead of claiming
  that the complete scanner uses only the one-byte mask.
