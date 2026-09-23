---
id: secure-mcp-tunnel-operations
kind: operations-guide
description: Start and diagnose the existing Windows OpenAI MCP tunnel without exposing its key.
keywords: [OpenAI, MCP, tunnel-client, PowerShell, DPAPI, Antigravity, Codex]
use_when: An OpenAI MCP tunnel appears disconnected or another client cannot find it.
position: Tunnel transport operations; distinct from local MCP registration.
---
# OpenAI Secure MCP Tunnel: Windows runbook

Use this for OpenAI `tunnel-client`, not Tailscale or local MCP stdio. It makes
outbound HTTPS connections and forwards supported product requests to the
configured local MCP target; the target needs no inbound port.

## Integrated deployment target (2026-09-23)

The Windows host should run **one** MCPVault process against the live Vault,
with the complete host feature configuration, reviewed-skill source access,
and the Auth0 research-account adapter on the same loopback MCP listener.
The tunnel forwards to that listener. The former `MCPVault Research` and
no-auth `llm_wiki` entries in ChatGPT were app registrations, not separate
Vaults or required server instances. A no-auth registration cannot use an
OAuth-only tunnel unchanged. Keep one OAuth app registration named `llm_wiki`
and retire the obsolete no-auth registration. Do not create a
second research-only server or broaden the research account's capability
ceiling to compensate for a client problem.

The 2026-09-23 cutover reached that target: ChatGPT's OAuth app was renamed
`llm_wiki`, and the old no-auth app was deleted with owner approval. The live
Windows process exposes the complete feature set and OAuth on one loopback
listener. Authenticated `skill.resolve`, procedure search, `get_agent_pulse`
and the pulse's next note read were verified through the connector; a fresh
web ChatGPT conversation also called `orient_wiki` and `get_agent_pulse`
successfully. An existing Mac Codex task still resolved the removed no-auth
registration under its cached `llm_wiki` tool name and returned `Unknown tool`.
A fresh Mac task called `llm_wiki.orient_wiki` and `get_agent_pulse` successfully
as `research-agent`; old task tool names must not be treated as a live app
inventory. The research capability ceiling intentionally excludes task/work
ownership.

For a restart, stop the scheduled task and confirm whether its child Node
process is still running. Do not start a second writer over the same Vault.
If the process cannot exit gracefully, obtain explicit approval before any
forceful termination. Inspect both writer locks, checkpoints and journal/turn
counts; only the built-in fingerprint-guarded, audited stale-lock recovery may
clear confirmed dead-process locks. Never reset canonical economy or roleplay
data, and do not put the account database or Auth0 configuration in Git/NAS.

## Start with the saved DPAPI helper

In the user's normal Windows PowerShell session, load the profile that defines
`mcpvault`. This host stores that helper under the OneDrive WindowsPowerShell
profile; `$PROFILE` may point elsewhere. If the helper is already loaded, skip
the dot-source step.

```powershell
$p = Join-Path $env:OneDrive '문서\WindowsPowerShell\Microsoft.PowerShell_profile.ps1'
. $p
Get-Command mcpvault
mcpvault doctor
mcpvault run
```

`doctor` validates the profile, DPAPI key, and MCP target. `run` keeps the
tunnel alive; leave it running while testing. The helper decrypts the key for
the child and clears its environment variable on exit. Never print, copy, log,
or commit the key/blob. Do not recreate credentials or add persistent access
settings to fix a missing key.

## Verify transport, then verify the client separately

Check `http://127.0.0.1:8080/healthz`, `/readyz`, or `/ui`; health proves
transport readiness only. Check the target app's MCP/connector list and make a
harmless read. Codex's optional tunnel plugin may be absent; install only when
requested. Antigravity may need its own MCP registration and restart. Local
stdio registration and tunnel connection are separate.

Before use, inspect `doctor`'s target command, data scope, and write mode. A
tunnel is not read-only. Last check found no `--read-only` flag in this host's
target; recheck the command and server policy before claiming read-only access.

