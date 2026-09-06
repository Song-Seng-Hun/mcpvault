# Bounded change-set sources

## Evidence and scope

`patchMultipleNotes` constrained outgoing notes, patch text and responses, but
all four source-read stages could read arbitrarily large files: initial
preflight, whole-batch revision check, individual write check, rollback.
This affects reciprocal relations, MOC ordering and Property/lifecycle plans
that execute via `notes.change_set`.

Three tests failed on the baseline: an oversized YAML original was accepted
when removing the large Property, successful applies made six unbounded reads,
and rollback read an oversized external replacement without a cap.

## Change

Use the existing 8 MiB note limit during initial parsing and every subsequent
source check. Post-preflight checks call `readBoundedSource` directly so they
cannot join a prior in-flight read through the shared I/O coordinator. Existing
revision comparisons, response admission and conservative rollback ownership
remain unchanged. No new endpoint or client configuration is required.

No truncated Markdown reaches a parser or ownership comparison. An oversized
external replacement is preserved and recovery reported as incomplete. Initial
oversized notes can no longer be shrunk through this operation; deliberate
external splitting/repair is required first. Per-note byte/source-count limits
do not bound all parsed/planned/rollback JavaScript allocations. This does not
close external check/write races or provide OS-wide atomicity.

## Verification

Targeted suites: 21 passed, including six new tests for oversized originals,
all successful read stages, rollback ownership, growth at both recheck stages,
and an exactly-8-MiB multibyte note with complete revision/bounded response.
`npm run build` passed. Final complete suite: 1,790 passed, one skipped across
134 files (78.01 seconds), after the endpoint description was updated as well.
`git diff --check` passed. A focused independent read-only review found no
actionable issue with the four read sites or revision/rollback semantics.

Isolated compiled MCP smoke verified five fixed tools, authenticated change-set
dry-run/apply, exact per-file receipts, bounded response, oversized-original
rejection without mutation, and capability discovery showing the byte limit
and split/repair guidance. No running user Vault or server was changed.
