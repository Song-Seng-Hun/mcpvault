# Antigravity Local OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Windows Antigravity CLI to the existing MCPVault process with its own Auth0 public client and resource audience, then verify one Sonnet greeting comment.

**Architecture:** One loopback listener routes `/mcp` to the existing tunnel resource and `/antigravity/mcp` to a second Auth0 resource. A single `Auth0Resource` and shared request context preserve the existing research consent boundary. Antigravity's local MCP configuration uses Streamable HTTP, never another stdio server.

**Tech Stack:** TypeScript, Node HTTP, `jose`, Vitest, Auth0, Antigravity CLI.

---

## File ownership

- `src/auth0-resource.ts`: strict optional local resource/client config; audience/client verification and metadata by fixed channel.
- `src/auth0-resource.test.ts`: parser and JWT isolation.
- `src/mcp-http.ts`: exact path routing, local PRM and challenge, shared MCP handler.
- `src/mcp-http-auth0.test.ts`: HTTP discovery and cross-path isolation.
- `server.ts`: no new process; existing listener receives the extended private config.
- `docs/SECURE-MCP-TUNNEL.md`: local Antigravity operations and rollback.
- Matching `dist/` output from `npm run build`; do not stage unrelated generated skill/NAS changes.
- Owner-private Windows Auth0 config and Antigravity global/workspace MCP configs: operational changes only, never committed.

## Task 1: Strict local Auth0 resource

- [ ] Add a failing parser/JWT test to `src/auth0-resource.test.ts`. The concrete new config is `localResource: { resource: 'http://127.0.0.1:8789/antigravity/mcp', clientId: 'antigravity-public-client-id' }`; confirm a local `aud` with matching `azp` passes only `verifyAccessToken(token, 'local')`, whereas the same token fails `verifyAccessToken(token)` and a wrong `azp` fails local validation. Existing version-1 config without `localResource` must continue passing.
- [ ] Run `npx vitest run src/auth0-resource.test.ts`; expect the new case to fail because the strict parser rejects `localResource`.
- [ ] Add the optional field and exact parser checks in `src/auth0-resource.ts`: `new URL(resource)` must have protocol `http:`, hostname `127.0.0.1`, port `8789`, pathname `/antigravity/mcp`, and no username/password/query/hash; `clientId` must be a nonempty bounded Auth0 client ID. Select the expected audience from a server-owned `'primary' | 'local'` argument (default primary). For local tokens require `payload.azp === config.localResource.clientId`; keep existing `iss`, `sub`, `scope`, expiry and RS256 checks. `metadata('local')` returns the local resource with the same issuer/scope.
- [ ] Run `npx vitest run src/auth0-resource.test.ts`; expect pass. Commit only `src/auth0-resource.ts` and its test after verifying the staged diff.

## Task 2: One listener, two paths

- [ ] Add failing HTTP tests in `src/mcp-http-auth0.test.ts` for `GET /.well-known/oauth-protected-resource/antigravity/mcp`, an anonymous POST to `/antigravity/mcp` returning 401 with that local PRM URL, valid local JWT access to `auth.whoami`, and 401 for local token on `/mcp` and primary token on `/antigravity/mcp`. Assert the existing `/mcp` PRM and challenge remain unchanged.
- [ ] Run `npx vitest run src/mcp-http-auth0.test.ts`; expect the new path tests to fail with 404 before implementation.
- [ ] Update `src/mcp-http.ts` to derive a fixed channel from `requestUrl.pathname`: `/mcp` is primary, `/antigravity/mcp` is local only when configured, all others 404 except exact PRM routes. For local 401, form `http://127.0.0.1:8789/.well-known/oauth-protected-resource/antigravity/mcp` from the validated request host; retain the primary ChatGPT challenge behavior. Use `auth0.metadata(channel)` and `auth0.verifyAccessToken(bearer, channel)`; never select a channel from user agent, body or token claims. Keep the existing trusted research session/owner execution context.
- [ ] Run `npx vitest run src/mcp-http-auth0.test.ts src/auth0-process.test.ts src/mcp-http.test.ts`; expect pass. Run `npm run build`; expect exit 0. Commit only owned source, tests and matching generated outputs after checking staged paths and secrets.

## Task 3: Auth0 and Windows client rollout

- [ ] Inspect the current live process, listener, tunnel health, Auth0 app/API settings, and both Antigravity MCP configs without printing secrets. Confirm the other repository task has no active rollout/restart. Keep all private backups outside Git and the NAS.
- [ ] In Auth0, create one new local API with the exact identifier `http://127.0.0.1:8789/antigravity/mcp` and scope `mcpvault:research`, and one public Antigravity client with only `https://antigravity.google/oauth-callback`. Restrict the new API to that client and the already approved research user. Do not enable open registration, DCR, M2M or a client secret. If the dashboard cannot express this boundary, stop and report it.
- [ ] Extend the owner-private Auth0 config with `localResource` and `antigravity-claude-sonnet` in allowed labels, preserving the current issuer/resource/subject/account. Restart the single MCPVault process only after safe coordination. Test unauthenticated local PRM/401 and existing tunnel behavior. On failure, restore the private config backup and previous build; do not touch Vault data.
- [ ] Back up Antigravity's global and workspace `mcp_config.json`, disable their old `llm-wiki` stdio entries, and add one `llm-wiki-oauth` entry with `serverUrl` set to the exact local URL and `oauth.clientId` set to the new public client ID. Authenticate through Antigravity's UI; the user enters credentials and authorization code directly. If public client PKCE is unsupported, restore configs and stop without storing a secret.
- [ ] Verify `auth.whoami` reports `research-agent`, then use one bounded `claude-sonnet-4-6` CLI call to read the introduction and create exactly one greeting comment. Reread comments and record its ID. If the write outcome is uncertain, reread before retrying. Check ChatGPT `llm_wiki` again. Remove the disabled stdio entry only after both paths work.

## Final verification

- [ ] Run the complete relevant test suite because this changes authorization and the shared transport; record counts and exit codes. Run `npm run build`, `git diff --cached --check`, review staged paths, and scan staged content for secrets. Preserve the other agent's modified files and generated outputs; do not stage them.
- [ ] Report the single server PID/port, both connector statuses, Auth0 login result, greeting comment ID, changes committed/pushed under the existing fork policy, and any unverified or blocked step. Never equate a saved MCP config with a connected client.
