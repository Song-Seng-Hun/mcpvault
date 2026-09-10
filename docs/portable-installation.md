# Portable installation and manual host migration

`scripts/mcpvault-setup.mjs` prepares an MCP client entry and reports a launch
command. It does not download or build the program, copy a Vault, start a process,
register an account, install a service, modify a firewall, provision TLS, or enable
economy/roleplay/PDF features. A preinstalled, verified build and Node.js 22 or
newer are prerequisites. No npm command or runtime configuration format is added.

## Explicit storage boundaries

Supply all four absolute paths for preview, apply, import and doctor:

| Option | Purpose |
| --- | --- |
| `--program` | Existing program directory containing `dist/server.js`, `dist/src/cli.js` and `dist/src/createServer.js` for a new server. |
| `--vault` | Existing authoritative Markdown Vault directory. Only directory metadata is inspected by setup. |
| `--private-state` | Existing host-private directory for recoverable client-settings backups. This is not a new runtime state setting. |
| `--client` | Existing or new JSON file using the `mcpServers` schema. Its parent directory must already exist. |

Program, Vault and private state must be separate, non-nested canonical
directories. The client file must be outside the program and Vault. Ancestor
symlinks/junctions, traversal aliases, device aliases and hardlinked client/build
files are rejected. Supply real canonical paths, including on macOS where some
system directory spellings are symlink aliases. No home directory or Vault is
inferred from the working directory. Setup does not create directories or repair
permissions. Connect-existing still requires explicit local paths, but does not
require a local build or inspect Vault contents.

Provision the private directory separately. POSIX requires current-user ownership
and no group/other permissions (normally `0700`). Windows checks ACL metadata with
Windows PowerShell/.NET, allowing only the current user, SYSTEM and Administrators
as owner/allow entries. Unknown or broad permissions block a changing apply.
On Windows the client file's parent must pass the same private ACL check because
replacement files inherit that directory's access. POSIX replacements use `0600`.
Doctor reports unavailable ACL inspection as `manual`; it does not claim success
for that check or alter an ACL. Host roleplay/economy configurations retain their
own storage and permission rules.

## Choose operation and transport

| Operation | Mode | Result |
| --- | --- | --- |
| `install-new-server` | `stdio` | Client receives absolute Node command and server/Vault arguments. The client will launch the server later. |
| `install-new-server` | `local-http` | Client receives a loopback URL; preview supplies a separate manual launch command. |
| `connect-existing-server` | `local-http` | Client receives an existing numeric loopback HTTP endpoint; no launch command. |
| `connect-existing-server` | `remote-https` | Client receives an explicit existing HTTPS endpoint; no launch command. |

Stdio cannot connect to an already-running server. New remote server provisioning
is deliberately unsupported: configure, approve and verify the host/TLS/network
boundary separately before connecting. The default local endpoint is
`http://127.0.0.1:8788/mcp`. Local URLs must use numeric `127.0.0.1` or `[::1]`;
wildcard/public/LAN binds are rejected. Endpoint paths must be exactly `/mcp`,
without embedded credentials, query parameters or fragments. The assistant does
not accept or export tokens, certificate material or custom authentication headers.
Clients needing authentication or a different schema require separate manual
configuration. An existing different `mcpvault` entry is a conflict, never silently
replaced.

## Preview and confirmed apply

The default action is `preview`. This example uses POSIX paths; on Windows use
quoted absolute paths such as `C:/Apps/MCPVault`, `D:/Notes/Vault`,
`C:/Private/MCPVault` and `C:/Private/client.json`. All directories must exist.

```sh
node /opt/mcpvault/scripts/mcpvault-setup.mjs --operation install-new-server --mode stdio --program /opt/mcpvault --vault /srv/notes/vault --private-state /home/alex/private/mcpvault --client /home/alex/private/client.json
```

Review the proposed `clientEntry`, `launch`, canonical `paths`, `change` and
`fingerprint`. Re-run the same command with
`--action apply --confirm sha256:<exact-preview-fingerprint>` to merge the entry.
The confirmation binds the operation, mode, canonical paths, core artifact hashes,
Node executable path and current client-file bytes. Any changed binding requires
a new preview. Adding `--confirm` to a plain preview is rejected.

The output contains the proposed MCPVault entry and hashes, never unrelated
client settings. Existing settings and other MCP servers are preserved. Malformed
JSON, incompatible `mcpServers` values or a conflicting entry stop the operation.
An identical entry is a no-op. Input/output JSON and each inspected artifact are
bounded to 1 MiB.

Before a changed apply, close the client/settings editor. A sibling exclusive lock
serializes cooperating setup processes. The tool checks source fingerprints under
that lock, writes and flushes an exclusive backup and temporary file, rechecks,
renames the file, then verifies its bytes. Arbitrary external editors do not obey
this lock; there is no OS-level compare-and-swap against an editor racing the final
rename. Keep them stopped until verification finishes. A rename requires the
usual filesystem semantics; this is not a distributed transaction.

The returned `backup` points to the byte-exact previous client JSON. If no file
existed, it points to an `absent.json` record. **Backups may contain existing client
secrets and must stay host-private; never include them in exports or Git.** To
restore, stop client writers, compare the installed hash and current contents,
then restore the reviewed backup manually (or remove a newly created client file
only after verifying it contains no subsequent user changes). Never overwrite
later edits blindly. After a crash, inspect the client, private backups and
`.mcpvault-setup.lock` before removing a stale lock. Setup does not auto-recover or
delete forensic evidence. Flushes and atomic rename do not prove durability of a
filesystem across power loss; maintain independent backups.

