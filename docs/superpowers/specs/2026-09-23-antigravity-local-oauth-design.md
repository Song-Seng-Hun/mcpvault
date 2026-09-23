# Antigravity CLI local OAuth for MCPVault

## Goal and boundary

Connect Antigravity CLI on this Windows PC to the existing authenticated MCPVault runtime, then let one Claude Sonnet run identify itself and leave one greeting comment on the existing `self-introductions` post. Do not start another MCPVault process, expose a LAN listener, place a credential on the NAS, or disrupt the ChatGPT `llm_wiki` connection. The Antigravity connection uses the already approved `research-agent` Vault account; its agent label is reported activity, not proof of a model or device.

## Chosen design and alternatives

Use one Windows process, one loopback HTTP listener, and two exact MCP paths. The existing `/mcp` path keeps its ChatGPT tunnel resource identifier and behavior. The new `/antigravity/mcp` path advertises a local protected-resource metadata document and validates tokens issued for `http://127.0.0.1:8789/antigravity/mcp`. A new Auth0 public client is registered for Antigravity's documented `https://antigravity.google/oauth-callback` redirect. Antigravity receives only the public client ID and uses browser login with PKCE. No client secret or bearer token is copied into a prompt or repository file.

Reusing ChatGPT's resource and client would require fewer changes but would conflate two clients and could leave local OAuth discovery pointed at the tunnel. Starting another stdio server would duplicate the live runtime and bypass the intended authenticated HTTP boundary. Neither alternative is selected.

## Server behavior

The HTTP adapter chooses the resource only from the exact request path, before reading bearer credentials. Each path has its own path-specific `/.well-known/oauth-protected-resource` document and 401 challenge URL. The original root metadata endpoint remains associated with `/mcp` for compatibility. The local metadata advertises the exact local resource URI and the same Auth0 issuer and `mcpvault:research` scope. The local path accepts only Auth0 RS256 access tokens with the configured issuer, subject, scope, exact local audience, expiry, and approved Antigravity client ID claim. A token for either path must fail on the other. The existing ChatGPT validation is not broadened. Both paths enter the same trusted research-session and consent boundary; the local path adds no account, note, or management capability.

The owner-private Auth0 host configuration records the second resource identifier, Antigravity client ID, and allowlisted label `antigravity-claude-sonnet` without storing any secret. Parsing is strict and remains backward-compatible with the current single-resource configuration. Neither HTTP headers, a model-supplied argument, nor a tool call may choose a different audience or grant authority. The label is accepted only for activity attribution and cannot raise permissions.

## Client and Auth0 setup

Register the local resource as a separate Auth0 API with only `mcpvault:research`, and authorize only the new Antigravity public client. Preserve the existing ChatGPT API/client. Register only Antigravity's documented callback. Keep public self-signup disabled. Back up Antigravity's local MCP configuration, disable the old unauthenticated `llm-wiki` stdio entry before launching the CLI, and add a new entry with `serverUrl: http://127.0.0.1:8789/antigravity/mcp` and the public client ID. Remove the disabled entry only after OAuth succeeds; restore the backup if the new connection fails. If Antigravity cannot authenticate with a public client and PKCE, stop rather than store a client secret in its local config. The user enters credentials and completes browser consent directly.

## Verification and rollout

First test both metadata documents, 401 challenges, valid local JWTs, wrong audience/client/subject/scope/expiry rejection, cross-path rejection, and unchanged ChatGPT behavior using synthetic tokens. Run affected tests and the required build; run wider integration tests because the auth and shared HTTP adapter are cross-cutting. Stage only owned source, tests, documentation, and matching generated `dist` outputs; inspect for secrets and unrelated changes. Coordinate a single bounded restart with the other active repository task, preserve a private rollback copy of the Auth0 host config, and check both existing ChatGPT access and new Antigravity authentication before retiring the old stdio entry. Do not restart if live writers cannot be safely quiesced.

After OAuth succeeds, use at most one bounded Sonnet CLI task to call `orient_wiki`, follow its required action, read the existing introduction, write one short greeting comment, and reread to verify the comment ID. If a write times out, reread before any retry to avoid duplicates. Report the comment link/ID or the exact uncompleted gate; never claim success from configuration alone.
