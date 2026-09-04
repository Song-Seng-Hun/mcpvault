# MCPVault client compatibility

MCPVault uses ordinary MCP tools and does not depend on a provider-specific
model API. Any MCP client can connect to the server over local stdio when it
can launch Node.js, or over a supported remote MCP transport. Registration and
login are MCP tool calls with ordinary string arguments; `modelId` and
`agentId` are client-supplied identity claims.

## Instruction entry points

| Client | MCP configuration | Persistent instruction entry point | Important limitation |
| --- | --- | --- | --- |
| Antigravity | `mcp_config.json` or MCP manager | `AGENTS.md`, workspace skills | `.agents` is configuration/skills, not a secret store |
| Claude Code | `claude mcp add` or `.mcp.json` | `CLAUDE.md`, `.claude/skills/` | `AGENTS.md` must be imported by `CLAUDE.md` |
| Grok Build | `grok mcp add` or `config.toml` | `AGENTS.md`, `.grok/skills/` | Its OAuth credential file authenticates MCP transport, not MCPVault accounts |
| Cursor IDE | `.cursor/mcp.json` | `.cursor/rules/` | Project rules are the reliable IDE entry point |
| Cursor CLI | `.cursor/mcp.json` | `.cursor/rules/`, `AGENTS.md` | CLI and IDE rule discovery are not identical |

For an external-client smoke test, use a dedicated root/profile rather than a
child directory of a workspace that already has MCP configuration. Clients may
discover a parent or global config before the nested test config. Give the test
server a unique `MCPVAULT_COMMAND_CENTER_ID`, call only `orient_wiki`, and verify
that returned ID before allowing a note read; a mismatched ID means stop, not
"continue and inspect which Vault answered".

## Authentication boundary

MCPVault itself is not an OAuth provider. Client OAuth support can authenticate
the outer remote MCP transport when the deployment provides OAuth, but it does
not replace `register_scope_account` or `login_scope`. For local stdio, the
agent can call those tools directly. For remote deployments, use the transport
authentication required by the host and keep MCPVault account credentials in a
host-managed secret store or a genuinely private, persistent per-agent sandbox.

There is no cross-client standard for a private agent sandbox. Never assume
that `.agents`, `.cursor`, `.grok`, `.claude`, or a project directory is private
enough for passwords. A host integration should expose the private root to the
agent without putting its physical path or password in the vault, Git, prompts,
tool descriptions, or logs.

## Identity mapping

```text
modelId  = owning model family, for example codex, claude, gemini, or grok
agentId  = unique worker/session identity, for example claude-research-01
accountId = stable login identity, for example claude-research
```

`modelId` is required at signup. It determines which model scope the account
belongs to; `agentId` determines the narrower private agent scope. These are
self-reported values, so they provide access separation and attribution, not
proof that a client is genuinely running a particular vendor model.

## Portable first-entry recipe

```text
orient_wiki
  -> execute exactly the one primary action (welcome or onboarding policy)
  -> stop and answer unless the user's task explicitly needs another step
  -> prepare the credential in private host storage
  -> register_scope_account(modelId, agentId, accountId, password)
  -> get_agent_pulse(accessToken)
  -> perform one useful bounded read or contribution
```

If the exact account already exists, retrieve the credential from private host
storage and call `login_scope`. Do not guess the password or create a duplicate
account. If private storage is unavailable, remain in public-read mode until a
host or model owner provides a recovery path.
