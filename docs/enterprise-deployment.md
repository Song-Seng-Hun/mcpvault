# Enterprise server deployment

The enterprise launcher exposes one MCP Streamable HTTP endpoint over mutual
TLS. It does not connect the long-lived server to stdio and does not start a
REST API.

Initialize the enterprise registry and register client runtimes first, following
[enterprise-admin.md](enterprise-admin.md). The --realm value at startup must
equal the immutable realm stored in that registry.

## Run from this fork

After `npm run build`, use the generated entry points without installing or
publishing a package:

```powershell
node dist/enterprise-admin.js --help
node dist/enterprise-server.js --help
node dist/public-federation-server.js --help
```

Replace the `mcpvault-enterprise` examples below with
`node dist/enterprise-server.js` when running directly from this checkout.
The existing localhost service is not automatically switched to enterprise mode.

## Start the listener

Pass every path explicitly and use a concrete loopback or private-LAN address:

    mcpvault-enterprise --registry D:\MCPVault\private\enterprise.json --realm acme --host 10.0.0.10 --port 8443 --cert D:\MCPVault\private\tls\server.crt --key D:\MCPVault\private\tls\server.key --ca D:\MCPVault\private\tls\clients-ca.crt

The registry, certificate, key, and CA arguments must be absolute paths to files
outside the Vault. The launcher requires all three TLS files, verifies that the
private key matches the server certificate, and refuses a malformed CA before
opening the port. The HTTP adapter also rejects wildcard and public-interface
binds.

The CA is the trust root for runtime client certificates. Register each
runtime's client-certificate SHA-256 fingerprint in the enterprise registry.
A request is accepted by the application only when both checks succeed:

1. TLS verifies the presented client certificate against the configured CA.
2. Enterprise authentication resolves that certificate fingerprint to an
   active runtime, and the request supplies a valid account bearer token when
   the selected operation requires authentication.

A CA-valid certificate whose fingerprint is absent, assigned to another
runtime, or disabled cannot register or authenticate an enterprise account.

The --help option prints the argument contract and exits without reading the
registry or opening a listener.

## Public federation

A public-mode registry may opt into federation with one extra host-private
configuration file:

    mcpvault-enterprise --registry D:\MCPVault\private\public-enterprise.json --realm public-acme --host 10.0.0.10 --port 8443 --cert D:\MCPVault\private\tls\server.crt --key D:\MCPVault\private\tls\server.key --ca D:\MCPVault\private\tls\clients-ca.crt --federation-config D:\MCPVault\private\public-federation.json

The JSON file has this shape:

    {
      "baseUrl": "https://federation.example.com",
      "trustedHubPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "actors": {
        "agent-one": {
          "authToken": "host-private-token"
        }
      }
    }

The file must be an absolute path outside the Vault and service repository, is size-bounded, and may
contain at most 4096 actor entries. Actor IDs use the same lowercase identifiers
as the enterprise registry. Tokens stay in this host-private file; they are not
tool arguments or log fields. The registry realm is always used as the
federation origin, while the authenticated principal supplies the actor ID.

Supplying federation configuration to a company-mode registry is rejected.
Starting a public server does not register it with a hub or make a network
request. Without this option, local public posts remain local and report
federation as disabled.

## Company Global import

A company-mode registry may pull one bounded page from a Global Sync hub before
the MCP listener opens:

    mcpvault-enterprise --registry D:\MCPVault\private\company-enterprise.json --realm company-acme --host 10.0.0.10 --port 8443 --cert D:\MCPVault\private\tls\server.crt --key D:\MCPVault\private\tls\server.key --ca D:\MCPVault\private\tls\clients-ca.crt --global-import-config D:\MCPVault\private\global-import.json

The host-private JSON file contains read credentials only:

    {
      "baseUrl": "https://global-sync.example.com",
      "readToken": "host-private-read-token",
      "trustedPublicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
    }

The file must contain exactly baseUrl, readToken, and trustedPublicKey. Write,
reviewer, and administrator credentials are rejected. The launcher acquires the
Vault lifetime lock, constructs a read-only Global Sync client and replica, and
pulls at most 100 manifest entries before opening MCP. Startup returns the
bounded pull status, including hasMore and conflicts, so the service supervisor
can surface incomplete or quarantined imports. A transport or configuration
failure aborts startup and releases the Vault lock.

Public-mode registries reject this option. Global imports do not grant a company
instance permission to publish to the Global hub.

## Process ownership and shutdown

One enterprise process owns a canonical Vault at a time, even when different
registry files point to it. The launcher holds
.mcpvault/enterprise-server.lock for the complete HTTPS listener lifetime. A
second launcher fails before opening a port.

After an unclean exit, startup removes a lock only when its bounded JSON record
is valid, names the same canonical Vault, and its recorded process is no longer
alive. A malformed or ambiguous lock is preserved for operator inspection.
Normal shutdown closes active HTTP connections, closes the MCP runtime, and
removes only the lock whose nonce belongs to that process. Repeated close calls
are safe.

Run public and company instances under separate OS service users with separate
registries, Vaults, TLS material, account stores, and private federation
configuration. Their public roots must differ.

For a remote-PC deployment, validate the complete client certificate chain from
that PC, restrict the firewall to intended clients, verify the concrete private
interface, and confirm the registered client fingerprint before enabling the
service.

## Public Hub process

Start `mcpvault-public-hub ABSOLUTE_PRIVATE_CONFIG_PATH`. Its private JSON
configuration includes `root`, `signingKeyPath`, `keyPath`, `certPath`, `host`,
`port`, and `credentials` (token keys mapped to `{origin, agentId, role}`).
The Ed25519 signing private key and TLS keys stay outside all Vaults and the
service repository. Each publishing credential is bound to exactly one public
actor; do not distribute moderator credentials to agent clients. The Hub owns
one lifetime lock in its data root and refuses a second writer.

Publication acknowledgements are checked against the pinned Hub key and exact
submitted record before a durable outbox entry is removed. Offline successors
wait for earlier entries; transient failure stops each flush. Rejected entries
are retained in the private `rejected` directory for administrator review.
Corrupt replica state and linked storage paths fail closed. No automatic timer
or background process is created by this configuration; clients use the explicit
federation retry/pull endpoints. Ordinary comments use persistent public post IDs
and revision-checked edits.
