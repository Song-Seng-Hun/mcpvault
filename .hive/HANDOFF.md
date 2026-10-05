# HANDOFF — llm_wiki (MCPVault fork)

Written by Claude-Window-coder-llm_wiki for ticket `llm_wiki-001` (refactor step 1: map only, no source edits).
Base commit `85403dc07`. Branch `claude/llm-wiki-refactor-phase-1-6dc1e7` (worktree of `E:\dev\llm_wiki`).

## What the project is

- `@bitbonsai/mcpvault` 0.16.0, forked to `github.com/Song-Seng-Hun/mcpvault`. It is an MCP server over an Obsidian-style Markdown vault.
- The fork grew from 6.6k src lines (upstream, 2026-08-26) to 263k (2026-09-23). The growth is mostly GPT/Codex-authored
  "LLM wiki" workflows plus community/story/roleplay/economy/enterprise features.
- Live Vault: `\\172.30.1.24\MCPVault` (NAS). Source/runtime: `E:\dev\llm_wiki`. Rules: `AGENTS.md` → `docs/agent-rules/*`.

## Layout

- Entrypoints (repo root): `server.ts` (stdio MCP and optional REST/HTTP), `global-sync-server.ts`, `enterprise-server.ts`,
  `enterprise-admin.ts`, `economy-host.ts`, `guidance-host.ts`, `public-federation-server.ts`. Bins map to `dist/*.js`.
- `src/` is flat (894 of 973 files in root). Subfolders: `evolution/ curation/ memory/ wikilink/ retrieval/ graph/`.
- Key modules: `createServer.ts` (fixed five-tool control plane, `call_endpoint` dispatch), `endpoint-registry.ts`,
  `llm-wiki.ts` (`LlmWikiService`, 15.6k lines), `filesystem.ts` (path/visibility/immutability enforcement),
  `guidance-runtime.ts` plus the generated `guidance-defaults.generated.ts` (user-facing string catalog).
- `dist/` is **committed** and must match source in the same commit (docs/agent-rules/code.md §6).
- Other dirs: `scripts/` (build/check/benchmarks/NAS verify, some Python/PowerShell), `docs/` (rules, architecture, UML),
  `website-shibumi/` (site), `plugins/`, `skills/`, `tests/`.

## Run / test

The main checkout has `node_modules`; this worktree does not. Node ≥ 22.

- `npm start` (tsx server.ts), `npm run build` (tsc → dist).
- `npm test` (vitest, all). Prefer `npm run test:changed` or `test:safe` (chunked, memory-capped). See `docs/agent-rules/validation.md`.
- `npm run guidance:check` must pass after moving or editing any user-facing string. `npm run guidance:generate` rewrites src.
- `node scripts/check-architecture-contracts.mjs` pins specific files/tests (including `src/llm-wiki.ts` and `llm-wiki.test.ts`).
- Deployment is NAS-backed. See `docs/agent-rules/deployment.md` (pushes go only to the fork; no upstream PR/publish).

## Notes for whoever continues

- **Do not touch the main checkout's 43 uncommitted files.** They are GPT work in progress and out of scope.
- The refactor map is in `.hive/refactor-map.md`. Key finding: hand-written code has ≈2–3% removable duplication or dead code.
  A large line drop needs either the generated-file format change (R1, −78k) or feature removal (a user decision).
- `guidance-build.ts` scans only `src/*.ts` (root, non-test, not `guidance-*`). Moving files into folders would silently drop
  their guidance entries. Fix that before any directory restructure.
- 5 production modules are test-only (R5). Ask before deleting; they may be unfinished features.
- Analysis scripts were throwaway (scratchpad, regex-based). TS 7 has no JS compiler API. `rolldown/parseAst` is in the
  main checkout's node_modules if an AST pass is needed later.
- Bash (Git Bash) failed to fork in this session (`0xC0000142`), so PowerShell plus node scripts were used.
