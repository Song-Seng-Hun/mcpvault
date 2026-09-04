# Authority Shelf Browsing and Close-Match Relations

Date: 2026-09-04
Status: Approved design, awaiting implementation plan

## Purpose

MCPVault already records controlled vocabulary metadata through
`preferred_term`, aliases, `authority_scheme`, `authority_id`, broader terms,
related terms, and stable IDs. This change turns those isolated fields into a
bounded, scope-safe browsing mechanism analogous to a library shelf: an agent
can find a classified note, inspect nearby notes in the same scheme, and follow
explicitly typed near-equivalence without treating similarity as identity.

The design extends the existing `wiki.authority_map` endpoint and existing
derived metadata index. It does not add another fixed MCP tool, another server,
or another source of truth. Markdown, YAML Properties, Obsidian links, current
revisions, and Git remain authoritative.

## Goals

- Browse one authority scheme in natural `authority_id` shelf order.
- Request a bounded window around a known authority ID.
- Detect visible scheme-local ID collisions and malformed authority metadata.
- Express reciprocal near-equivalence with `close_match` without weakening
  `same_as` or overloading `related`.
- Make authority expansion useful in search while explaining why each result
  was included and how strong the expansion is.
- Reuse incremental disposable indexes so a request does not reparse the whole
  Vault.
- Preserve all existing scope, output-size, revision, and read-only guarantees.

## Non-goals

- Automatically merge, move, rename, delete, or reclassify notes.
- Infer `same_as` or `close_match` from embeddings alone.
- Replace folders, links, MOCs, semantic search, or ordinary text search.
- Introduce a database or background service that must be separately operated.
- Expose hidden note existence through counts, collisions, suggestions, cache
  keys, ambiguity details, or neighborhood gaps.
- Make classification metadata an access-control mechanism.

## Authority identity model

`authority_scheme` names a classification or authority system.
`authority_id` is the scheme-local classification/call-number identity. The
pair is the identity; the ID is not globally unique.

Examples:

```yaml
authority_scheme: llm-wiki-topics
authority_id: AI.12.3
```

Rules:

1. `authority_id` requires a non-empty `authority_scheme`.
2. Within the caller-visible note set, one `(authority_scheme, authority_id)`
   pair should resolve to exactly one canonical note.
3. The same `authority_id` may be reused by another scheme.
4. Scheme and ID comparisons use a documented normalized comparison key while
   preserving the authored display value.
5. Shelf ordering is natural and locale-stable: digit runs compare numerically,
   text runs compare case-insensitively, and normalized path is the final stable
   tie-breaker. Notes without an ID appear after classified notes in title/path
   order only when the selected view allows unclassified entries.
6. Authority metadata is advisory organization data. It cannot grant access or
   override scope policy.

## Relation semantics

Add `close_match` to the typed relation vocabulary.

- `same_as`: exact identity or interchangeable concept under the recorded
  evidence.
- `close_match`: reciprocal near-equivalence; useful for translation,
  neighboring taxonomies, historical terminology, or concepts that are close
  enough for discovery but unsafe to merge.
- `related`: general reciprocal association with no equivalence claim.

`close_match` is reciprocal. The relation planner must use the existing
revision-safe two-note change-set workflow and propose the reverse edge. It
must never silently upgrade `close_match` to `same_as`, merge records, or copy
private content. Fence-aware parsing must ignore examples in matching backtick
or tilde fences.

## `wiki.authority_map` contract

The existing endpoint gains optional inputs while retaining current inputs and
defaults:

```ts
{
  query?: string;
  scheme?: string;
  aroundAuthorityId?: string;
  includeUnclassified?: boolean;
  limit?: number;
  maxChars?: number;
  accessToken?: string;
  prettyPrint?: boolean;
}
```

Behavior:

- With no `scheme`, preserve the current bounded cross-scheme authority map.
- With `scheme`, return only caller-visible notes in that scheme, ordered by
  natural `authority_id` shelf order.
