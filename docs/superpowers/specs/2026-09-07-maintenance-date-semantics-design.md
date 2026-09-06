# Maintenance Date Semantics

Goal-approved continuation, fork main only. Prior parity work was fully verified
and pushed. Reuse existing strict organizationDateTimestamp; no new parser.

maintenanceDebt currently calls Date.parse(String(value)) and uses truthy date
fallbacks. Arrays, natural-language dates, impossible days, null and blank values
can become an apparent old source, elapsed review deadline or absent history.
Other organization queues already treat malformed dates as unknown.

Validate authored created_at/updated_at on all notes; review_at and
last_reviewed_at on knowledge rows. Emit bounded invalid_<field> reasons for
present invalid values, with one six-point repair weight per note. Absence means
undefined only. Prefer updated_at when present, even if invalid; only absence
permits created_at fallback. No unknown date yields an age or overdue reason.
Only absent last_reviewed_at can prove missing review history. Explicit invalid
history stays a date repair instead. Real valid/missing behavior remains intact.

Prioritize exact-source date inspection then revision-safe dry-run notes.patch
before any automatic-looking review route. Tell agents to use evidence and not
invent history, change dates to clear the queue or weaken holds. Do not echo raw
invalid values, rewrite notes or add a new endpoint. Counts, hidden guards,
bounded output and the evaluated-revision barrier are unchanged.

Ignoring invalid values would hide repair debt; coercion would invent chronology.
The chosen explicit repair reason avoids both. This does not assess whether a
syntactically valid date is factually true or all date relationships are coherent.

Test real temporary notes and MCP output: malformed value table, undefined vs
null fallback, missing vs invalid review history, valid leap day/UTC offsets,
independent valid dates, small response bounds, hidden/private records, no writes.
Build, targeted/full one-worker tests, independent review, explicit fork push.
