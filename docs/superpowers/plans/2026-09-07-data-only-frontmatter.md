# Data-only frontmatter implementation plan

> **For agentic workers:** Use executing-plans inline as authorized; request a
> bounded independent security review without running live Vault operations.

**Goal:** Prevent document-selected code engines and avoid copying full bodies.

**Architecture:** Allowlist data-language labels; project only closed headers to
gray-matter; preserve the existing result/fallback shape. Same YAML dependency.

**Tech Stack:** TypeScript, gray-matter, yaml, Vitest, Node built-ins.

- [ ] In new `src/frontmatter-projection.test.ts`, use a unique test-only global
  marker in harmless expressions, e.g. `({ probe: (globalThis[key] = true) })`.
  Invoke existing handler parse; require marker absent and original text retained.
  Also spy `Buffer.from` for a large closed-header body and require no full-input
  conversion. Run this file with `--maxWorkers=1` and observe RED.
- [ ] Modify `src/frontmatter.ts`: configure data-only safe engines; in parse
  strip one BOM only for recognized parsing, fast-return no-opener bodies;
  allow only empty/yaml/yml/json label from `matter.language`. Unknown labels
  return the existing raw fallback. Use `normalized.indexOf('\n---', 3)` to
  project a closed header; call matter(header, safeOptions); reconstruct remaining
  body with optional one CR then LF removal. Unclosed headers use full input.
- [ ] Extend differential fixtures against the old engine with safe input only;
  compare frontmatter/content/originalContent/matter, including strange delimiter
  suffixes and malformed YAML. Add read/extract/update and explicit JSON/YAML
  compatibility tests and header-only Buffer probes. Run targeted parser,
  filesystem, revision and append suites sequentially with one worker.
- [ ] Document data-only labels, fallback and actual copy limits; record benign
  reproduction/security implications accurately. Run build, isolated memory
  comparison if useful, independent review, full suite and diff check.
- [ ] Commit explicit source/dist/tests/docs and push only fork main; verify live
  remote SHA. Preserve .agents/.mcpvault and leave the overall Goal active.
