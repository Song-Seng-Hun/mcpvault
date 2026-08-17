# MCP v2 Benchmarks

MCPVault already runs on the MCP 2026-07-28 specification (TypeScript SDK v2). It serves both protocol generations from a single process: each client gets an answer in whichever version it speaks. Existing setups keep working unchanged.

## Results

Three pairings, one real vault (381 notes, 84 folders, 3.2 MB), stdio, read-only. Measured 2026-08-17 on macOS, Node 26, SDK 1.30.0 vs 2.0.0. Medians in ms.

| metric | MCPVault today | v2 with today's apps | v2 with new apps |
|---|---|---|---|
| cold start (n=8) | 107.3 | 109.8 | 105.8 |
| tools/list (n=50) | 0.15 | 0.14 | 0.17 |
| get_vault_stats (n=50) | 12.13 | 11.4 | 11.66 |
| read_note (n=50) | 0.46 | 0.43 | 0.45 |
| list_directory (n=50) | 0.45 | 0.43 | 0.46 |
| search_notes (n=20) | 85.53 | 84.33 | 85.62 |

All three pairings tie within run-to-run noise. The v2 build costs existing clients nothing.

## Why move at all

- **Every client, one server.** The dual-era build detects each client's protocol during the opening exchange.
- **The maintained SDK line.** New MCP features and security patches land in the v2 packages first.
- **Richer tool definitions ahead.** The new spec supports full JSON Schema 2020-12 for tool inputs.

## HTTP possibility

The 2026-07-28 spec makes the HTTP transport stateless, so an MCP server can sit behind any ordinary load balancer. For MCPVault that means a future opt-in HTTP package built on this v2 core, while the default stays local-first stdio.

## Method

Each pairing spawns `mcpvault <vault> --read-only` over stdio. Cold start is the median of 8 full connect cycles. Per-request numbers are medians on a warm connection after one warmup call. Scripts: `benchmarks/` on the [feat/mcp-sdk-v2 branch](https://github.com/bitbonsai/mcpvault/tree/feat/mcp-sdk-v2/benchmarks).
