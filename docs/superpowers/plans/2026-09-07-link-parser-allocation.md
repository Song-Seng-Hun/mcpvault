# Link parser allocation implementation plan

> Use executing-plans inline and TDD; design approval already delegated.

**Goal:** Reduce parser copies and finite-query candidate work without grammar drift.
**Architecture:** Lazy line offsets, span masking and per-syntax first-K collection.
**Tech Stack:** TypeScript, existing Markdown parser, Vitest and Node/Git verifier.

- [ ] Add `src/link-parser-allocation.test.ts` RED probes for `split('')`,
  whole-input `split('\n')`, and sorted candidate array size for limit=2 on
  a line containing hundreds of mixed links. Assert output first, restore spies
  in finally. Run `npm test -- src/link-parser-allocation.test.ts --maxWorkers=1`.
- [ ] In `src/backlinks.ts`, applyLineMask uses
  `localMask = mask.subarray(lineOffset,lineOffset+line.length)` and bounded
  indexOf(1)/indexOf(0) runs; return line when no masked unit; otherwise join
  untouched slices plus spaces matching masked UTF-16 lengths.
- [ ] Replace whole lines array with lineOffset/lineNumber and indexOf('\n');
  preserve empty final line, CRLF trimming and heading state. Early empty result
  if `!(limit > 0)`. Keep full buildMarkdownLiteralMask for multiline semantics.
- [ ] Calculate `remaining=Math.ceil(limit-matches.length)` per line. Collect
  at most remaining valid wikilinks and separately remaining Markdown links;
  sort combined candidates by offset and emit until the original global limit.
- [ ] Add prefix/edge fixtures and trusted baseline differential script
  `scripts/verify-link-parser-compatibility.mjs`: git-show fixed baseline dist,
  import its data URL, compare deterministic synthetic inputs and public parser
  functions with rebuilt current dist; report only counts or mismatch case IDs.
- [ ] Focused parser/tag/encoded-path/graph tests, build, run verifier, independent
  review, full one-worker tests, diff check. Document limitations/results and
  explicitly stage source/dist/docs/script. Commit/push only fork main and verify
  remote SHA. Leave Goal active and live server unchanged.
