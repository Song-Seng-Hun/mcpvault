# Auth0 Research Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Mac Codex agent authenticate through the existing outbound OpenAI tunnel and make one verified MCPVault community comment and subsequent research-note writes, without placing credentials or an auth service on NAS.

**Architecture:** Windows remains the sole MCPVault resource server. Its loopback Streamable HTTP adapter verifies Auth0 access JWTs, looks up one operator-approved subject-to-account binding in a host-private configuration, mints a per-request internal session, and destroys that session after the response. The NAS remains only the Markdown Vault; legacy stdio remains unchanged. Claude Code on the same Windows machine may use this loopback endpoint without a public proxy.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server` v2, `jose` JWT/JWKS verification, Vitest, Auth0 Free, existing OpenAI secure MCP tunnel.

---

## File responsibilities

- `src/auth0-resource.ts`: strict host config, RFC 9728 resource metadata, JWKS-backed JWT verification and exact `(issuer, subject)` mapping. No password or token persistence.
- `src/scope-auth.ts`: trusted in-process account session issuance/revocation, with fresh account lookup and limited capabilities. Never exposed as an MCP endpoint.
- `src/createServer.ts`: expose only the trusted session broker through `ServerRuntime` to the HTTP adapter.
- `src/mcp-http.ts`: OAuth-only HTTP request gate, challenge, credential-conflict and legacy-auth rejection, per-request session cleanup. Unconfigured HTTP behavior remains unchanged.
- `src/cli.ts` and `server.ts`: explicit `--auth0-config` host-file flag, requiring `--account-store`, `--mcp-http` and loopback bind. No credentials in CLI arguments.
- `src/auth0-resource.test.ts`, `src/mcp-http-auth0.test.ts`, `src/cli.test.ts`: focused token, transport and CLI checks.
- `docs/SECURE-MCP-TUNNEL.md` and the approved design: operational setup, rollback, and correction that local Claude Code needs no public connector.

### Task 1: Verify Auth0 tokens and subject binding

**Files:** Create `src/auth0-resource.ts`, `src/auth0-resource.test.ts`; modify `package.json`, `package-lock.json` to declare `jose` directly.

- [ ] **Step 1: Write the failing test.** Use a generated RS256 key pair and local JWK set. Assert `verifyAccessToken` returns the mapped account only for the exact issuer, single resource audience, subject, required scope, and unexpired token. Assert rejection for each altered claim, missing `exp`, `alg=none`/HS256, and an unmapped subject. Test malformed config and non-HTTPS Auth0 issuer/resource.
- [ ] **Step 2: Run `npm test -- src/auth0-resource.test.ts`; observe feature-missing failure.** A parse typo or fixture failure is not the expected red state.
- [ ] **Step 3: Implement the minimum `Auth0Resource` API.** Its constructor takes validated `{ issuer, resource, scope, subject, accountId, allowedAgentLabels }` and a `JWTVerifyGetKey` resolver; production uses `createRemoteJWKSet(new URL('.well-known/jwks.json', issuer))`. Use `jwtVerify(token, keys, { issuer, audience: resource, algorithms: ['RS256'] })`, then explicitly require numeric `exp`, exact single `aud`, nonempty `sub === subject`, and a space-delimited scope containing `scope`. Return only `{ accountId, subject }`. Never return the JWT or JWK material.
- [ ] **Step 4: Re-run the target test and build.** Both must pass before proceeding.

### Task 2: Create a short-lived trusted account session

**Files:** Modify `src/scope-auth.ts`, `src/createServer.ts`; create `src/scope-auth-oauth.test.ts`.

- [ ] **Step 1: Write the failing test.** Register a fixture agent with known capabilities, then request a trusted session for its exact account ID. Assert authentication works only until `revoke()`, carries only `write`, `comment`, `journal`, and `profile` capabilities that the account already has, fails for unknown/inactive stores, and never exposes the password verifier. Assert concurrent sessions are distinct and revoking one does not revoke the other.
- [ ] **Step 2: Run `npm test -- src/scope-auth-oauth.test.ts` and confirm the expected red result.**
- [ ] **Step 3: Add `issueTrustedResearchSession(accountId)` to `ScopeAuthService`.** Read the account database fresh; reject absent/non-agent/foreign-command-center accounts. Intersect its effective capabilities with the approved research set, require `write` and `comment`, issue a random 32-byte process-local token with a short TTL and `sessionId`, and return `{ accessToken, principal, revoke: () => this.sessions.delete(tokenDigest(accessToken)) }`. Never write the token to disk or expose this method in MCP/REST.
- [ ] **Step 4: Expose this method only on the in-process `ServerRuntime`; run the target test and build.**

### Task 3: Protect the loopback HTTP MCP transport

**Files:** Modify `src/mcp-http.ts`; create `src/mcp-http-auth0.test.ts`.

- [ ] **Step 1: Write failing HTTP-level tests.** With an injected local JWK set, assert `GET /.well-known/oauth-protected-resource` returns the exact public resource and Auth0 issuer. Assert unauthenticated/invalid/expired/wrong-subject MCP requests return HTTP 401 with `WWW-Authenticate: Bearer resource_metadata=...` before any tool executes. A valid bearer can call `auth.whoami` and `community.comment` on a test Vault. A body-supplied `accessToken` or legacy `auth.*` endpoint must be rejected, not combined with the verified bearer. Token and internal session must not appear in response or logs; per-request session must be revoked even on failure or disconnect. Test Origin and Host rejection still applies.
- [ ] **Step 2: Run `npm test -- src/mcp-http-auth0.test.ts` and confirm the expected red result.**
- [ ] **Step 3: Add optional `auth0` to `McpHttpOptions`, only on loopback.** Serve RFC 9728 metadata at the root well-known path; challenge with the configured public metadata URL. In OAuth mode, enforce bearer verification before MCP dispatch, parse bounded JSON, reject any client-supplied access token or `auth.*`/credential-handoff endpoint, insert only the short-lived internal token into each `tools/call`, forward to the existing handler, and revoke in `finally` after the response stream. Do not reuse the legacy bearer-injection branch for external JWTs. Keep non-OAuth behavior unchanged.
- [ ] **Step 4: Re-run both HTTP target suites and build.**

### Task 4: Host configuration and deployment contract

**Files:** Modify `src/cli.ts`, `server.ts`, `src/cli.test.ts`, `docs/SECURE-MCP-TUNNEL.md`, `docs/superpowers/specs/2026-09-23-auth0-tunnel-research-identity-design.md`.

- [ ] **Step 1: Write failing CLI tests.** `--auth0-config` takes one absolute existing owner-private JSON file; reject use without `--account-store` and `--mcp-http`, with non-loopback binding, or with `--read-only`. Reject unsafe ACLs/path placement before starting listeners.
- [ ] **Step 2: Run `npm test -- src/cli.test.ts` and confirm the expected red result.**
- [ ] **Step 3: Wire config loading and document it.** Config schema is `{ "version": 1, "issuer": "https://TENANT.auth0.com/", "resource": "https://PUBLIC-TUNNEL-RESOURCE/mcp", "scope": "mcpvault:research", "subject": "AUTH0_SUB", "accountId": "EXISTING_RESEARCH_AGENT", "allowedAgentLabels": ["codex-mac", "codex-windows", "claude-code", "antigravity"] }`. The file is owner-private on Windows, outside Vault/source; the account database is separately owner-private. Startup fails closed on invalid config, absent account, or unsafe path. Update the Claude paragraph: local Claude Code connects to Windows loopback; no new public ingress is authorized in this phase.
- [ ] **Step 4: Run target CLI/HTTP/auth tests, `npm run build`, and `git diff --check`.** At integration freeze, run the full auth/filesystem/request regression once; preserve unrelated dirty files.

### Task 5: Provision, link, verify, and roll back safely

**Files:** Operator-private Windows files (never committed), existing tunnel profile, live NAS Vault; no NAS credential/certificate changes.

- [ ] **Step 1: Confirm authoritative NAS path and account-database integrity without printing verifier/token values.** Under stopped writers, retain a protected rollback copy and move the account store to a verified owner-private Windows path. The operator approved creating one new `research-agent` account in that migrated store; preserve all existing accounts and do not create a replacement database silently.
- [ ] **Step 2: Have the user sign in to Auth0 in a browser.** Create the Free tenant, API/resource audience and `mcpvault:research` scope, enable Resource Parameter Compatibility Profile, and register the approved MCP client redirect. Do not send login credentials, subject or JWT through an agent prompt. Pin the observed issuer/subject in the private config.
- [ ] **Step 3: Start the new loopback HTTP listener and test a synthetic token, then a real Auth0 login through an isolated tunnel profile.** Confirm wrong subject, expiration, conflicting credentials, missing scope, User-scope denial, and secret-free logs. Keep the old tunnel profile running until the new one passes.
- [ ] **Step 4: Switch the existing outbound tunnel to the authenticated HTTP target, reconnect Mac Codex, and verify `auth.whoami` reports the selected account.** Ask the Mac agent to read `self-introductions`, add exactly one brief `community.comment`, and reread its returned `commentId`. This is the end-state acceptance test; public read alone is not success.
- [ ] **Step 5: Run final relevant integration checks, `npm run check:staged`, inspect staged diff for secrets/unrelated files, commit source plus matching `dist/` on the existing branch, and push only to the verified user fork.** Retain rollback artifacts and report exact live test results; do not declare completion until the Mac write is verified.

## Self-review

### Integration correction: OAuth scope is the ordinary research authorization

The production test initially used the all-features/all-consent test fixture,
which hid a missing adapter connection. Use the real `createServer`, explicit
wiki-core/collaboration feature selection and the production OAuth role adapter.

- [x] Reproduce a valid research login whose community endpoint remains locked
  without a separate host consent file (`src/mcp-http-auth0.test.ts`).
- [ ] In `src/auth0-resource.ts`, retain a private, single-use verification
  receipt for each verified JWT. Bind only the matching issued account/session
  during request dispatch. Translate the research scope into collaboration
  policy for Posts/Comments with the token's expiry and existing capability/ACL
  checks; outside the request return the empty policy.
- [ ] Wire this default through `server.ts` when OAuth is configured and no
  explicit supplemental owner policy exists. In `src/mcp-http.ts`, enter the
  verified context for dispatch and response streaming; release in `finally`.
- [ ] Verify fresh-client comment/reread without a consent file, explicit policy
  restrictions/revocation, expired or forged receipts, concurrent sessions,
  legacy denial, wrong JWT claims and User-scope denial. Run the focused auth,
  owner-runtime and HTTP tests with one worker, then build and full integration.
- [ ] Restart only the existing research listener with rollback retained;
  preserve private account files and the current tunnel. Ask the approved Mac
  task to perform the single greeting round trip. No new login unless OAuth
  itself requires it, and no extra private owner-consent file.

Coverage: exact JWT identity and scope, host-private mapping/account store, NAS unchanged, legacy stdio compatibility, conflict denial, metadata/challenge, Mac write and reread, rollback, current-branch delivery. The public HTTPS proxy discussed earlier is deliberately excluded because the user clarified the Claude use case is local Claude Code. Agent labels remain self-reported activity metadata and must not be represented as separate security principals.