- `aroundAuthorityId` requires `scheme`. It selects a bounded contiguous window
  centered on the exact ID when present, or on its natural insertion point when
  absent. The response states which case occurred.
- `query` filters within the authorized selected population; it does not cause
  an unrestricted second scan.
- `includeUnclassified` is false by default and is meaningful only where the
  response mode can include notes without `authority_id`.
- Existing `limit` and `maxChars` ceilings remain enforced after projection.
- The response includes compact entries, continuation information, ordering
  metadata, and visible-only integrity issues. It does not include full note
  bodies.
- Invalid combinations such as `aroundAuthorityId` without `scheme` fail with a
  stable actionable error.

Representative response shape:

```json
{
  "scheme": "llm-wiki-topics",
  "order": "natural_authority_id",
  "anchor": {
    "requested": "AI.12.3",
    "matched": true
  },
  "entries": [
    {
      "path": "Knowledge/Example.md",
      "title": "Example",
      "authorityId": "AI.12.3",
      "preferredTerm": "Example",
      "revision": "..."
    }
  ],
  "issues": [],
  "truncated": false
}
```

Exact field naming may follow current endpoint conventions, but the semantics,
bounds, and visibility requirements above are acceptance requirements.

## Incremental metadata index

Extend `VaultMetadataIndex`; do not create a parallel parser or daemon.

Each indexed visible-candidate record may derive:

- normalized authority scheme;
- authored and normalized authority ID;
- natural-sort tokens;
- normalized preferred term and aliases;
- broader, related, `same_as`, and `close_match` targets needed for authority
  discovery.

Maintain disposable lookup structures for:

- scheme to paths;
- `(scheme, authority_id)` to paths;
- authority term to paths;
- relation target to paths where required by existing graph/backlink APIs.

File create, update, move, delete, and metadata invalidation must update these
structures through the existing invalidation path. Binary snapshots may store
the derived records, but snapshot versioning must invalidate incompatible old
data. Cache entries must remain bounded and must not grow per principal without
an eviction policy.

Every query applies the caller access predicate before it computes result
counts, collisions, neighborhoods, insertion points, or ambiguity details.
Hidden candidates therefore behave exactly as nonexistent candidates.

If an index is absent, stale, corrupt, or rebuilding, the feature may use a
bounded safe fallback or return a retryable degraded-state response. It must
not crash the MCP server, skip access checks, or silently return an unbounded
full-Vault scan.

## Search integration

When authority expansion is enabled, search may add candidates from explicit
authority metadata in this order of interpretive strength:

1. exact preferred term or alias;
2. exact scheme and authority ID;
3. `same_as`;
4. `close_match`;
5. broader/narrower authority relation;
6. general related term.

Every expanded result includes a compact machine-readable and human-readable
match reason, the source relation, source path or authority pair when visible,
and a conservative confidence class. `close_match` must rank below `same_as`
and must be visibly labeled as near-equivalence. Text and semantic evidence may
affect normal ranking but cannot fabricate an authority relation.

Expansion remains subject to the search result count, per-snippet, and total
character limits. A hidden source relation cannot cause a visible candidate to
receive a reason that reveals the hidden source.

## Graph, backlinks, and reciprocal planning

- Add `close_match` to the central typed-relation registry and relation
  semantics.
- Include its outgoing and incoming edges in `VaultGraphIndex` and bounded
  backlink projections.
- Mark it reciprocal in the existing reciprocal-link planner.
- Use the same access filtering for graph traversal and ambiguity reporting as
  for all other typed relations.
- Keep `related_terms` compatibility as authority vocabulary metadata; do not
  silently rewrite it into `close_match`.

## Lint and maintenance

Add bounded, actionable diagnostics for:

