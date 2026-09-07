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

**Initial cutover: client adoption was not yet proven.** The active Codex tool returned Transport
closed after the old process was stopped, and Codex then respawned one legacy
stdio server from cached configuration. It was deliberately not killed in a
loop. Codex must reload its MCP/plugin connection or restart, followed by a
fresh tool call and transport verification. The shared server remains healthy.
The current host CLI's plugin/MCP lists were empty, so those lists were not used
as evidence that the app adopted the edited installed cache.

At that initial stage no automatic login task/service had been installed.

## Follow-up: scheduled owner and native Codex adoption verified

With the user's authorization, the host now has the Windows scheduled task
`MCPVault-SharedHTTP-8788`. It runs under the logged-in host user's interactive,
limited token, starts at that user's logon, ignores duplicate starts, and has
three one-minute restart attempts. It stores no task password and does not run
as SYSTEM. Its hidden launcher owns one HTTP-only Node process and refuses an
already occupied port rather than killing an unknown process. Local launcher,
logs and deployment receipts remain untracked under `.mcpvault/host/`.

After the user restarted Codex, the native plugin exposed all five fixed tools.
An actual `orient_wiki` call followed by its exact `notes.read` primary action
successfully read the public welcome note (2,775 content characters). This was
a native Codex MCP call, not only an independent SDK probe.

The scheduled task remained Running. The same Node PID 30852, created at
2026-09-07T11:26:53+09:00, still owned `127.0.0.1:8788` after the Codex restart;
its parent was the scheduled PowerShell launcher, not Codex. One HTTP owner
and no legacy Vault stdio processes were observed. Duplicate task-start checks
kept that same owner. No Vault documents or accounts were modified.

This verifies survival across a Codex restart. A Windows logoff/logon cycle
has not been exercised: the configured interactive task is not an always-on
service before login or after logoff. Deployment observations are snapshots,
not a permanent health guarantee. The subsequent equal-workload lexical
memory/latency comparison is recorded in `2026-09-07-shared-http-benchmark-design.md`;
native embedding/GPU tests remain pending. No upstream contribution was made
and no RAM/VRAM improvement guarantee follows from these cutover observations.
