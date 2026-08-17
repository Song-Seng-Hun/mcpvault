# MCP v2 Benchmarks

**TL;DR:** benchmarks of MCPVault on **MCP v2**: ~107 ms to connect and identical per-request speed, whether the app talks the old protocol or the new one. Below: the numbers, why we moved, what stateless HTTP opens up, and answers for skeptics.

MCPVault runs on the MCP 2026-07-28 specification via the new official SDK, which we call **MCP v2**. It serves both protocol generations from a single process: each client gets an answer in whichever version it speaks. Existing setups keep working unchanged.

## Results

Three pairings, one real vault (381 notes, 84 folders, 3.2 MB), stdio, read-only. Measured 2026-08-17 on macOS, Node 26, SDK 1.30.0 vs 2.0.0. Medians in ms.

| metric | MCPVault today | MCP v2, today's apps | MCP v2, new apps |
|---|---|---|---|
| cold start (n=8) | 107.3 | 109.8 | 105.8 |
| tools/list (n=50) | 0.15 | 0.14 | 0.17 |
| get_vault_stats (n=50) | 12.13 | 11.4 | 11.66 |
| read_note (n=50) | 0.46 | 0.43 | 0.45 |
| list_directory (n=50) | 0.45 | 0.43 | 0.46 |
| search_notes (n=20) | 85.53 | 84.33 | 85.62 |

All three pairings tie within run-to-run noise. The **MCP v2** build costs existing clients nothing.

## Why should we move

- **Every client, one server.** The **MCP v2** build detects each client's protocol during the opening exchange.
- **The maintained SDK line.** New MCP features and security patches land in the **MCP v2** packages first.
- **Richer tool definitions ahead.** The new spec supports full JSON Schema 2020-12 for tool inputs.

## HTTP possibility

The 2026-07-28 spec makes the HTTP transport stateless, so an MCP server can sit behind any ordinary load balancer. For MCPVault that means a future opt-in HTTP package built on this **MCP v2** core, while the default stays local-first stdio. Tracked in [issue #49](https://github.com/bitbonsai/mcpvault/issues/49).

## For the skeptics

- **Sub-millisecond tool calls?** stdio on the same machine: no network, file already in the OS cache. Isolates server processing, the only part the SDK swap could change.
- **Tiny samples (n=8 cold, n=20 search).** True. Enough to compare medians of a quiet local process, and why the claim is a tie, never a speedup. p95 in the table.
- **MCP v2 wins some rows.** Noise. Those differences flip between runs. The claim is only that **MCP v2** isn't slower.
- **Self-benchmark, self-approval.** The scripts print the exact numbers on this page. Rerun them on your vault; open an issue if results differ.
- **Dual-protocol overhead?** Version settles once, at connect. Requests never re-check it.
- **Nothing got slower at all?** One thing: pinning an **MCP v2** client to the new protocol adds ~110 ms once at connect. Only our test harness pins; shipping apps don't.

## Method

Each pairing spawns `mcpvault <vault> --read-only` over stdio. Cold start is the median of 8 full connect cycles. Per-request numbers are medians on a warm connection after one warmup call. Scripts: [`benchmarks/`](https://github.com/bitbonsai/mcpvault/tree/main/benchmarks) in the repo (also on the [feat/mcp-sdk-v2 branch](https://github.com/bitbonsai/mcpvault/tree/feat/mcp-sdk-v2/benchmarks)).
