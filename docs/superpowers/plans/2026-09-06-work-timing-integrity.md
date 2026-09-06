# Workflow timing must have authored evidence

## Reproduction and scope

Flow substituted updated_at for missing waiting_since/blocked_since, and
Reflect did the same for waiting follow-up. A task merely edited in 2000 was
reported as waiting/blocked for 9,745 days. Date.parse also treated "1" as a
date, and future authored starts became age zero through clamping.

Use one read-only elapsed-age calculation over the existing ISO-date contract.
Only matching authored timing evidence counts; absent, malformed or future
timestamps are unknown. Never infer from file/creation/Git dates or mutate
notes to fill dates. Preserve raw scalar locators for inspection, existing
workflow holds, access filters and bounded projections. missingTimestamps
means missing usable evidence, not necessarily an absent YAML key. No new
endpoint, mandatory Properties, persistence layer or scheduler.

## Verification

- RED: 16 failed, 8 control cases passed. Missing evidence, non-ISO strings,
  malformed YAML values and future dates produced false ages.
- GREEN: 41 tests passed across timing integrity, flow budgets and action
  readiness after removing fallbacks and sharing the calculation.
- Actual five-tool MCP tests cover 512/1024/16000 characters, hidden-note
  isolation and non-mutating reads. Timing + flow budget suite: 33 passed;
  timing + Reflect budget suite: 38 passed.
- Independent read-only review found no actionable issue; worker closed.
- Build and compiled isolated MCP smoke passed: unknown absent/future timing,
  consistent 20-day Flow/Reflect age after adding explicit waiting evidence,
  bounded output and preserved source on reads. No live Vault was modified.
- Full suite: 2,087 passed, one skipped across 144 files (83.97s).
  git diff --check passed. This is one verified improvement, not completion
  of the broader organization goal.

## Follow-up evidence, not claims of completion

While inspecting compact Reflect output, found readAction in
src/review-dashboard-packet.ts sends notes.read without expectedRevision even
though the same row carries revision. Audit its compact and tiny focus paths
next; that recovery guard is separate from this timing fix.
