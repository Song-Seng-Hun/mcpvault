# Server-side account storage

MCPVault already accepts `auth.register` and `auth.login` through
`call_endpoint`. A tunnel transports these calls; it does not identify the
human or give every caller a shared login. NAS note storage and server account
storage are separate responsibilities.

## Optional private account store

The personal server accepts `--account-store FILE` and the library accepts
`CreateServerOptions.accountStorePath`. FILE must be an existing account
database in a canonical absolute, owner-private local directory outside the
Vault and source checkout. Windows additionally requires a fixed local volume
and verifies native ACLs (owner, SYSTEM and Administrators only). Links,
hardlinked files, missing stores and unsafe permissions are rejected.

The service rechecks admission before account reads, including cached reads,
and before writes. The lock is adjacent to the configured database. It does
not create a replacement database or fall back to the legacy Vault database
when a configured file disappears. It never changes ACLs to admit a bad path.
This setting is host-only and cannot be supplied by an MCP caller. It cannot
override enterprise account-store configuration.

Without the option, legacy account placement and behavior remain unchanged.
Password verifiers are stored, not plaintext passwords. Existing bearer
sessions remain process-local and expire/revoke according to ScopeAuthService;
this change does not introduce permanent tokens or automatic login.

## Operator cutover

1. Verify the running service's actual Vault root is the intended NAS, not a
   recovered local backup or a drive-relative path.
2. Provision a dedicated private local directory on the Windows service host.
   Verify native ownership/ACLs; POSIX permission flags alone are insufficient.
3. Stop every writer to the original account database. Create a protected
   rollback copy, copy the database into the private directory, and verify
   account IDs and file integrity without printing verifiers. Do not regenerate
   accounts, passwords or agent IDs, and do not delete the original as part of
   this operation. A genuinely new installation may explicitly provision an
   empty version-1 database; an existing installation must not do so.
4. Add the explicit `--account-store` path to the server command while keeping
   its Vault argument and transport unchanged. Restart under the intended
   service identity and verify register/login behavior with authorized accounts.
5. Verify rollback before resuming writes. If writes have reached the new
   store, do not roll back to a stale original database and lose account changes.
   Retire the old sensitive copy only through a separately reviewed operation.

No ports, certificates, tunnel keys, existing accounts, Vault notes or production
ACLs are changed by adding this source-code feature. This is not yet a complete
remote credential-storage integration: clients still need a verified private
credential store and a safe credential-to-tool invocation path. Do not expose
credentials in chat or silently treat a tunnel connection as an authenticated
research agent.
