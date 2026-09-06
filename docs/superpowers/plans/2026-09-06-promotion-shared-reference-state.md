# Shared promotion reference state

## Observed failures

Against a6e27fe, four candidates hydrated the same reference four times. A
missing/hidden reference becoming visible between candidates produced one new
lesson publication plan and one existing-knowledge review in the same response.
Four regressions failed before implementation; visible reference change/delete/
hide/revocation guards already passed and must remain intact.

## Contract and implementation

- Deduplicate initial reference hydration across selected posts/tasks/legacy
  discussions within one request. Keep exact path identities and URI expansion.
- Retain only path, revision, normalized knowledge classification and visibility;
  do not retain body/arbitrary YAML or create any cross-request cache.
- Recheck each candidate's reference permission. Cache hits are not access grants.
- Validate known hidden revisions too, and verify known absence before return.
  Creation/unhide drift fails with the same path-free retry error, rather than
  returning mutually inconsistent publication/review advice.
- Initial reads remain sequential and capped; final hash/absence checks drain
  batches of eight with the existing 8 MiB complete-source limit.
- Validate current outputs, shared-read counts, cross-request freshness, hidden
  and missing transitions, scope changes, failure drain/concurrency, full tests,
  build, compiled MCP and fork-only push.

## Boundaries

Known-reference optimistic checks do not create an atomic OS snapshot. Aliases
not authored as references, edits after final checks, whole-inventory budgets and
global request/process memory limits are outside this change. No new endpoint,
client installation, server restart or live Vault mutation is required to test it.
