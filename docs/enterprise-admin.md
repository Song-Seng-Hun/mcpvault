# Enterprise administrator registry

The enterprise registry is host policy. It is not part of an Obsidian Vault,
Git checkout, or MCP resource. An administrator must choose an absolute
`--registry` path outside the Vault and this service repository. Pass additional
repository or service roots with `--service-path` to protect those locations too. The file is
versioned JSON written with a cross-process lock and atomic replacement.

The registry does not store passwords and does not create operating-system
accounts, firewall rules, or network listeners. ScopeAuth remains responsible
for password hashing and account authentication. In an integrated server, the
ScopeAuth database may live beside the registry, for example
`<registry>.accounts.json`, so both remain outside the Vault.

## Policy model

An initialized registry has one immutable profile:

- `company` mode accepts only `internal` runtimes.
- `public` mode accepts only `external` runtimes.
- `realmId` becomes the command-center identity.
- `vaultPath` binds the policy file to one exact Vault.

Employees are administrator-created opaque `userId` records. They are active
until disabled. `sharedMemoryEnabled` defaults to `false`; pass
`--shared-memory` during employee creation to grant the new SharedMemory
subtree. It does not grant access to the whole legacy user scope.

Every runtime has an opaque `runtimeId`, the kind required by the profile, and
a unique SHA-256 client-certificate fingerprint. Certificate fingerprints are
mandatory for registration and every subsequent authorization decision.
Disabling either an employee or runtime immediately fails fresh authorization
checks.

An account binding is predetermined by an administrator:

```text
accountId + agentId + userId + modelId + runtimeId
```

An optional public display label and role are administrator metadata. Clients
do not select them.

## CLI

Run the source CLI with Node's TypeScript runner:

```powershell
npx tsx enterprise-admin.ts init `
  --registry C:\ProgramData\MCPVault\enterprise.json `
  --vault D:\Vaults\Team `
  --service-path D:\src\mcpvault `
  --mode company `
  --realm acme

npx tsx enterprise-admin.ts employee-create `
  --registry C:\ProgramData\MCPVault\enterprise.json `
  --vault D:\Vaults\Team `
  --user employee-one `
  --shared-memory

npx tsx enterprise-admin.ts runtime-register `
  --registry C:\ProgramData\MCPVault\enterprise.json `
  --vault D:\Vaults\Team `
  --runtime runtime-one `
  --kind internal `
  --cert AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

npx tsx enterprise-admin.ts invite-create `
  --registry C:\ProgramData\MCPVault\enterprise.json `
  --vault D:\Vaults\Team `
  --account acct-one `
  --agent agent-one `
  --user employee-one `
  --model codex `
  --runtime runtime-one `
  --expires-at 2026-09-09T00:00:00Z `
  --secret-file C:\Users\Administrator\MCPVault-Secrets\acct-one.invite
```

`invite-create` prints the invite ID, expiry, and secret-file path. It never
prints the generated secret. The explicit secret path must also be outside all
protected roots, and creation fails if that file already exists. Deliver that
file through an administrator-approved private channel.

Disable records without deleting their audit identity:

```powershell
npx tsx enterprise-admin.ts employee-disable --registry C:\ProgramData\MCPVault\enterprise.json --vault D:\Vaults\Team --user employee-one
npx tsx enterprise-admin.ts runtime-disable --registry C:\ProgramData\MCPVault\enterprise.json --vault D:\Vaults\Team --runtime runtime-one
```

Inspect legacy ScopeAuth accounts without changing either file:

```powershell
npx tsx enterprise-admin.ts migration-preview --accounts D:\Vaults\Team\.mcpvault\scope-auth.json --limit 100
```

The preview is bounded and omits salts, password hashes, capabilities, and all
other authentication material. It does not create employees, bindings, or
invites.

Inventory legacy scope memory without reading note bodies, changing files, or
guessing owners:

```powershell
npx tsx enterprise-admin.ts memory-preview --vault D:\Vaults\Team --limit 100
```

Legacy User entries are reported as host-private and remain in place. Agent
entries require a separately verified owner mapping before an administrator
can consider a manual copy into newly approved memory; this CLI command does
not accept or infer such mappings.

## Registration integration

Registration is a two-phase, retry-safe operation:

1. `reserveInvite` verifies the secret, realm, mode, runtime, certificate, and
   current employee/runtime status. It persists and returns a stable
   `registrationId` and the administrator-selected binding. A caller binding is
   optional; when present it must match exactly.
2. The server creates the ScopeAuth account with that `registrationId`.
3. `completeInvite` consumes the invite and persists the account binding.

If the server stops after step 2, a retry receives the same registration ID.
The ScopeAuth callback must treat an existing account as success only when its
registration ID and complete binding match and the submitted password verifies.
Any mismatch is a conflict. This is the boundary that prevents an interrupted
registration from granting a second account.

For convenience, `redeemInvite(input, callback)` runs those steps. The callback
must be idempotent by `registrationId`. Passwords are passed only to ScopeAuth;
the registry API never accepts them.

## Authorization and writer leases

`getPolicy`, `getEmployee`, `getBinding`, `resolveRequestCertificate`,
`assertBinding`, `getSessionLease`, `getSessionGeneration`, and
`assertSessionLease` synchronously read and validate the small registry file on
every call. Corrupt, oversized, mismatched, missing, or revoked records fail
closed. The server should call `assertBinding` and `assertSessionLease` before
physical I/O, not only at login.

One persistent writer lease exists per `agentId`.
`claimSessionLease({agentId, sessionId, expectedGeneration, expiresAt})` uses a
compare-and-swap generation and increments it. A different active session
cannot take over implicitly. An expired session may be replaced only with the
known current generation. `releaseSessionLease` also increments the generation;
`getSessionGeneration` exposes that last value even when no active lease exists.

## Revoke one persistent agent account

```powershell
mcpvault-enterprise-admin account-disable --registry D:\MCPVault\private\company-enterprise.json --vault D:\Vaults\Company --account network-account
```

Revocation removes the active binding and invalidates its writer lease immediately.
Other agents owned by the employee remain active. Previously registered account
and agent IDs cannot be reassigned to another employee. Employee/runtime disable
commands still revoke all dependent sessions.

Initialization writes a non-secret `.mcpvault/enterprise-instance.json` marker
inside the Vault. A legacy stdio or REST server refuses to open a marked Vault
without its matching enterprise registry. Do not remove this marker to bypass
enterprise startup. Secrets remain outside the Vault and service repository.