If the key is missing, load the intended profile helper in this PowerShell
session. If healthy but undiscoverable, check workspace/organization linkage
and client MCP registration. See the [official guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## Historical research-writer OAuth cutover (Windows host only)

The Platform Tunnels table identifies a tunnel by `tunnel_id`, organizations,
and workspaces; it does not display a public MCP URL. Current ChatGPT setup
uses Tunnel mode and selects that ID. The tunnel-facing resource has the
documented shape `<OPENAI_MCP_TUNNEL_BASE_URL>/v1/mcp/<tunnel_id>`; do not
confuse the control-plane base URL with a separately configured MCP base host.
The first Auth0 API Identifier was selected from that documented shape and
the observed control-plane base URL; the diagnostic checkpoint below shows
that this was not the connector-facing MCP host. Confirm the exact resource
through connector discovery before any further live cutover. Never paste the
local loopback URL into ChatGPT as a public server URL.

The initial pilot used a second, loopback-only MCPVault transport. The
integrated deployment above replaces that pilot; do not leave both writers
active against one Vault. Launch the integrated listener with `--mcp-http`,
`--account-store` and `--auth0-config` pointing to owner-private Windows files
outside both NAS and checkout. The Auth0 config
pins one issuer, one resource audience, one exact subject, one approved agent
account, `mcpvault:research` and a short allowlist of self-reported agent
labels. Labels distinguish activity in audit records; they are not separate
security principals. Keep DCR and broad client grants off. Configure only the
approved OAuth client and API scope in Auth0; no NAS credential, key, or
certificate is needed.

Preserve the live stdio profile and account-store rollback copy. First test a
separate HTTP listener and isolated tunnel/profile. The local server must
answer both `/.well-known/oauth-protected-resource` and the path-specific
`/.well-known/oauth-protected-resource/mcp`; unauthenticated MCP calls must
receive 401 with a metadata challenge. Validate issuer, audience, subject,
scope, expiry, forbidden credential/identity calls, and one authorized write
plus reread before switching the existing tunnel. A ready tunnel or successful
public read alone does not prove write access. If OAuth fails, restore the
previous profile; do not fall back to anonymous writing or disable validation.

## OAuth connector diagnostic checkpoint (2026-09-23)

The first ChatGPT `MCPVault Research` connector was **not created**. Its create
dialog rejected the configuration with `OAuth authorization server metadata must
advertise PKCE support with code_challenge_methods_supported containing S256`.
The public Auth0 authorization-server metadata, fetched independently from the
Windows host at both slash variants of the well-known URL, returned HTTP 200
and included `code_challenge_methods_supported: ["S256", "plain"]`. This rules
out simply enabling PKCE in Auth0 as a cause-specific fix.

The first connector attempt also exposed a separate tunnel transport problem:
Harpoon could not register the loopback HTTP protected-resource metadata target
and the connector's internal Harpoon channel was unsupported. A one-process
test with the official `HARPOON_ALLOW_PLAINTEXT_HTTP=true` flag registered only
the exact `127.0.0.1` PRMD source URL; the connector's Harpoon GET then returned
HTTP 200. The same PKCE error still occurred. Do not repeat either attempt
without new evidence. Do not enable raw HTTP/payload logging or relax token
verification to troubleshoot it.

The Auth0 API audience was initially chosen using the documented tunnel URL
shape and the observed **control-plane** host. OpenAI's tunnel documentation
distinguishes that host from the separately supplied MCP tunnel base URL; the
Platform tunnel table currently shows only the tunnel ID, not that base URL.
The ChatGPT Create Plugin dialog subsequently exposed the actual endpoint in
its OAuth-discovery error: its connector-facing host differs from the
control-plane `api.openai.com` host. The first audience therefore did not match
the endpoint ChatGPT currently uses. Whether that internal host is a stable external OAuth
resource identifier remains to be confirmed. Auth0 API Identifiers are
immutable. On 2026-09-23 the owner approved a second, corrected Auth0 custom
API using the connector-displayed host. It has only `mcpvault:research`,
user-delegated per-app access for `MCPVault ChatGPT Research`, and no
machine-to-machine access. The Windows-private `auth0.json` resource and the
unsubmitted ChatGPT connector draft were updated to the same identifier. Do
not infer future tunnel resource identifiers from the control-plane URL or
assume the internal host is stable.

A subsequent HTTP cutover failed before connector creation: the loopback MCP
server returned 200 for both protected-resource metadata endpoints and 401
for unauthenticated `/mcp`, but tunnel-client v0.0.13 returned `/readyz` 503
with an OAuth discovery deadline. One restart after the loopback server was
ready reproduced the failure. The exact pre-Auth0 stdio profile was restored
from its saved backup and `/readyz` returned 200. The experimental listener
was stopped. The private account directory ACL was also corrected to remove
two unexpected sandbox Modify grants; host-side ACL validation then passed.
Do not weaken ACL or bearer validation to make this tunnel ready.

Differential check: the same HTTP tunnel profile reached `readyz` 200 with
the vendor's loopback `dev mcp-stub` on port 8789, while the MCPVault OAuth
listener produced the repeated 503. This narrows the failure to the MCPVault
response/discovery interaction; it does not prove which side violates the
contract. The stub was stopped and the original stdio profile restored and
verified `readyz` 200. No Vault data was served by the stub.

After the failed connector test, the active tunnel was restored to the exact
saved stdio profile; its local `/readyz` returned HTTP 200 and the Mac client
successfully performed an anonymous read. The experimental loopback research
server was stopped. No research write or greeting post has been verified.

The later cause-specific fix was limited to tunnel-client's local discovery
probe. Version 0.0.13 first sends an empty `POST /mcp` with
`Accept: application/json` and its own user-agent, then follows the
`resource_metadata` URL in the 401 challenge. The normal public resource URL
was unreachable from the Windows tunnel process during this local probe.
Only for that exact probe, the listener now returns the loopback metadata URL
in the challenge; ordinary clients still receive the configured public
resource URL, and all unauthenticated calls remain 401. A regression test and
build passed. With the loopback research server and HTTP tunnel profile
restarted, `/readyz` returned HTTP 200. This proves discovery readiness only;
the OAuth connector, account login, and authorized write remain unverified.
During this test the old anonymous-reader tunnel connection is temporarily
unavailable, as approved by the owner. Restore the saved stdio profile if the
OAuth connector test cannot proceed.

The tunnel became ready, but ChatGPT connector creation still returned the
same PKCE/S256 error before login. An independently fetched authorization
server and OIDC metadata document both returned HTTP 200 with S256. More
importantly, the tunnel-client OAuth admin timeline showed its authorization
server metadata request as HTTP 200 and displayed S256 in the received body.
Clearing only the optional authorization-server-base override in the ChatGPT
draft did not change the error; the original value was restored. An isolated
test allowing only the approved IdP host in Harpoon's auto-registration filter
also did not register that public host, while the metadata fetch remained
successful. Do not infer that Auth0 lacks PKCE or disable PKCE to work around
this error. The failing handoff is after local/tunnel metadata retrieval; the
exact ChatGPT-side validation or relay failure is not yet identified.

The exact saved anonymous-reader stdio profile was restored again and local
`/readyz` returned HTTP 200 `ready`. The research listener and private Auth0
configuration remain intact, but no ChatGPT research connection, authorized
write, or Mac greeting post has been verified. The Mac Codex CLI help exposes
MCP URL/stdio registration and OAuth login for a named server, but no direct
`tunnel_id` registration option; do not assume it can bypass this connector
creation failure.

The Mac Codex task initially received a generic error from a direct
`notes.read` invocation. That name is an internal endpoint, not one of the
five exposed MCP tools. After locating the fixed tool registry, the Mac task
successfully called `orient_wiki` once and then its exact public `Welcome.md`
primary action through `call_endpoint`. This verifies the restored public
read path from Mac, but not authentication or writing.

### Fresh connector discovery resolved the PKCE creation error

With the OAuth HTTP target already ready, discard the unsubmitted connector
draft and open a fresh Create MCP App dialog. Select the tunnel, open Advanced
OAuth settings, and wait for automatic discovery before choosing the existing
pre-registered OAuth client. Do not repopulate all endpoint fields manually.
The fresh dialog discovered Auth0's registration and OIDC metadata that were
absent in the old draft. With the same approved client and research scope,
connector creation then succeeded and displayed the account-login screen.
This points to stale/incomplete discovery state in the previous draft; it does
not identify the internal product bug. Creation alone is not login or write
verification. Complete OAuth, then have the Mac agent write and reread one
authorized contribution before declaring the writer operational.

### OAuth connected but discovery returned 503

After successful OAuth login and consent, the connector initially showed no
tools. Structured tunnel logs identified `server/discover`, target HTTP 503,
and `malformed_json` (the target's plain-text failure was not a JSON-RPC
response). The private account directory had acquired an additional sandbox
group read grant. The account-store validator deliberately rejects any Allow
ACE beyond the host owner, SYSTEM and Administrators, including read-only
grants. Removing only that unexpected grant with host-side ACL administration
restored the existing protection; no token or ACL validation was weakened.
The deployed `assertPrivateAccountStore` check then passed, and a single
connector refresh populated all five MCP tools. No server restart was needed.

Keep all private-store maintenance and validation in the trusted host context.
Sandbox access provisioning can add grants and make this fail-closed store
unavailable again. Do not open or inspect its contents from sandboxed tools;
diagnostics should report permission-check results without credentials or
account database contents. Tool discovery success still does not establish a
Mac-side authenticated write: verify the client registry and write/read round
trip separately.

The grant recurred after subsequent sandbox commands, so removal from the old
directory was not a durable repair. The active account database and Auth0
configuration were copied byte-for-byte to a new owner/SYSTEM/Administrators-only
Windows service directory outside the previously provisioned sandbox paths.
The loopback server was restarted with only those host-file arguments changed.
The deployed ACL validator passed both before and after another ordinary
sandbox command, and a real connector `orient_wiki` then reported the approved
authenticated research account. Old account/configuration files were moved,
not deleted, into a protected rollback subdirectory; inherited old ACLs were
reset to that protected parent's ACL and verified. Do not reuse launch commands
that still point to the previous credential directory. When restoring the old
transport profile, preserve the rollback artifact and use the current private
account-store path in the restored launcher.

Client refresh also matters: the newly created research tools appeared in a
fresh Mac task and in the refreshed Windows task without another plugin or
OAuth client. A separate Mac host approval gate rejected delegated writing
instructions and requested direct user authorization in that Mac task. That
rejection is not a server authentication error and must not be bypassed.

### Research authorization must not require a development-agent handoff

After direct user authorization, the Mac task successfully verified the mapped
research identity. Community endpoints were still locked because production
enabled only wiki-core, and the OAuth adapter did not supply the approved
research scope to the existing activity gate. The all-consent test fixture had
hidden this production omission.

The research listener now selects only wiki-core and collaboration (see
`docs/examples/research-writer-features.json`). The adapter translates a verified
research OAuth scope into request-local collaboration authority for Posts and
Comments, bounded by JWT expiry, the mapped account's capability ceiling and
document permissions. No extra owner-consent file is needed. This is the normal
account authorization path, not a promise that arbitrary features or models are
trusted. Explicit additional host policies still restrict access when configured.
An arbitrary label, unverified receipt, legacy token or expired request cannot
create this authority. Authority ends when the response completes.

Focused real-server HTTP tests cover comment creation and reread by a fresh
client without a separate consent file, plus retained denial boundaries. Live
Windows connector discovery reports `community.comment` ready. Mac authenticated
reads also succeeded, and its single greeting attempt passed authorization but
failed community validation: the existing introduction note has
`mcpvault_type: community_post` and `post_slug`, while the service requires
`mcpvault_type: blog_post`, `post_id` and `status: published` for comments.
The repository contains no supported legacy `community_post` schema; do not
weaken the service validation or silently rewrite source data to hide this.
No comment identifier was returned and no comment was created. A one-note,
revision-guarded metadata repair with the original body/author and a backup
preserved requires the owner's data-repair approval. Then retry the same approved
greeting intent and verify the returned comment identifier. Authentication and
ordinary research authorization do not require another login or consent file.
