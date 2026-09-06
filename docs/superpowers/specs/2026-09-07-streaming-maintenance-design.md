# Bounded Maintenance Body Consumption

Goal-approved design/main integration. No new client setup, processes, caches or
live Vault mutations. Previous increment is verified progress, not a blocker.

## Evidence and alternatives

`maintenanceDebt` requests `iterateNotes(includeContent:true)`, which asks
`queryNotes` to hydrate a whole 500-row page with Promise.all. IO execution is
coordinated, but completed bodies remain retained until the whole page returns.
The selected repair candidates are then reread, and their *new* revision can be
attached to reasons computed from the old content.

Metadata-only classification was considered, but fresh `readNoteMetadata` itself
reads/parses the whole source. Hydrating body-dependent rows afterward can double
IO. Another persistent cache risks stale authority. Instead add a bounded body
iterator: metadata pages of 500, body groups of four, consume one group before
starting the next. Four retains modest IO overlap without a 500-body queue.

## Contract

- New internal `iterateNoteBodies` in paged-query.ts reuses cursor semantics,
  query validation and readQueryNoteBody revision/path guards. No MCP endpoint.
- Request metadata only, apply caller visibility at query and hydration. For
  each four-row group await allSettled before yielding any or throwing the first
  failure in input order. No next group starts on failure/consumer early return.
- File size remains the existing MAX_NOTE_CONTENT_BYTES per body. This bounds
  hydrated groups, not total RSS or metadata size. Freshness reads still cost IO.
- Maintenance excludes moderation-hidden rows and keeps ordinary classification,
  ranking, response limits and no-write behavior. Capture each evaluated revision
  internally; selected candidate's fresh metadata may authorize a curation plan
  only if revision is unchanged. A changed/removed candidate remains advisory
  without a revision-safe mutation plan; hidden current candidates are omitted.
- This is not an atomic whole-Vault snapshot, nor a fix to every body consumer.

## Verification

Use real temporary Markdown, indexed and unindexed runs. Measure issued body
hydration via real IO hooks; show no full-body query page and at most four active
hydrations. Cover summaries, MOCs, Inbox/project/literature reasons, scope and
moderation visibility, metadata-to-body races, delayed failed siblings and early
return. Test changed selected revisions never receive new write authorization.
Build, focused/full one-worker tests, independent integrity review, fork push.
