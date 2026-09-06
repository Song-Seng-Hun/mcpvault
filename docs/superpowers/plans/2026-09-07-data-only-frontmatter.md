# Data-only frontmatter implementation plan

> **For agentic workers:** Use executing-plans inline as authorized; request a
> bounded independent security review without running live Vault operations.

**Goal:** Prevent document-selected code engines and avoid copying full bodies.

**Architecture:** Allowlist data-language labels; project only closed headers to
gray-matter; preserve the existing result/fallback shape. Same YAML dependency.

**Tech Stack:** TypeScript, gray-matter, yaml, Vitest, Node built-ins.

- [x] In new `src/frontmatter-projection.test.ts`, use a unique test-only global
  marker in harmless expressions, e.g. `({ probe: (globalThis[key] = true) })`.
  Invoke existing handler parse; require marker absent and original text retained.
  Also spy `Buffer.from` for a large closed-header body and require no full-input
  conversion. Run this file with `--maxWorkers=1` and observe RED.
- [x] Modify `src/frontmatter.ts`: configure data-only safe engines; in parse
  strip one BOM only for recognized parsing, fast-return no-opener bodies;
  allow only empty/yaml/yml/json label from `matter.language`. Unknown labels
  return the existing raw fallback. Use `normalized.indexOf('\n---', 3)` to
  project a closed header; call matter(header, safeOptions); reconstruct remaining
  body with optional one CR then LF removal. Unclosed headers use full input.
- [x] Extend differential fixtures against the old engine with safe input only;
  compare frontmatter/content/originalContent/matter, including strange delimiter
  suffixes and malformed YAML. Add read/extract/update and explicit JSON/YAML
  compatibility tests and header-only Buffer probes. Run targeted parser,
  filesystem, revision and append suites sequentially with one worker.
- [x] Document data-only labels, fallback and actual copy limits; record benign
  reproduction/security implications accurately. Run build, isolated memory
  comparison if useful, independent review, full suite and diff check.
- [x] Commit explicit source/dist/tests/docs and push only fork main; verify live
  remote SHA. Preserve .agents/.mcpvault and leave the overall Goal active.

## Verification evidence

- Initial RED: all four JavaScript/js case-alias marker assertions failed
  (marker actually set); both large-input allocation assertions also failed.
  The payload touched only a disposable test worker's global marker. This is
  evidence of an execution path, not evidence of malicious authorship or abuse.
- GREEN: 18 new tests, including 495 safe differential fixtures with strict
  equality of all four result fields. Empty unsupported headers are deliberately
  kept raw and tested separately; existing stringify final-newline behavior is
  preserved. The optional `matter` type explicitly permits the legacy empty-input
  undefined value rather than altering the result to satisfy TypeScript.
- Focused parser/revision/append verification: 4 files, 58 tests passed.
- `npm run build` passed, generated `dist/` included.
- Independent read-only Astra security review found no actionable issue; worker
  closed. No live Vault, server restart, configuration or credential operations.
- Full `npm test -- --maxWorkers=1`: 185 files passed, 2,888 tests passed,
  2 skipped (2,890 total), 327.35 seconds; terminal exit 0. `git diff --check`
  passed. No parallel build/test/benchmark processes were started.

### Opt-in synthetic memory experiment

`scripts/benchmark-frontmatter-memory.mjs` compares a fixed safe YAML header and
32 MiB ASCII body in separate sequential Node v22.23.2 processes. Both modes
verified the same returned fields; the baseline never accepts external input.

| One invocation | Legacy baseline | Header projection |
| --- | ---: | ---: |
| Parse duration | 21.58 ms | 6.30 ms |
| Maximum RSS | 153.47 MiB | 121.61 MiB |
| ArrayBuffers before / after | 0.01 / 32.01 MiB | 0.01 / 0.01 MiB |
| Heap before / after | 37.87 / 38.22 MiB | 37.87 / 38.22 MiB |

Single samples, not statistical performance claims. Maximum RSS includes startup
and fixture construction. No whole-server memory ceiling, GPU improvement,
steady-state endpoint speedup or repaired desktop-lag claim follows from this.
Already-running servers must load the new build separately; deployed protection
has not been verified and no runtime restart is implied by publication.

## Delivery

Implementation commit `cc8c98e539af1e010afa2c75052847d1bba88bd4` was pushed to
`https://github.com/Song-Seng-Hun/mcpvault.git` main. A subsequent live
`git ls-remote --heads origin main` matched local HEAD exactly. Only unrelated
untracked `.agents/` and `.mcpvault/` remained; neither was staged. This completes
this increment, not the overall active organization/resource-reduction Goal.
