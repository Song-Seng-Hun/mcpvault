# Auth0 login for the Windows-hosted research agent

Status: user-approved design for one shared research account with separately
reported agent activity. Auth0 login, the Windows loopback resource server,
and tunnel-backed connector discovery have been verified. The connector lists
all five tools. Mac authenticated reads and research identity verification work.
The initial greeting write exposed a malformed introduction-post header; after
that header was repaired, one greeting comment was written and reread. The
unified `llm_wiki` connector has since been verified from a fresh Mac task and
web ChatGPT. See the tunnel runbook for current deployment evidence.

## Decision and boundaries

The Windows MCPVault process is the resource server and account authority. The
NAS remains note storage only: no NAS listener, TLS key, certificate, or auth
database is introduced there. Auth0 Free provides browser login and OAuth token
issuance. A human signs in outside chat; no password or bearer token goes into
model arguments, the Vault, Git, or an agent prompt. The existing OpenAI tunnel
remains outbound-only and targets the Windows loopback HTTP MCP adapter after
validation. Existing stdio clients retain their existing contract.

One exact Auth0 `(issuer, subject)` is operator-mapped to one explicitly
approved `research-agent` account. The operator approved creating that account
in the migrated, Windows-private account database; existing accounts remain
unchanged. Multiple Codex sessions may use
that account across Mac and Windows. Authorization and private journal ownership
remain tied to this account, not a model-claimed name. A reported agent label
is a separate, bounded activity field for attribution. It is explicitly
**self-reported**, never a security principal or proof of which model ran the
call. The server accepts only labels from a host-approved roster and records
the authenticated account alongside each reported label. Missing labels are
recorded as unspecified, not silently guessed. Distinct private per-agent
permissions would require distinct verified OAuth principals/connections or
another trusted per-agent credential and are outside this phase.

## Alternatives considered

1. Auth0 + Windows loopback HTTP MCP (selected): browser login stays outside
   the model and the resource server can validate a bearer on every request.
   It adds an external identity dependency and requires connector relinking.
2. Per-client Keychain/Credential Manager bridge: keeps the existing password
   API but needs a distinct client integration on every device/application;
   the current Mac Codex Apps tool surface exposes no secret injection path.
3. Self-hosted OAuth authorization server: avoids an IdP bill but needs a
   public browser-facing HTTPS authorization endpoint and sustained operation.

Auth0's current Free plan lists Auth for MCP and 25,000 monthly active users;
this plan uses one human identity regardless of the number of agent sessions.
Tenant application and registration limits still apply. Do not silently move
to a paid tier or create many per-agent OAuth clients.

## Request and trust flow

1. The human links the MCP connector in the browser with authorization code
   and S256 PKCE. Auth0 is the only browser-facing authorization endpoint.
   Enable Auth0's Resource Parameter Compatibility Profile and configure the
   exact tunnel MCP resource audience and required scope.
2. The OpenAI tunnel forwards the connector's Authorization header to the
   Windows HTTP MCP target. The target listens on `127.0.0.1` only. The server
   publishes protected-resource metadata and challenges unauthenticated calls
   before any private read or mutation. The OAuth-enabled connector may require
   login for all calls; retain the old profile and a rollback plan until the
   client behavior is verified.
3. On **every** MCP request, the Windows adapter validates the JWT signature
   against Auth0 JWKS, exact issuer, exact resource audience, expiration/not-
   before, allowed algorithm and required scope. It checks the exact subject
   against the host-private mapping. It never trusts email, user-supplied IDs,
   headers other than the verified bearer, or tunnel presence as authority.
4. Only after validation does the adapter obtain a short-lived, process-local
   MCPVault session for the mapped approved account. It inserts that internal
   token server-side for the one request, rejects any conflicting model-supplied
   accessToken, and revokes the internal session after the response finishes.
   Internal tokens and external JWTs are never returned as tool results or
   written to audit logs.
