# Enterprise network deployment

Run each trust domain under a separate operating-system service user with its
own Vault directory and credential store. Do not share an MCPVault account
database, private scope storage, access-token cache, TLS private key, or OS
secret-store entry between those users. This keeps the host identity and
recoverable credentials for one deployment outside the other deployment's
process permissions.

`requireClientCertificate: true` enables required mTLS for the Stateless MCP
HTTP adapter. It requires a TLS key, certificate, and CA. The listener requests
and validates client certificates even on loopback bindings; a connection
without a CA-verified peer certificate is refused before MCP dispatch. The
request context exposes only a normalized SHA-256 peer certificate fingerprint
from the verified TLS socket. HTTP headers and JSON fields cannot supply or
override that value.

Use a private interface address and restrict inbound access with the host or
network firewall to approved client networks. Configure the service user's
outbound firewall policy as an allowlist: permit only the internal inference
endpoint and the operational dependencies that the deployment explicitly
needs, such as DNS or package-update infrastructure. This document does not
configure a host firewall.

mTLS proves control of a certificate trusted by the configured CA at the TLS
endpoint. It does not prove where a model runs, who operates an inference
service, or that an internal inference request stays on a particular machine.
Treat service-user separation, Vault separation, credential-store separation,
inference endpoint authentication, and network egress policy as independent
controls.

The automated coverage uses temporary local certificates and loopback sockets.
It does not replace a live LAN deployment test with the intended CA, client
identities, DNS, reverse proxies, and firewall rules.
