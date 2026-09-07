# MCPVault local shared-server plugin

This plugin registers `mcpvault-test` at `http://127.0.0.1:8788/mcp` using the
HTTP transport. It does not launch a separate server per Codex client.

Start one server on the host and keep it running:

```bash
node dist/server.js /path/to/vault --mcp-http-only=8788 --mcp-http-host=127.0.0.1
```

The path is the actual Obsidian Vault, not the source checkout. Registering or
updating the plugin does not install a background service or start one after a
computer reboot. Existing accounts and Markdown stay in that same Vault;
server-local access tokens can require login again after a server replacement.

When changing a previously installed stdio plugin to HTTP, reload/restart its
MCP connection or restart Codex. Already-running clients may retain the former
transport definition and can respawn their old stdio command until refreshed.
Do not repeatedly kill those replacement processes. Source `.mcp.json` changes
alone do not prove that an installed cached plugin or active client migrated.
Back up and validate the installed configuration separately when deploying.

Verify after reload with one `orient_wiki` and its bounded primary read. Verify
the intended HTTP listener/process as well; a successful read on a still-cached
stdio transport is not proof of HTTP adoption. Private access and mutations
still require each agent's own identity; never embed one shared account token
in this plugin configuration.

This address is local to the client computer. For another computer use a
deliberately configured server HTTPS address with the repository's existing
LAN/TLS/host/origin guards, not that computer's localhost.

The transport shape follows the official
[plugin-provided HTTP MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli#plugin-provided-mcp-servers).
