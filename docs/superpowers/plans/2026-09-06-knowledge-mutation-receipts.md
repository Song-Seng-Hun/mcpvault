# Knowledge mutation receipt consistency

## Reproduced problems

Five real external-editor interleavings failed against `abe65d1`: ordinary and
related-guarded knowledge publishing, triage, note review, and claim review.
Post-write reads returned another edit's revision. Triage also returned that
edit's lifecycle; note review mixed the first outcome/count with another
reviewer's name and could omit required lifecycle follow-up.

## Implementation

- Keep filesystem serialization, write locks, related-note assertions, source
  protection, validation, and notifications shared with existing mutation APIs.
- Preserve the existing void contracts; offer internal guarded-write and
  Properties-write receipts for consumers that return mutation results.
- Capture exact serialized content internally. Public receipts never include
  raw bodies. Properties receipts parse that captured string so YAML removals,
  replacement, and preservation semantics match the actual write.
- Use these receipts in the five paths above, including their returned cleanup
  revision guards and lifecycle-derived review advice.
- No new MCP tool/endpoint, server restart, migration, history store, or client
  configuration. No claim of cross-process atomicity or global snapshot impact.

## Verification requirements

- Real external-write races for all five paths, with stale follow-up rejection.
- Preserved/replaced/initial Properties, undefined removals, own-write parsing,
  no raw-body receipt output, legacy void results, stale/denied write rejection.
- Guarded stale-source rejection and existing multi-path lock identity coverage.
- Targeted tests, build, full suite, compiled MCP smoke, independent review,
  diff check, generated dist, user-fork-only commit/push.

Verified: all five workflow races failed before the fix; 54 focused tests and
the full suite passed (1,544 passed, one skipped, 115 files). Build passed.
Compiled MCP publish/triage/review/claim-review responses matched their writes,
omitted raw bodies, remained 196–485 characters in the fixture, and rejected a
stale follow-up; the five-tool surface remained unchanged. The temporary
Vault/account was removed. Astra found no actionable regression and independently
passed 46 receipt/lock/Properties tests; that reviewer was closed.

## Remaining scope

Other services and adapters have not all been migrated. Audit their individual
contracts rather than mechanically replacing current-state reads. In particular,
downstream queries are live advisory projections, not transaction members.