- `authority_id` without `authority_scheme`;
- duplicate visible `(authority_scheme, authority_id)` pairs;
- malformed scalar/list shapes or empty values for authority properties;
- unresolved or ambiguous visible `close_match` targets;
- missing reciprocal `close_match` edges;
- contradictory exact identity where a pair is authored simultaneously as
  `same_as` and `contradicts`, if the existing relation-conflict framework can
  report this without speculative inference.

Diagnostics return only visible paths and bounded examples. Repair remains an
explicit dry-run/change-set operation using expected revisions; lint must not
mutate notes.

## Portable organization manifest

Bump the organization manifest from version 5 to version 6. Version 6 declares:

- the authority scheme/ID pair semantics;
- natural shelf-order semantics;
- the `close_match` relation and reciprocity;
- the distinction among `same_as`, `close_match`, and `related`.

Import and sync treat remote manifests and notes as untrusted. Version
negotiation must reject or downgrade unsupported semantics explicitly rather
than treating `close_match` as exact identity. Provenance and scope remain
attached across Global synchronization. Community, model, agent, and host-only
User material must not become synchronizable because it carries an authority
ID.

## Compatibility and migration

- Existing notes without authority metadata remain valid.
- Existing calls to `wiki.authority_map` retain their bounded behavior.
- Existing `related`, `same_as`, `broader_terms`, and `related_terms` data keep
  their authored meanings.
- No eager Vault rewrite is required. Authors can add `close_match` and complete
  scheme/ID pairs incrementally.
- Existing version-5 manifests are readable under existing compatibility rules,
  but exporting the new contract emits version 6.
- Derived index and snapshot format changes trigger rebuilds, not note changes.

## Security and failure handling

- Normalize and validate every path and relation target through `PathFilter`
  and the caller access predicate before resolution.
- Do not reveal hidden notes through collision cardinality, missing shelf
  positions, match reasons, autocomplete, timing-oriented cache reuse, or error
  messages.
- Treat all property values and remote manifest text as untrusted data; never
  execute embedded instructions.
- Bound all arrays, snippets, diagnostics, graph edges, and serialized output.
- Add any new mutating operation to the read-only rejection set and capability
  model. This design expects no new mutation endpoint; it extends existing
  relation/change-set operations.
- Preserve expected-revision checks for reciprocal edits and concurrent
  authority metadata changes.
- Index corruption or semantic-search failure degrades the affected projection,
  not the server or authoritative Markdown.

## Verification and acceptance criteria

Implementation is complete only when tests demonstrate:

1. Scheme filtering and natural shelf order for mixed numeric IDs.
2. Exact-anchor and missing-anchor neighborhood windows.
3. Stable rejection of `aroundAuthorityId` without `scheme`.
4. `limit` and `maxChars` bounds under large or adversarial metadata.
5. Same-scheme collision detection and legal cross-scheme ID reuse.
6. No collision counts, anchor effects, reasons, or graph edges from hidden
   scopes.
7. Incremental create, update, move, and delete invalidation with no orphaned
   authority index entries.
8. Corrupt/stale snapshot recovery without server failure.
9. `close_match` graph and backlink visibility, reciprocal planning, missing
   reciprocal lint, and expected-revision conflict handling.
10. Search expansion ranks and labels `same_as`, `close_match`, broader, and
    related matches distinctly while obeying all bounds.
11. Manifest version 6 export and safe older-version compatibility behavior.
12. Read-only mode continues to reject every mutation while allowing these
    projections.
13. Targeted tests, `npm run build`, full `npm test`, and `git diff --check`
    succeed; committed `dist/` matches source.

## Documentation requirements

Update `_wiki/SCHEMA.md`, `README.md`, the bounded `wiki.policy` knowledge and
retrieval topics, and the MCPVault client skill only where an agent needs the
new behavior. Guidance must explain shelf browsing and the three relation
strengths without encouraging agents to preload the full schema. Examples must
use ordinary Obsidian links and Properties.

## Delivery boundary

The implementation is committed and pushed only to
`Song-Seng-Hun/mcpvault` branch `main`. It must not create a pull request,
release, package publication, or upstream contribution.