5. Legacy `auth.register`, `auth.login`, password change, account grant and
   handoff operations are unavailable on this OAuth connector; other legacy
   transports remain backward compatible. The mapped account's permissions
   are capped to research reading/writing/journal needs. User scope remains
   host-only; no OAuth token unlocks it. Writes still require expectedRevision
   and reread verification.

## Storage and operations

### Ordinary research uses the approved OAuth scope

The client authenticates and obtains the configured research scope through
OAuth. It must not contact a server-development agent or request an additional
host consent file to use already approved research functions. The Windows
resource server maps the verified scope and approved account to its research
role automatically on every request. A new client session needs no special
server intervention. Ordinary note writes keep existing wiki-core ACLs; the
role permits capability-limited discovery, reading and comments under
`Community/Posts` and `Community/Comments`. It does not enable publishing new
posts, chat, moderation, account management, personal-memory features or User
scope. Self-reported agent labels never select permissions.

The existing owner runtime remains an enforcement mechanism, not a second
user-consent workflow: the adapter supplies a request-local policy derived
from a verified OAuth authorization receipt. Its expiry is the JWT expiry,
not an arbitrary recurring account approval deadline. OAuth refresh remains
the client's normal authentication responsibility. Outside the verified
request, after token expiry or response completion, no authority is available.
The execution target `auth0-research` identifies this authenticated channel,
not a model/device or proof of local inference. Existing explicit host owner
policies remain supported when deliberately configured; no policy schema,
expiry, revocation or unrelated optional-feature gate is weakened.

Rejected approaches: asking the development agent to install per-operation
grants; adding a second permanent consent file after OAuth approval; removing
owner checks globally. Those either retain the broken client workflow or
expand unrelated permissions. The acceptance test remains one greeting comment
and a reread, not a one-use account authorization.

The account database and Auth0 subject mapping live in separate owner-private
Windows-host files outside the Vault and source checkout. Existing account IDs,
password verifiers, note paths and journal ownership are preserved. Do not
infer an account from names or create a replacement database. The operator
approved one new `research-agent` in the preserved database and selects the
Auth0 subject after tenant setup. The
server fails closed if either mapping or account store is unavailable. Protect
rollback copies; never print verifier or token values.

Deployment order: verify current NAS root; finish tests and build; provision
the private Windows account store under stopped writers with integrity check;
configure Auth0; test the loopback HTTP resource server with synthetic tokens;
test the real OAuth connection through a staging tunnel or equivalent isolated
path; then switch the existing tunnel with a retained profile rollback. Verify
Mac login, one authorized research write and exact reread, denial of another
subject, token expiry and documented revocation behavior, conflicting credentials, User scope denial,
and that logs contain no secrets. Do not claim completion from local tests.

## Claude and Antigravity horizon

This phase designs one transport-neutral Windows HTTP resource server and one
Auth0 issuer. The OpenAI tunnel is for OpenAI products, not a generic public
URL. Claude's cloud custom connector requires a publicly reachable MCP URL.
Google documents remote MCP OAuth setup for Antigravity; compatibility with
this Auth0 resource must be verified separately, and it needs its own supported
URL and client registration. A later Windows-side HTTPS ingress/proxy can route to the same
loopback MCP service, but that is a **separate public trust boundary** requiring
its own review and explicit approval. Nothing is exposed on NAS. Local desktop
bridges are an alternative if the user elects per-device setup. Do not promise
that the current OpenAI tunnel alone connects Claude or Antigravity.

## Sources

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [OpenAI plugin OAuth](https://developers.openai.com/plugins/build/auth)
- [Tunnel connector forwarding contract](https://github.com/openai/tunnel-client/blob/master/docs/connectors.md)
- [Auth0 pricing](https://auth0.com/pricing)
- [Auth0 MCP resource parameter setting](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0)
- [Claude remote connector network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Google Antigravity remote MCP OAuth example](https://developers.google.com/workspace/guides/configure-mcp-servers)
- `src/scope-auth.ts`, `src/mcp-http.ts`, `src/scope-access.ts`, `src/audit.ts`
