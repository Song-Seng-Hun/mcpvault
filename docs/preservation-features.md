# Originals, feature selection and host authority

Imported originals, disposable retrieval artifacts and editable Wiki knowledge
are separate. `_sources` trees are append-only through application operations:
new captures use new identifiers, and parsing, retries, cache cleanup, bulk edits,
link rewriting and synchronization cannot replace or delete an existing original.
Existing originals are not migrated. Markdown, source revisions and Git remain
authoritative; a cache never grants access or establishes freshness by itself.

Application guards do not protect against a NAS administrator, direct SMB edits,
or hardware loss. Deployments must separately check storage permissions, retained
backups and restoration; do not claim those guarantees from passing unit tests.

## Explicit feature selection

New installations select only `wiki-core`. A host-private JSON file selects a
fixed versioned list; use `--features-config FILE` or `MCPVAULT_FEATURE_CONFIG`.
Replace the file and restart to apply changes. Missing dependencies cause an
error, not silent activation. Future features are not automatically added.

For example, Wiki with documents, personal memory and work management:

```json
{
  "version": 1,
  "selected": ["wiki-core", "document-search", "personal-memory", "work-management"]
}
```

The complete v1 list is `wiki-core`, `document-search`, `personal-memory`,
`work-management`, `collaboration`, `ideation-research`,
`explanation-translation`, `benchmarks`, `economy`, `roleplay`, `skill-evolution`.
Each optional feature requires core, not the other optional features. Canvas,
MOC navigation and task Properties on ordinary notes remain core capabilities.
Host-side presets are only suggestions for constructing an explicit list.

Disabled optional services are not constructed or subscribed. Their discovery
entries and direct MCP/REST operations are unavailable. Disabling a feature does
not delete existing documents, Canvases, economy state or world data. Feature
selection alone never enables a provider, creates a paid run or grants a model
another person's agent, document or activity permissions.

## Host-local derivatives and confidential documents

Set `MCPVAULT_DERIVED_CACHE_DIR` for shared disposable snapshots and the semantic
database, and `MCPVAULT_DOCUMENT_CACHE_DIR` for parsed document artifacts. Use
separate absolute host-local directories outside the Vault with verified private
permissions. Windows ACLs are checked as well as physical paths. Do not put
private caches on the NAS or in a synchronized directory. Preserve existing
cache data until a separately approved cleanup; no migration from legacy Vault
caches is implied by setting these variables.

Without configured private snapshot storage, shared metadata/lexical indexes are
memory-only and semantic indexing is unavailable. Document disk persistence is
optional. Unsafe private storage fails closed, particularly for confidential
processing. An unavailable local inference runtime is not replaced by a cloud
provider.

Protected source metadata, including inherited evidence constraints, determines
document authority. Ordinary frontmatter cannot grant or relax it. Confidential
access requires host-verified local execution, not a model name, `localhost`, an
`internal` label or a request's `local: true`. Returned bodies, identifiers,
counts, attachments and derived artifacts remain subject to current authority.

## Verified department navigation

Enterprise signup accepts `accountType: "enterprise"` and an optional
`departmentId` claim. The claim must match administrator-verified membership;
it cannot create that membership. Personal signup preserves its existing scope
policy. Company scope is not public Global scope, and room membership does not
grant department document access.

An authenticated company orientation can include `defaultNavigation` alongside
its unchanged primary action. Its action uses the existing dynamic endpoint
`mcp.query_notes` with `department: "default"`. This intersects current document
access with protected department constraints, including explicit cross-department
documents; it does not infer rights from folders or authored department labels.
No verified default means no hint and a refused default-department query.

The department selector is optional and does not change ordinary query semantics.
Department pages use fresh, request-local metadata reads because protected
documents are excluded from legacy shared indexes. Reads are limited to 64 KiB
per admitted source and fail explicitly if unavailable or oversized. This path
can scan admitted documents and is not advertised as an indexed speedup. Output
remains bounded; a department cursor must retain its context and unchanged
filters/sort. Membership, selection or protected-policy changes require a restart
without the old cursor. Current permissions are checked before results/counts.

## Scoped federation progress and retries

Request-bound federation reads and writes recheck current document and owner
authority, including original reply sources and actual projection destinations.
Scoped synchronization does not expose a global cursor or completion flag;
`progress: "scoped"` means that a missing local projection is not proof of remote
absence. Host-wide progress remains available only outside that request context.

Pending publication retains its validated intent until delivery. Retrying first
authorizes all bounded pending intents, then checks each exact queued payload and
its sources again before delivery. A legacy queued row without its matching
intent is not replayed by a scoped request; it needs an authorized host recovery
operation rather than an invented broader activity grant.

## Optional activity and measured cost

Human-owner consent, selected functionality, document access and host execution
admission are independent requirements. `--owner-activity-config FILE` supplies
separate private consent data; it cannot attest execution identity. Revocation
and expiry are checked again at execution. Provider preferences are preferences,
not consent. Bookkeeping uses deterministic handling first, then a verified
eligible local runtime; an unavailable runtime returns a waiting reason.

Document work admission accounts conservatively for reads, parsing, compression
and queued persistence. It is not an operating-system or native-allocation hard
limit. Bounded rank windows, revision pins and selective invalidation remain
advisory optimizations and must not bypass NAS-change or ACL checks.

Synthetic local measurements must report retrieval/evidence quality and include
initial index and maintenance costs. Character counts are not measured model
tokens; local filesystem reads are not NAS traffic. Paid-model comparisons need
their own budget. Until that comparison is run, there is no claim that MCPVault
is cheaper than a competent vanilla file-search/selective-read workflow.
