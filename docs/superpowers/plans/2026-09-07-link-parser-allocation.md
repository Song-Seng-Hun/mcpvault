# Link parser allocation implementation plan

> Use executing-plans inline and TDD; design approval already delegated.

**Goal:** Reduce parser copies and finite-query candidate work without grammar drift.
**Architecture:** Lazy line offsets, span masking and per-syntax first-K collection.
**Tech Stack:** TypeScript, existing Markdown parser, Vitest and Node/Git verifier.

- [x] Add `src/link-parser-allocation.test.ts` RED probes for `split('')`,
  whole-input `split('\n')`, and sorted candidate array size for limit=2 on
  a line containing hundreds of mixed links. Assert output first, restore spies
  in finally. Run `npm test -- src/link-parser-allocation.test.ts --maxWorkers=1`.
- [x] In `src/backlinks.ts`, applyLineMask uses
  `localMask = mask.subarray(lineOffset,lineOffset+line.length)` and bounded
  indexOf(1)/indexOf(0) runs; return line when no masked unit; otherwise join
  untouched slices plus spaces matching masked UTF-16 lengths.
- [x] Replace whole lines array with lineOffset/lineNumber and indexOf('\n');
  preserve empty final line, CRLF trimming and heading state. Early empty result
  if `!(limit > 0)`. Keep full buildMarkdownLiteralMask for multiline semantics.
- [x] Calculate `remaining=Math.ceil(limit-matches.length)` per line. Collect
  at most remaining valid wikilinks and separately remaining Markdown links;
  sort combined candidates by offset and emit until the original global limit.
- [x] Add prefix/edge fixtures and trusted baseline differential script
  `scripts/verify-link-parser-compatibility.mjs`: git-show fixed baseline dist,
  import its data URL, compare deterministic synthetic inputs and public parser
  functions with rebuilt current dist; report only counts or mismatch case IDs.
- [x] Focused parser/tag/encoded-path/graph tests, build, run verifier, independent
  review, full one-worker tests, diff check. Document limitations/results and
  explicitly stage source/dist/docs/script. Publication is recorded below.
  Leave Goal active and live server unchanged.

## Evidence

- RED at 09:21:11 local: four tests failed with expected copy/candidate evidence,
  after correct result assertions: plain and masked line character-array copies,
  full-input line split, 600 candidates sorted for output limit 2 (desired <=4).
- Focused new/parser/tag/encoded-path/graph tests: 5 files / 60 tests passed at
  09:23:29 local. New file has 16 tests. Build passed.
- `node scripts/verify-link-parser-compatibility.mjs`: 1,152 deterministic input
  combinations / 13,824 comparisons matched baseline
  `84de8c78aba7fc6663f51192815b5c063ce06746`. It checks bounded and unlimited
  Obsidian extraction, wiki-only extraction, backlinks and unresolved matches.
- Astra High read-only review (Plato): no actionable findings; full literal-mask
  semantics, monotonic line-bounded span scans and independent first-K syntax
  collection checked. Reviewer closed after completion.
- Full `npm test -- --maxWorkers=1`: 191 files passed, 2,960 tests passed,
  2 skipped (2,962 total), 368.35s, terminal exit 0; 09:25:03 local start.
- `git diff --check` passed. No live operations or RSS/latency benchmark claimed;
  candidate/copy instrumentation is not a process memory cap.

## Delivery

- Implementation `f605ad183edd57071f18aa3ee450377ed4fe4e9b` pushed only to
  `https://github.com/Song-Seng-Hun/mcpvault.git` main. Live `git ls-remote`
  matched the implementation SHA. This final receipt is documentation-only.
- Existing untracked `.agents/` and `.mcpvault/` remained untouched. No runtime
  reload, plugin configuration edit, live Vault mutation or upstream contribution.
