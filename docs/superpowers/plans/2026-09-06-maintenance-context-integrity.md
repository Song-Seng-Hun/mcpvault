# Maintenance context and guarded note reads

## Evidence and contract

Summary candidates and daily rediscovery used ad hoc blank-block parsing that
included fenced examples or title syntax, or fell back to the entire raw body.
Use the common physical-line paragraph projection. Prefer verified nonempty
stored summaries; otherwise identify a body excerpt and its range, or explicitly
return no context. Never rewrite authored summaries/fingerprints as a side effect.
Compact reports preserve the exact revision-pinned inspect action.

Actual MCP tests then showed that notes.read ignored expectedRevision entirely.
Its knownRevision fast path also bypassed current moderation checks. Read one
current snapshot, check visibility, validate the strict snapshot guard, and only
then suppress unchanged bodies using the cache hint. A conflict cannot return
current content or be bypassed by a matching hint. Pin truncated-note recovery
too, preserve full identities, and keep recovery endpoint budgets valid.

No new MCP tools, external client components, background writes, or live Vault
changes. Response limits are not source-I/O caps; paragraph extraction is not a
full Markdown renderer. Source hashes establish snapshot identity, not truth.

## Verification

- Eight service regressions failed before the candidate projection fix.
- Actual MCP candidate navigation exposed five failures in the missing guard
  and cache/moderation path. Expanded RED suite: nine failed, 31 passed.
- After the implementation: 93 targeted tests passed across candidate,
  retention/rediscovery and MCP excerpt suites.
- Build passed. Full suite: 1,905 passed, one existing skip, 139 files,
  81.15 seconds. Nineteen new tests cover candidate extraction/freshness,
  code-only contexts, snapshot conflicts, cache-hint precedence, malformed
  guards, moderation, long identities, and guarded truncated-note recovery.
- Compiled five-tool MCP smoke passed both candidate routes, physical ranges,
  fenced/Setext exclusions, 512-character inspect actions, changed-source cache
  rejection and hidden-source denial. Its initial import used the wrong dist
  directory and failed before creating a fixture; rerunning with the verified
  dist/src/createServer.js entry passed. The isolated temporary Vault was removed.
- Focused independent read-only review found no new actionable issues after
  the real notes.read guard fix. Reviewer closed. No live Vault/server changed.
