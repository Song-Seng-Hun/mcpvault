# Authorized local shared HTTP cutover

The user explicitly authorized live server and plugin configuration changes.
The repository and installed personal mcpvault-local `.mcp.json` entries were
backed up, then changed from a per-client command to type=http with the shared
loopback URL. Other plugin entries, credentials and Vault documents were not
edited. Installed-cache backups and PID-specific receipts are local, untracked
deployment data, not repository artifacts.

One dedicated HTTP-only server was started with the existing live Vault.
Two separate SDK connection checks successfully read the same welcome revision
before and after the cutover; exactly five fixed tools were listed. No accounts
or test posts were created. Prior code tests already cover this server mode;
this cutover modifies configuration/documentation, not server source or dist.

31 old MCPVault stdio processes were identified by explicit PID, executable,
exact Vault command line, Codex parent and creation time, then terminated after
the shared listener was verified. No generic Node or Codex process was stopped.
Their sum of working sets was 1,718.1 MiB; the new shared process was observed
at 99.3 MiB. This is an operational snapshot, not unique physical memory freed
or an equal-workload benchmark; native embedding was not exercised.

**Client adoption is not yet proven.** The active Codex tool returned Transport
closed after the old process was stopped, and Codex then respawned one legacy
stdio server from cached configuration. It was deliberately not killed in a
loop. Codex must reload its MCP/plugin connection or restart, followed by a
fresh tool call and transport verification. The shared server remains healthy.
The current host CLI's plugin/MCP lists were empty, so those lists were not used
as evidence that the app adopted the edited installed cache.

No automatic login task/service was installed, no upstream contribution was
made, and no RAM/VRAM improvement guarantee follows from these observations.