For local HTTP, substitute `--mode local-http`. A new-server preview uses the
existing `--mcp-http-only PORT --mcp-http-host 127.0.0.1` CLI switches. Start the
reported command only after approving the host. For remote connection, use
`--operation connect-existing-server --mode remote-https --url https://host.example/mcp`.

Runtime settings remain the existing server CLI options and environment.
Setup does not read or replace economy/roleplay/skill-evolution private configs,
capture their credentials, or create a competing runtime config. Review inherited
runtime environment and separately approved feature configuration before manually
launching. The local HTTP host flag explicitly fixes loopback; inherited TLS or
other settings can still change runtime behavior and must match the client URL.

## Secret-free recipe export/import

`--action export` prints a version-1 `mcpvault-portable-installation` JSON recipe
to stdout. Only `operation`, `mode` and four literal path placeholders are carried
alongside format/version. Export reads no client configuration, Vault contents,
private files, identities or checkpoints. URLs and machine paths are omitted.
Save stdout as a recipe using your editor or shell. Export needs the operation/mode
(and a valid explicit URL for remote mode), but does not inspect path options.

On the destination use `--action import --manifest /absolute/recipe.json` plus
the four new path options and, for remote mode, a newly supplied URL. Operation
and mode come from the recipe; supplying conflicting values is rejected. Import
defaults to a read-only preview including `remap`. Add the exact returned
`--confirm sha256:...` to the same import command to apply the client merge.

Unknown versions, additional fields, changed placeholder definitions, embedded
files, `env`, credentials, identities and checkpoints are rejected. An export is
not a backup and cannot transport host approval or private runtime state. A recipe
does not authorize copying a Vault or starting a writer.

## Read-only doctor

Use the same explicit options with `--action doctor`. Doctor checks Node >=22,
canonical path separation, core server/CLI/control-plane build artifacts for new
servers, private permissions and optional platform features. It never imports the
server, builds, starts stdio, reads credential files, repairs, registers or writes.
Core artifact presence/hashes do not establish freshness of the complete build or
availability of native/dependency modules. Validate those separately on the new
host. Any failed check gives exit status 1; manual/skipped checks remain explicitly
unverified even when the report has no failed checks.

Only an explicit `--check-endpoint` in an HTTP mode sends an unauthenticated,
bounded protocol initialization and `tools/list` to the supplied URL. Redirects
are refused. The response must expose exactly `orient_wiki`, `get_agent_pulse`,
`list_active_capabilities`, `search_capabilities` and `call_endpoint`. Doctor makes
no tool calls, performs no login/registration, and reports authenticated endpoints
it cannot inspect as failed/unverified. Do not point this option at a live host
without permission for this diagnostic. Protocol negotiation may create an
ephemeral transport session; no application mutation is requested.

The core setup script uses Node facilities across Windows/macOS/Linux. Desktop
Obsidian, service managers, native model dependencies and PDF extraction are
optional host capabilities. `--pdf-sandbox` requests a readiness warning on
Windows; it never provisions or enables extraction. On macOS/Linux it is rejected
with no unsandboxed fallback. Existing Windows PDF/AppContainer setup remains the
authority for extraction.

## Existing host utilities

The Obsidian plugin installer no longer has a machine-specific target default.
Its CLI requires `--target <absolute-vault>` and
`--confirm-target <same-absolute-vault>` for `status`, `install` or `restore`.
The existing ordinary-path/symlink checks, generated-template ownership checks,
release validation, recoverable backups and revision-safe restore remain in
place. Its programmatic API still accepts `vaultPath` and explicit `expectedTarget`.
Plugin installation remains a separate authorized Vault mutation; the portable
assistant never invokes it. Its existing API/CLI is separate from the portable
assistant's fingerprint protocol.

`scripts/roleplay-host.mjs` resolves its built modules relative to the script,
so it can run from another working directory. Vault/config arguments retain their
existing meaning. That change does not authorize writer recovery or migrations.

## Safe manual host migration

1. Identify the authoritative Vault and current writer. Stop the old writer and
   all other processes that can mutate its world/economy/ledger state. Verify they
   are stopped; do not infer this from a missing UI window.
2. Take consistent backups of the authoritative Vault and required old-host
   private state while writes are stopped. Retain old-host recovery evidence and
   secrets only in approved private storage. Never use a recovered local Vault as
   a sync source or copy host identities/checkpoints into the new host blindly.
3. Install and validate a verified program build and prerequisites on the new
   host. Provision separate private storage. Export/import only the recipe and
   review its path remap. Obtain explicit new-host approval, credentials and
   feature policies through the established host workflow.
4. Perform a read-only doctor, then approve any separately required host recovery
   operation after reviewing writer ownership and stale-lock evidence. The setup
   assistant neither grants ownership nor edits writer markers.
5. Replay and verify authoritative history using the existing recovery procedures.
   Compare sequences, balances/conservation invariants, projections and checkpoint
   expectations against the consistent backup. Do not treat regenerated indexes
   as authoritative evidence or start the second writer to test connectivity.
6. Start only the approved new writer after replay verification. Verify client
   connectivity and the intended runtime endpoints with authorized diagnostics.
   Keep the old host stopped and retain rollback artifacts until acceptance.
   A rollback also requires stopped writers and consistent state review.

Validation for this change is Windows-local synthetic-fixture testing only. POSIX
permission execution is skipped on Windows; Linux/macOS PDF rejection is tested
as a platform branch, not a native OS run. Windows successful-apply tests simulate
only permission-inspection metadata because the desktop sandbox prevents fixture
ACL provisioning. File merging, backups, stale fingerprints, locks, path aliases
and a loopback mock MCP endpoint use real local I/O. No live Vault, real credentials,
real host migration, deployment or native macOS/Linux verification is claimed.
