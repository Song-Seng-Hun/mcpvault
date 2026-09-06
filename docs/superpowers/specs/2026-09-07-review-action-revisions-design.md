# Preserve evidence revisions in review action routing

The user delegated design approval and fork-main publication.

## Evidence and choice

`reviewPacket` discards producer revisions while combining reasons, uses a
potentially cached candidate metadata read, then loads the selected full body
only to replace its revision. Recall questions and private state can therefore
remain from an older observation while the mutation is assigned a newer source
revision. It similarly refreshes a recall repair revision without checking the
original repair basis. Errors are swallowed, retaining misleading priorities.

Options: add a request cache (risks hiding drift), optimize only the final body
read (leaves mixed revisions), or retain producer revisions and use fresh bounded
metadata plus final guards. Choose the third. No persistent cache or new worker.

## Contract

- Track valid source revisions carried by each admitted producer row. A note
  with inconsistent observations must trigger a bounded generic refresh error,
  never a newer guard attached to an older question or reason.
- Read candidate metadata with fresh/strict options and the existing 8 MiB cap;
  reject newly hidden/deleted admitted targets before emitting their old details.
- Construct selected action plans from the already admitted metadata instead
  of a full body read and redundant existence probe.
- Validate caller-private recall state, including `missing`, against the queue
  observation. Validate recall date-repair metadata against its original guard.
- Recheck admitted candidate revisions before returning, using hash-only bounded
  revision reads; recheck access predicates too. Do not replace old guards.
- Keep routing priorities, snooze handling, fixed MCP tools and output budgets.
  All producers still own their advisory findings; revisionless producer reasons
  are not retroactively certified by a metadata read. This is not an atomic
  inventory transaction or revalidation of every supporting graph reference.
- Errors reject the packet without echoing paths/content. No live Vault/config
  writes, server restarts, process termination or client installations.

## Verification

Real temporary Vault tests wrap the real recall queue and change source, private
state, absent state and repair metadata after queue production. All must reject
instead of returning mixed revisions. A narrowly isolated orchestration fixture
uses real storage to count final metadata/hash reads without unrelated graph
work. Preserve ordinary recall and non-recall plans, snoozes, read budgets and
MCP integration via existing suites. Run build, full one-worker tests and diff
check before committing source/dist together and pushing the user fork.
