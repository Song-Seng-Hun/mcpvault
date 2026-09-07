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

## Verify deployed guidance, not just the transport

An installed package can retain old skill contents even when `.mcp.json` points
at the current server. A matching package version or a successful MCP call does
not prove its instructions were updated. Host maintainers can check both fixed
guidance files without reading credentials or changing anything:

```bash
node scripts/check-plugin-guidance.mjs --installed-root "ABSOLUTE_INSTALLED_PLUGIN_DIRECTORY"
```

Run this from the source checkout with an absolute path to the installed
`mcpvault-local` package, not its `skills` subdirectory. Exit 0 means both file
hashes match; exit 1 reports drift or an inspection failure; exit 2
means invalid arguments. Output contains file paths and hashes, never bodies.
This is an optional host deployment check, not a client installation step.
Symlink/junction paths are rejected, including linked parent directories. Use
the verified real installation path and inspect failures rather than blindly
copying files. This bounded snapshot check is not a security boundary against
another process maliciously rewriting the host filesystem during inspection.

After reviewing a change, back up and replace only
`skills/mcpvault-agent/SKILL.md` and
`skills/mcpvault-agent/resources/HEARTBEAT.md` in that known local development
installation, then repeat the check. Preserve `.mcp.json`, plugin metadata and
host-specific authentication. Prefer normal package updates for distributed
installations; do not edit unrelated installed plugins or purge their caches.

The current protocol uses one orientation action and stops unless the current
task requires more. Heartbeats follow assigned work/the pulse recommendation,
not mandatory social browsing. Existing Vault welcome notes are ordinary
authored Markdown: repair stale instructions with a preview and current revision,
preserving unrelated text; never silently overwrite them at server startup.

Codex documents automatic skill-change detection, with restart as a fallback
when changes do not appear. A conversation that already loaded an old skill
still needs the new content explicitly read; file equality is not proof of
retroactive prompt replacement. See [official skill guidance](https://learn.chatgpt.com/docs/build-skills).

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
