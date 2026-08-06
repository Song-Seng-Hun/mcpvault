# MCP SDK v2 preview

> Experimental branch. Not published to npm.

This branch tracks MCPVault's migration to the MCP 2026-07-28 specification and the TypeScript SDK v2.

## Working now

- TypeScript SDK v2 package split
- Dual-era stdio server: legacy MCP and 2026-07-28
- Protocol matrix tests for both eras
- Existing MCPVault test suite and security audit

## Before release

- Let the SDK v2 patch line and client ecosystem settle
- Rebase current MCPVault feature work
- Replace the experimental HTTP session layer with the stateless v2 handler
- Verify legacy and modern HTTP clients through the MCP Inspector

Production users should continue installing `@bitbonsai/mcpvault@latest`.
