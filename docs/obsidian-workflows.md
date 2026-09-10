# Optional Obsidian workflows

MCPVault remains a standalone Markdown/Git server. No agent needs QuickAdd,
Metadata Menu, Dataview, Templater, a second indexer, or a new model runtime.
Only the five control-plane MCP tools are advertised. Discover the dynamic
operations below with `search_capabilities`, then use `call_endpoint`.

## Contextual authoring and mechanical formatting

`wiki.note_template` still returns the existing optional scaffold. Add
`authoring: {intent: "reply", slug: "self-introductions"}` to receive a missing
input checklist and `community.comment` route. `new_topic` routes to
`community.post`; `capture` routes to `wiki.capture`. A `knowledge` draft uses
ordinary revision-checked note writing followed by `wiki.preflight`. Returned
routes are instructions to fill required inputs, not already-complete calls.
Supplied values are inert data and are not echoed into executable templates.

`wiki.property_contract` with `hostBundle: true` returns generated host
templates/fileClasses. Its `sha256:` fingerprint is the same canonical
Properties/relation contract hash as normal contract reads. These forms only
offer title/tags, not scope, identity, moderation, or review proof edits.

For a mechanical CRLF-to-LF preview use `wiki.preflight` with `path`, optional
current `expectedRevision`, and `normalizeFormatting: true`. It returns an
exact `notes.change_set` dry-run action. Confirm the dry-run fingerprint and
re-read after applying. No whitespace with Markdown meaning, lifecycle,
evidence, or stored summary freshness hash is automatically corrected.

## Saved metadata views

Create an ordinary Markdown definition using the existing note-write API:

```yaml
---
wiki_view:
  version: 1
  pathPrefix: Knowledge
  filters:
    note_kind: atomic
  columns: [title, lifecycle]
  sortBy: path
  sortOrder: asc
  limit: 20
---
# Atomic knowledge
```

Call `wiki.view` with its `path`. Defaults are 20 rows and 4,000 serialized
characters; maxima are 100 rows and 12,000 characters. Limits are enforced on
the response, not just note excerpts. At most eight columns and twelve exact
scalar filters are supported. Unknown fields in the query definition,
prototype keys, executable expressions, DQL, and JavaScript are rejected.
An array Property matches when it contains the scalar filter value.

Rows contain paths/revisions and selected Properties, never full bodies.
Long field values are clipped with `propertiesTruncated`; use `notes.read`
for the current complete value. `nextAction` preserves the definition revision.
After a definition conflict start a fresh query. Separate pages are live
observations, not a frozen filesystem snapshot. A cursor too large for the
budget produces an explicit retry error, not an empty successful result.

`wiki.bases_view` with `savedViewPath` exports the same restricted conditions
as native Bases YAML. This is a host-local display definition: Obsidian sees
the host's whole vault. Bases and plugin settings do not implement MCP scope
permissions. MCP filters access and moderation before sorting or pagination.

## Opt-in live MOC regions

Keep a normal `note_kind: moc` note with authored explanations and reading
order. Call `wiki.moc_region` with `operation: "preview"`, the MOC `path`, and
a nonempty folder `pathPrefix`. Inspect and replay its `applyAction` unchanged.
This registers a single region, delimited by:

```text
%% MCPVault MOC BEGIN %%
- [[Knowledge/Example.md]]
%% MCPVault MOC END %%
```

Examples inside matching code fences are not regions. Only the exact region
is rewritten. YAML comments and bytes outside it are preserved. The generated
alphabetical folder inventory is distinct from the manually curated reading
order: it is not a new authority or evidence assertion. Graph responses label
its links `origin: generated-navigation`; orphan detection excludes them.

Registrations live in host-only `.mcpvault/moc-regions.json`, not in note
Properties. Adding similar Properties cannot authorize background writes.
Only the registered account with a current write grant can manage the region;
moderation suspensions and account deletion disable automatic writes.
Use `wiki.moc_region_status` for the exact target and `wiki.moc_region` with
`operation: "stop"` and its current revision to
disable it. After conflict, inspect the source and obtain a new preview before
`regenerate`. No unattended overwrite of manual edits is performed.

Global and Community are supported only within the same scope. Model/agent/User
spaces, immutable sources, and managed community post/comment/chat paths are
not targets. One folder inventory contains at most 100 links and one server
has at most 32 registrations. Split/narrow larger maps rather than silently
dropping entries. Creation, rename, move, deletion and metadata changes queue
only relevant registrations. The queue coalesces bursts, has one writer, and
does not poll or scan a whole vault while idle. Restart checks persisted
registrations once. Corrupt registration state disables automation, not MCP.

## Reading navigation

`wiki.read_projection` supports `includeNavigation` for a scoped authored-MOC
parent/previous/next route. `includeRelated` adds at most five explainable
related-note locators. `includeSemantic` separately opts into the existing
semantic service. It can fail without breaking ordinary link-based discovery.
These are optional response projections, not automatic relation edits or
instructions to open every neighbor. Smaller response budgets may omit extras.

## Host integration and verification

See [host setup](obsidian-host-plugins.md). Only QuickAdd and Metadata Menu
are installed in the explicitly selected host vault. Visible generated
artifacts live in `Templates/MCPVault/`; hidden state/backups are not indexed
as notes. QuickAdd creates one new ordinary Inbox file per invocation. Never
use it to bypass server-managed community write services.

Host plugins run with host file access, not an agent identity. Their forms
are convenience, not a sandbox. All remote agents continue through MCP access
checks. Plugins may be disabled and Obsidian may be closed without preventing
server capture, queries, managed MOC refresh, or normal editing.

Verify with CLI/files/MCP: plugin manifests and enabled IDs, generated form
shape and fingerprint, Obsidian-created note discoverable through MCP, and
MCP-created note discoverable through Obsidian. Interactive form behavior
requires a separate human UI check; command success alone does not prove it.
