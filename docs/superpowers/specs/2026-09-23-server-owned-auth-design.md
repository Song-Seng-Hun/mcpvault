# Server-owned authentication without exposing NAS

Status: stage 1 implementation in progress. The user subsequently selected
existing MCP account management, not browser OAuth or an external login service.
Stage 2 below is a historical design alternative, NOT implementation authority.
No public listener, external identity provider, or production migration has
been configured. See `../../SERVER-ACCOUNT-STORE.md` for the implemented scope.

## Goal and boundaries

Allow explicitly authorized Mac and Windows clients to use one durable research
agent journal without passwords or bearer tokens entering model messages.
The Windows MCP service owns account authentication; NAS owns note storage.
NAS receives no new public listener, certificate, private key, or firewall rule.
An external identity provider is not required by this design.

Keep User storage host-only. Neither a claimed userId nor a matching model name
authorizes another agent's journal. Reuse an explicitly selected research agent
identity across hosts; do not merge accounts or migrate journals by inference.
Server operators can still read stored notes: this is access isolation, not
end-to-end encrypted storage.

## Verified starting point

- `src/scope-auth.ts`: ScopeAuthService already verifies account passwords and
  maintains process-local bearer sessions. The default account database is
  `<vault>/.mcpvault/scope-auth.json`; an explicit authPath exists internally.
  General-mode lock placement still defaults to the Vault even with authPath.
- `src/createServer.ts`: explicit account storage is currently supplied through
  enterprise configuration, not general personal-server configuration.
- `src/mcp-http.ts`: HTTP Authorization bearer is injected server-side into MCP
  calls. This is not proof of OAuth issuance, discovery, or stdio token forwarding.
- `src/scope-access.ts` and `docs/layered-memory.md`: authenticated personal
  journal access is agent-bound; ordinary User scope is unavailable through MCP.
- Installed tunnel client `help oauth` describes discovery for an HTTP target:
  protected-resource metadata followed by authorization-server metadata.
  Existing connection was previously verified as tunnel-to-stdio; recheck before
  any deployment because that snapshot is not a permanent runtime guarantee.

## Alternatives and decision

1. Recommended: retain server-owned accounts and existing permission services;
   separate host-private auth storage, then add standards-based browser login
   and request authentication at the transport boundary.
2. Managed identity provider: reduces login-service operation but introduces an
   external identity dependency. Not selected after the user's clarification.
3. Per-client secret-store bridge: can reuse password APIs but requires separate
   client provisioning and does not meet the desired remote-only experience.

## Stage 1: host-private account storage

Expose an explicit personal-server account-store configuration through the
existing service construction and CLI, rather than inventing a second database.
When configured, require a canonical absolute local path outside the Vault,
repository, and protected service directories; reject UNC/network storage and
path aliases that resolve into those roots. A Windows mapped drive must not be
assumed local merely because it has a drive letter.

Keep the lock beside the selected account database and preserve the existing
atomic-write/concurrency protocol. Verify owner-restricted access using platform
appropriate checks; POSIX chmod alone does not establish a safe Windows DACL.
Fail closed if the selected secure mode cannot establish the required boundary.
Do not log database contents, hashes, credentials, or raw tokens.

Existing deployments retain their current behavior unless explicitly opting in.
A configured missing or invalid store must not silently fall back to the Vault.
Production cutover must preserve account IDs, password verifiers and namespaces,
stop conflicting writers, keep a protected rollback copy, and verify account
metadata without exposing verifiers. No automatic migration, deletion, new
registration, or generated replacement password is permitted.

This stage improves storage boundaries only. It must not be reported as enabling
Mac journal writes or completing remote login.

## Stage 2: historical browser-login alternative (not selected)

Keep account verification and session authority on the server. Use a maintained
OAuth authorization-server implementation rather than handwritten OAuth crypto.
The browser authenticates the human outside chat and obtains explicit consent
for the selected research agent and allowed operations. The client, not the
model, manages protocol credentials. Never substitute one shared server token
for all tunnel callers or trust caller-supplied identity headers.

Use protected-resource metadata and authorization-code flow with S256 PKCE,
exact registered redirect URIs, bound issuer/resource/client, short-lived
credentials, and revocable grants. Check authorization on every call, including
after asynchronous operations where existing services require freshness checks.
Reject contradictory model-supplied credentials in the authenticated transport
path; do not let them switch identities. Keep legacy password APIs compatible
on their existing authorized paths without exposing them as the new login UI.

Bind the MCP HTTP target to loopback on the same host as tunnel-client. No
non-loopback deployment is implied. Do not change the live tunnel until token
forwarding and discovery have been tested through the actual product path.

### Explicit deployment gate

Server-owned accounts do not by themselves make a browser login reachable.
Official tunnel documentation states that the authorization server is not
automatically tunneled. Before implementing/deploying this stage, select and
approve a concrete reachable authorization endpoint and its TLS boundary.
The choice must preserve NAS isolation and specify who terminates TLS and can
observe login traffic. A separate HTTPS relay is a new trust boundary requiring
approval, not a presumed consequence of approving server-owned accounts.
Until this gate is resolved, do not create public DNS/listeners, configure a
relay, provision certificates, or claim end-to-end login compatibility.

## Verification and rollout

Stage 1 tests: legacy default compatibility, explicit local-store success,
invalid/unsafe path rejection, missing-store behavior, account-preserving
cutover procedure, lock placement, concurrent account writes, restart recovery,
and secret-free failures. Use disposable fixtures, never production accounts.

Stage 2 acceptance: real Mac and Windows login, same approved journal identity,
successful authorized write and reread, denial for another user/agent and User
scope, token expiry/revocation, concurrent session isolation, credential override
rejection, PKCE/code replay and redirect attacks, rate limiting, log inspection,
and stale expectedRevision rejection. Research content must not be published
as a workaround. Use meaningful user-approved notes only for live write checks.

Auth is a common security boundary: targeted tests during implementation, build,
full integration coverage before release, and explicit rollback/deployment
verification. Preserve unrelated dirty work and keep source/dist aligned.

## Sources

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)
- `docs/SECURE-MCP-TUNNEL.md`
- `docs/CLIENT-COMPATIBILITY.md`
- `docs/layered-memory.md`
- `src/scope-auth.ts`, `src/scope-auth-tools.ts`, `src/scope-access.ts`
- `src/createServer.ts`, `src/mcp-http.ts`, `server.ts`
