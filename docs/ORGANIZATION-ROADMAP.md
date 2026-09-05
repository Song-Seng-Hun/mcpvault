# Organization mechanism audit

Goal: make this an excellent, coherent knowledge-organization system, including
the unfinished ideas from earlier investigation. A helper, schema field, or
passing unit test alone is not evidence of a completed agent workflow.

Markdown, Obsidian Properties/links, immutable evidence, private scopes,
revision checks, and Git are the permanent foundation. No client daemon,
embedding installation, extra account ritual, or second history database is
required for ordinary use. The MCP surface stays at five discovery/execution
tools; new behaviors belong in the endpoint catalog.

## Verified mechanisms in the current batch

- Graph navigation now preserves exact locators and public scope URIs under a
  total JSON budget, includes parsed source revisions for backlinks/outlinks,
  and retries oversized entries without skipping or clipping identities.
  Offset-ceiling metadata is budgeted in separate monotonic regions; ordinary
  graph continuations now carry a stateless result fingerprint. Changes in
  admitted rows, parsed revisions or masked context reject continuation before
  returning mixed rows. Per-source streaming hashes cover off-page results,
  remain stable across unrelated private edits and source insertion order, and
  do not retain history. Manual offsets without a guard remain advisory;
  unobserved filesystem drift and atomic cross-file reads are not solved.
  Fingerprinting streams all admitted rows, adding projection/hash CPU without
  a second full edge collection. Dense repeated context/heading projection now
  uses a query-local, source-identity-keyed cache (256 entries, 64 Ki key/value
  characters). A 600-link fixture reduced repeated heading parses from 601 to
  one while preserving masking and exact fallback links. Total graph traversal,
  oversized uncached headings and overall index memory still need scale audits;
  bounded memoization is not a constant-cost navigation claim.
- MOC Home and graph hierarchy traverse whole branches in sibling order.
  Missing, ambiguous, and cyclic ancestry is explicit. Traversal is iterative.
- MOC context packets respect authored mixed-link order and preserve locators,
  accessible targets, current revisions, and hard response budgets.
- Fenced examples cannot become reading-order links.
- Filing-only and partial stale-projection edits cannot certify an inherited
  stale summary. Repairing only a fingerprint is not interpretation.
- Ordinary triage/publication can author tags and execution-capacity hints.
- A small orientation budget preserves a usable public first action.
- `on_upstream_change` now compares a bounded typed-relation revision/state
  baseline captured at publish/review time. Exact qualified paths and exact
  visible aliases/stable IDs resolve conservatively; outgoing dependencies and
  incoming support keep their correct direction. A completed review refreshes
  the baseline instead of reopening forever on an unchanged disputed input.
- Capture returns a revision-bound Clarify action. Clarify applies the selected
  lifecycle, rejects unsafe destination paths, reports destination collisions,
  and returns a move- or merge-preview action without moving/overwriting.
- MOC candidates now include current revisions, deterministic authored order,
  a bounded Obsidian Markdown draft, and collision-aware `notes.write` guidance.
  The suggestion remains non-mutating.
- Maintenance debt and the compact review packet now route one selected item
  through existing inspect/mutate endpoints with its current revision. Answer
  packets for decide/review expose a bounded synthesis plan that preserves
  inputs, names missing evidence/counterpoint stages, and routes to an existing
  review or proposed Decision Record rather than inventing a curator API.
- The pull-based maintenance "janitor" in `get_agent_pulse` now caches only
  against the current Wiki read-model generation. Sequential idle heartbeats
  reuse one bounded plan, while MCP writes and watched Obsidian/file edits
  invalidate positive and negative plans immediately; unreliable watcher
  filesystems still fall back to the short expiry and revision guard.
- Community discussions and completed-task retrospectives share one promotion
  queue with revision-safe inspection and publication guidance. Social/task
  records remain provenance context, never immutable factual evidence.
- Private continuity checkpoints can preserve bounded pending edit guards
  (`endpointId`, path, expected revision, purpose) across interruption without
  locking notes or duplicating their bodies.
- Organization manifest v2 has a normalized contract fingerprint, optional
  global-only metadata readiness scan, contract/identity comparison, stale
  counterpart detection, and honest inventory truncation. Community, private
  scopes, whispers, bodies, sessions, and caches never enter that inventory.
- A representative Korean/English corpus test covers ambiguous aliases,
  multiple MOCs, negative knowledge, stale summaries, and long community
  noise. Bounded search keeps Wiki knowledge first and the selected answer
  packet retains a revision, counterpoint, stale-summary signal, and synthesis
  route.
- Home is now the single intent router rather than another dashboard. It maps
  find/capture/organize/decide/execute/review/repair/migrate to one existing
  endpoint, returns a live recommended action, and carries metadata-index
  revisions without reopening every note body. A 512-character response still
  preserves an executable endpoint and its required argument names.
- The Global Hub/Replica path now proves source-before-knowledge migration
  between two Vault roots. Immutable `_sources/` snapshots are approved first;
  dependent knowledge binds exact Hub evidence revisions and a signed portable
  organization fingerprint. Incompatible contracts and dirty target notes stop
  before overwrite, while private/Community paths are rejected even inside
  provenance.
- Organization projections now share a last-resort response compactor that
  retains revision locators, exact endpoint actions, curation/synthesis plans,
  and migration fingerprints without serializing credentials. Direct Home,
  answer, review, maintenance, promotion, and manifest tests cover minimum
  budgets. Public Home also excludes private/quarantined MOCs, ignores a huge
  irrelevant Property, and refreshes its revision after an external Markdown
  edit without a server restart.
- Knowledge applicability now has an explicit clock: `valid_from` is
  inclusive, `valid_until` is exclusive, and `observed_at`/`temporal_scope`
  remain separate from file, source, task, retention, and review dates. The
  live catalog can filter at a supplied instant, projections expose a compact
  temporal card, and expired/invalid validity re-enters bounded review.
- Answer packets now group cited snapshots into declared source works and
  expose integrity, locator-staleness, unavailable, and non-source counts.
  Several snapshots of one work no longer masquerade as independent
  corroboration; the result remains advisory rather than a truth score.
- Private continuity checkpoints now preserve a bounded research trail of
  short query/read/finding/decision summaries plus optional path/revision
  locators. Raw prompts, note bodies, credentials, secrets, and hidden
  reasoning remain outside the checkpoint.
- Structured claims now have a bounded claim/evidence matrix. Authored order is
  stable, attention priority is separate, snapshots are grouped by source
  work, and missing/unavailable/altered/stale/single-work evidence routes to an
  existing revision-checked review action without changing the note.
- Knowledge role and execution state are now orthogonal facets. A question,
  hypothesis, experiment, atomic note, or other ordinary knowledge note can
  carry bounded GTD/Kanban work Properties without being reclassified as a
  project or task; next-action, flow, dashboard, lint, and quality projections
  use the same actionable-note rule.
- Role-exclusive managed Properties now use one explicit `appliesTo` contract
  in authoring, lint, schema discovery, and reclassification. Changing
  `note_kind` reports incompatible fields before writing; an explicit
  revision-checked `clearInapplicable` retry removes only those managed fields
  while preserving Markdown, custom Properties, identity, evidence, retention,
  and cross-cutting capture/Clarify provenance.
- Dynamic capability search now degrades oversized endpoint schemas in two
  stages: it first removes schema prose while preserving field names, types,
  constraints, nested shape, and required arguments, and only then falls back
  to an identifier-only retry hint. This keeps large organization endpoints
  directly callable without violating the response budget.
- Actionability is now one shared semantic predicate across dependency
  resolution, flow health, Reflect, quality checks, lint, Home counts, and the
  compatibility-named `project_next_actions` Base. Waiting-only epistemic notes
  remain visible and can block dependents; sources/issues cannot accidentally
  enter the work graph. Terminal/someday or archived/superseded work is also
  excluded from current dependency stages through one shared open-work rule.
  Home reports historical and open work separately and routes only on open
  work without duplicating every work item into its compact launchpad.
- Obsidian-native spatial retrieval now has a deterministic JSON Canvas 1.0
  projection. MOCs preserve authored order, hierarchy, and prerequisite edges;
  ordinary notes use explainable proximity tiers. Preview and export remain
  bounded, carry source revisions and a snapshot fingerprint, exclude illegal
  cross-scope nodes, never copy note bodies, and write only a revision-checked
  scope-local `Views/*.canvas` derived file. No client helper or extra plugin is
  required. Managed exports now embed deterministic file-node revision guards
  in a standard text node; a bounded scope-aware health pass detects stale,
  missing, malformed, oversized, or scope-invalid maps and feeds actionable
  defects into the existing exception board without rewriting ordinary
  user-authored Canvases.
- Coupled knowledge edits now use a bounded `notes.change_set` protocol rather
  than independent best-effort writes. Up to ten existing notes and fifty exact
  hunks are preflighted under stable locks; every revision and resulting hash
  contributes to a dry-run fingerprint. Apply requires that fingerprint, and a
  later write failure restores attempted files while making rollback uncertainty
  explicit. Immutable sources, managed Community records, and private scope
  boundaries are checked for every nested path.
- Property-contract evolution now has a read-only `wiki.property_migration`
  planner. It maps one top-level Property rename/value change into bounded,
  revision-stamped change-set inputs, while surfacing destination collisions,
  role applicability, canonical type, allowed-value, oversized-value, source,
  and managed-record blockers. Migration remains inspect -> dry-run -> confirm,
  never an unbounded automatic rewrite.
- MOC sibling order now has a read-only `wiki.moc_order` planner. It requires
  the complete current root or child set, refuses damaged parent graphs and
  plans beyond one ten-note change set, and emits only revision-stamped numeric
  `nav_order` edits. This closes the gap between hierarchy health and a safe,
  explicit repair without confusing sibling order with authored body order.
- Mutual typed links now have a read-only `wiki.reciprocal_link` planner. It
  validates both visible notes, both scope directions, every existing link,
  native list shape, capacity, and mutation boundaries before emitting one
  coherent `related` or `same_as` change set. A missing reverse edge no longer
  requires two independent best-effort writes.
- Managed Community path recognition is shared by moderation filtering,
  generic-mutation guards, and Wiki planners, including ideas, workshops,
  reactions, and guestbooks; a new feature directory can no longer be treated
  differently by those paths accidentally.
- Explicit hierarchy changes now use the read-only `wiki.hierarchy_change`
  planner. MOC reparenting is simulated against the visible map graph and
  refuses cycles, broken ancestors, and privacy-invalid edges. GTD focus
  reparenting additionally requires a strictly higher parent horizon and walks
  the proposed ancestor chain before returning one revision-stamped edit;
  clear is an explicit operation rather than an empty-string convention.
- Graph health now distinguishes resolvable-but-downward/equal focus links from
  missing or ambiguous links. Each invalid `focus_parent` includes a direct
  hierarchy-repair route, and organization health/review budgeting counts the
  new defect instead of using it as valid prioritization structure.
- Ordinary-note map placement now has a read-only `wiki.moc_membership`
  planner. One primary and a complete bounded contextual MOC set must resolve
  to real visible MOC notes in a safe scope; the output uses canonical
  path-qualified Obsidian links and preserves legacy `moc` as an explicit
  migration warning instead of deleting compatibility metadata silently.
- Review-packet mutation routing now invokes the reciprocal-link planner for a
  missing reverse edge and the hierarchy planner for MOC/focus parent defects;
  the suggested tool is therefore executable rather than a label followed by
  a generic manual triage operation.
- Directional typed links and `focus_supports` now have a read-only
  `wiki.relation_set` planner. It requires the complete desired exact target
  set, canonicalizes Obsidian links, rejects self/scope/kind/horizon defects,
  preserves relation rationale as an explicit review warning, and emits one
  revision-stamped change. Graph health attaches this route to unresolved,
  ambiguous, self, kind, and focus-support defects; review and maintenance
  packets no longer send those cases through the full generic triage schema.
  Under a tight response budget, graph compaction preserves epistemic,
  provenance, focus, and typed-relation defects before low-value inventory
  samples, so adding a repair hint cannot hide a more serious diagnosis.
- A real Antigravity 1.1.24 first-look run proved that the fixed five-tool
  surface is callable, but disproved the earlier low-friction assumption: the
  client followed several advertised alternatives (welcome, policy, schema,
  and Community) and reported 93,604 input tokens. Orientation is now a
  constant-cost router: it performs only two path checks, returns one
  `primaryAction` (with one compatibility `nextActions` item), and carries an
  explicit one-call stop contract. Authenticated sessions go directly to one
  bounded pulse instead of rereading onboarding. The public access label now
  accurately includes command-center Community.
- A second external first-look run on Antigravity 1.1.26 used an isolated
  `USERPROFILE`/`HOME`/`APPDATA`, a synthetic Vault, an isolated global MCP
  configuration, and command-center ID `onboarding-proof-7c1e4a9b`. The client
  reported the correct ID and the synthetic Vault audit contained exactly
  `orient_wiki` followed by its onboarding-policy primary action, with no note
  read or mutation. It reported 65,001 input tokens (56,842 cache-read), 2,298
  output tokens, and 67,299 total tokens: about 30.6% less input than the prior
  93,604-token run. This closes the one-action external-onboarding proof while
  leaving the client's large cached base context outside MCPVault's control.
  The run also established that CLI 1.1.26 did not load a standalone
  `.agents/mcp_config.json`; the isolated profile's
  `~/.gemini/config/mcp_config.json` was required and `agy mcp list` was checked
  before execution.

Evidence: `moc-navigation.test.ts`, `backlinks.test.ts`, `organization.test.ts`,
`filesystem.test.ts`, `json-canvas.test.ts`, `continuity.test.ts`,
`global-sync.test.ts`, and the
onboarding/context-pack/capacity/retrieval/Property-migration/MOC-order/MOC-membership/hierarchy/reciprocal-link integration cases in
`llm-wiki.test.ts`.
The compiled `dist/server.js` is also exercised over a real stdio MCP client on
an isolated temporary Vault through orientation, capability discovery, and
`wiki.home` execution in `protocol-version.test.ts`.
These prove the named behaviors, not completion of the whole goal.

## Reconciliation of the earlier six-part maintenance review

The older review that proposed a Janitor daemon, dialectical synthesis,
knowledge half-lives and cascading invalidation, MOC rebalancing, a task exit
gate, and visual distillation is now mostly historical:

- Janitor work is pulled through one bounded `get_agent_pulse` maintenance
  action rather than a separate writer daemon. This preserves stateless server
  deployment and requires an agent to inspect the current revision before any
  mutation.
- `wiki.synthesis_candidates` groups authored MOC/project/domain/subject
  boundaries, preserves counterpoints and explicit contradictions, and emits a
  revision-safe create-or-extend plan. Semantic proximity remains a discovery
  hint through neighborhood/duplicate search, not authority to merge notes.
- `volatility_class`, explicit review policy/date, immutable source revisions,
  and bounded `upstream_cascade_changed` projections cover differential decay
  and transitive dependency review without mass-changing lifecycle state.
- `wiki.moc_rebalance`, `wiki.moc_order`, `wiki.learning_path`, and staged
  prerequisite/cycle projections cover overload, authored order, and a
  topologically safe reading route without rewriting the MOC automatically.
- Completed agent tasks and ordinary actionable Wiki notes require linked
  durable/negative knowledge, a bounded retrospective, or an explicit
  explained no-reuse disposition through their normal mutation workflows.
  Direct Obsidian/Git exceptions remain authoritative and enter the bounded
  review-packet repair queue instead of being silently accepted or auto-fixed.
- `wiki.canvas_view`, `wiki.canvas_export`, and `wiki.canvas_health` provide
  bounded Obsidian JSON Canvas navigation with revision freshness. Mermaid is
  not injected into authoritative note bodies automatically.

Automatic background HTTP checks of arbitrary source URLs are intentionally
not part of the maintenance loop: they would add outbound privacy leakage,
SSRF risk, rate-limit/load coupling, and network-dependent truth to an
otherwise local/stateless server. Captured source hashes, locators, revisions,
and explicit review remain authoritative; a future opt-in link checker would
need a strict public-destination policy and bounded manual invocation.

## Open work with concrete completion evidence

The verified list above is scoped evidence, not a claim that every organization
workflow has been exhaustively audited. In particular, unit tests for a helper
do not prove a current, bounded, actionable response through its public adapter.

- Single-note quality diagnostics have now been repaired across source revision
  checks, moderation visibility, projection freshness, explicit interpretation,
  malformed/structured declarations, failure-first compaction, and executable
  same-note read guidance. `quality-check.test.ts`, public `call_endpoint` cases
  in `createServer.test.ts`, and progressive policy tests provide the evidence.
  The score is explicitly authoring structure, not a factual/source certificate.
- Exception-board packing now deduplicates visible candidates before counts,
  checks captured owner revisions, evicts stale lint cache entries, uses only
  reconstructed safe actions, and preserves exact targets within whole-JSON
  budgets or a same-request retry. Direct temporary-Vault and public MCP tests
  cover minimum budgets, hidden/changed owners, cached results and Canvas routes.
  Its partial count is explicitly not a Vault-wide health certificate.
- Direct lint/organization-health now exclude hidden owners before collisions
  and collection groups, reject unavailable evidence without target identities,
  check coherent known-source revisions on cache returns and aggregation, and
  preserve actionable findings within whole-response budgets. Internal commit
  totals remain separate from public compaction. Temporary-Vault hygiene and
  MCP tests cover edits, hiding, deletion, IO failure, aggregate races, exact
  scoped reads, 512-character output and original-request retry IDs.
- Collection projection now shares the coherent lint note scan rather than
  independently rereading cached Properties. It keeps exact grouping keys,
  correct blank-projection signals, review-time expiry, bounded retained-group
  accounting and executable revision-stamped member reads. Minimum budgets,
  oversized labels/paths, hidden/foreign groups, mutable-response isolation and
  public MCP actions have dedicated coverage. Collection health is an internal
  child of organization health, not a separately registered endpoint.
- **Open: independently derived child views.** Standalone graph/Canvas
  views still need direct audits for source/target freshness, visibility and
  actionable minimum budgets. A checked lint inventory does not prove every
  separately cached graph edge current. The new lint guard scans known metadata;
  new-file discovery is not an atomic census. Measure large-inventory costs
  before optimizing or claiming complete freshness across all child APIs.
- **Observed verification timing risk.** The existing archive long-path retry
  integration test exceeded its five-second timeout once during the full hygiene
  run, passed alone in 1.68s, and passed on the next unmodified full run. Its
  assertions/time limit were not relaxed. Reproduce under controlled filesystem
  load before claiming this intermittent timing issue fixed.
  The read-barrier full run also timed out chat/community/ideation/moderation
  tests and then raced three temporary-directory cleanups; all 47 affected-group
  tests and the next unchanged full suite passed. Preserve this evidence when
  investigating runner load and cancellation/teardown; do not erase timeouts
  by only reporting the passing rerun.
  Subsequent IO-failure validation reproduced default-worker reputation/archive
  timeouts; the four-worker full comparison passed all 915 tests (one skipped)
  in 42.70s versus 46.91s at the CPU-derived 11-worker default. Test configuration
  now caps workers at four without extending deadlines or changing assertions.
  This reduces observed contention; it is not proof of a production latency SLA
  or a fix for every cancellation/teardown race.
- Received-event inventory lag now has a deterministic reproduction and common
  fix: the catalog's 50ms subscriber debounce could leave metadata, backlinks
  and even lexical result-cache hits stale after notification delivery. Read
  preparation now drains that queue, coalesces concurrent callers, and preserves
  incremental updates. Tests cover waiting-note discovery, Properties changes,
  link deletion, negative search caching, moderation hiding, pre-change in-flight
  searches, unknown-path reconciliation, close/failure recovery and clean-read IO.
  This resolves that proven delivery-to-index gap, not every possible cause of
  the earlier intermittent waiting-item omission. OS-undelivered notifications
  remain open. The later work-inventory fix below removes independent page mixing.
- Catalog notification and core read-index failure semantics now distinguish
  confirmed absence from IO/permission failure. Shared stat/directory readers
  reject path-free errors; watcher errors reach batch subscribers; failed
  notification tails and dirty reads stay retryable without new events. Initial
  metadata/search failures recover without restart, and evicted search text
  is not permanently blanked by a failed reload. Controlled temporary-file
  failure/recovery and public MCP tests cover these paths.
- **Open: independent IO and snapshot audits.** Semantic indexes and other
  service-specific catches do not inherit the core-index contract automatically.
  Cached files not selected for refresh are not continuously revalidated.
  Scope-aware graph/Canvas freshness and unobserved external work-snapshot races remain open;
  core read-model fault tests are not proof of all derived views' completeness.
- Semantic query hydration now checks current hashes/moderation even on cached
  candidates, guards generation drift, and keeps backend faults bounded while
  lexical search survives. Canonical vector/manifest/queue paths reject traversal
  and host-only/whisper paths; stored scope labels are not authority. Scans reject
  incomplete IO, and queue saturation/embedding edits cannot suppress later
  indexing with a falsely current stat fingerprint. Current files/root gate
  queued deletes; native write failure preserves manifest and retry backoff.
  Tests cover these service workflows and the public lexical-fallback adapter
  with controlled vector/model doubles; real model relevance is not established.
- **Open: semantic storage completeness.** Cross-process manifest refresh,
  operational counts, scope-table partitioning and orphan-row reconciliation
  still need dedicated audits. Multi-table vector writes are retryable, not
  atomic; do not treat candidate revalidation as a proof of complete disk cleanup
  or exhaustive nearest-neighbor recall.
- Snapshot reads now bound on-disk bytes (including growth after stat) and gzip
  decoded output before parsing across lexical, semantic and public discovery
  caches, including legacy formats. Public v2 header decoding now round-trips
  actual saved snapshots; restored rows require current public membership and
  collection/type consistency. Real gzip boundary, growth, restore and fallback
  tests cover the contract. Limits are per read: streaming parse/restore, aggregate
  memory/CPU budgets, and avoiding repeated oversized snapshot writes remain open.
- Raw locators now map exact legacy chunk IDs/text to physical Markdown lines,
  including Properties, CRLF and variable separators; legacy vector lines are
  ignored during verified hydration. Long-line excerpt windows and Unicode/small
  budgets are covered without changing embeddings or table schemas. Lexical
  body/Properties field origins now use the same physical line convention,
  including lazy text restoration. Public MCP search-to-line-read tests cover
  navigation. This does not make a later read/edit atomic with the search.
- Bounded line-window/outline adapters now use the same raw ParsedNote snapshot
  for moderation, returned body/headings and revision. Real-file races previously
  reproduced revision-A/body-B replies and new hidden content after a public
  precheck; both routes now retain the authorized snapshot and deny later hidden
  reads. Shared pure projections preserve fence and clamping behavior. Returned
  continuations now carry expectedRevision automatically; drift rejects the next
  page with a fresh-outline restart, after current visibility validation. Tiny
  budgets retain progressing locators or an explicit same-request budget retry,
  never a zero-progress cursor/truncated path. Real public MCP tests cover full
  512-character reconstruction, source edits, hidden changes and Unicode titles.
  This does not retain historical snapshots or guard manually unpinned reads;
  consistency audits of other independent multi-read adapters remain open.
- Progressive Wiki reads and split previews now use one moderation-checked raw
  snapshot for headings/ranges/content/revision. Exact/unique heading selection
  and terminal block anchors prevent wrong extraction from duplicate headings,
  Properties, fenced examples or ID prefixes. Context no longer repeats boundary
  lines. Compact public replies keep source revision/range and guarded recovery
  instead of dropping provenance. Split remains preview-only; block reads still
  project an anchor line rather than an entire multiline Obsidian block. Graph,
  work-inventory and multi-file transaction audits remain separate open work.
- Direct note/Properties/outline/line fallback reads now enforce moderation
  independent of folder. Batch response shaping cannot omit Properties before
  authorization or accept cached unchanged metadata as an access grant; it
  checks at most ten current snapshots, then suppresses unchanged visible bodies.
  Aggregate moderation and graph inventory freshness still need dedicated
  audits; this batch does not certify them.
- Public structured query now applies folder-independent moderation and caller
  visibility before counts, offsets, heap/large-offset selection and cursors.
  Shared sorted caches retain caller-independent rows. Selected body hydration
  validates raw revision and current visibility; changed/deleted sources reject
  the whole page and IO failure is unavailable, never empty success. Real public
  MCP tests cover Knowledge/Community, both count modes, follow-on cursors, file
  edits/deletion and controlled storage failures; unindexed mode and large-offset
  predicate/cache isolation are covered separately. Metadata-only views remain
  advisory and independent pages do not retain a vault-wide snapshot.
- Public query response packing now delivers a contiguous prefix and builds the
  cursor from its last original row, including sort values omitted in the
  projection. Oversized rows have explicit field-omission flags and guarded
  recovery; impossible exact locators return a bounded no-cursor error. Body
  hydration stops at the output boundary and uses bounded reads through the
  shared coordinator (256 KiB/source plus probe, 1 MiB/query). Real 512-character
  pagination, nested descending sort, source budget and follow-up drift tests
  cover this contract. Metadata-index construction, large Properties parsing,
  internal service scans and follow-up line/outline IO remain outside these
  limits; global memory/CPU and cross-process consistency are not certified.
- Graph entries now capture moderation with links/tags/identity terms from the
  same raw revision. Caller-visible resolvers exclude hidden notes before
  counts/pages; hidden incoming edges do not mask visible orphans. Known
  invisible-only references are not public unresolved repair tasks. Backlink,
  outlink and repair excerpts mask recognized hidden neighbors/headings, with
  a conservative fallback for clipped references while preserving unrelated
  Property context. All five indexed/unindexed navigation routes share the
  graph parser; temporary graphs close even on failure. Public MCP and direct
  tests cover folder-independent hiding, aliases, attachments, pagination,
  hide/unhide caches, and received events with equal size/mtime. This does not
  certify every edge against current raw content, arbitrary prose redaction,
  a vault-wide snapshot, inline-tag fence parsing, vault-stat moderation or
  aggregate memory budgets; these remain separate audits.
- Body tags now share the graph's Markdown literal mask across graph discovery
  and per-note management. Matching fences, closed inline spans, escaped hashes,
  word/URL fragments and numeric-only hashtags no longer pollute classification;
  full nested paths and Unicode letters/marks/emoji survive extraction. Tag add
  no longer promotes literal examples or clipped nested prefixes to Properties.
  Real-file regressions cover indexed/unindexed parity, repeat counts, warm
  invalidation and public MCP output. Existing Properties cleanup, full HTML/
  indented-code rendering equivalence and per-note mutation concurrency remain
  independent work, not claims of this parser change.
- Tag mutations now participate in the service's existing per-note write lock,
  reject supplied stale revisions, recheck their read snapshot before writing,
  and notify the normal index invalidation callback. Public add/remove requires
  a revision; list and successful mutations return usable revision provenance.
  Hidden and invalid-operation paths reject without exposing tags or mutating.
  Real-file tests cover concurrent same-revision requests, serialized unguarded
  internal additions, observed external edits, callback isolation and public
  MCP missing/stale/current guards plus immediate derived tag reads. Locks are
  service-local, not cross-process CAS; a final external check/write race,
  alias-equivalent lock keys and response-wide tag budgets remain separate work.
- Single and multi-note mutation locks now share absolute lexical, separator-
  normalized, case-folded keys. Multi-lock acquisition deduplicates these keys
  and uses ordinal ordering, preventing dot-segment alias bypass/self-deadlock.
  Actual paths and access predicates remain unchanged; conservative case folding
  can reduce concurrency between distinct case-sensitive files but never merges
  their data. Paused real reads, guarded overlapping writes and failure-release
  tests cover the service-local contract. Independent FileSystemService instances,
  other processes, hard links and Unicode filesystem aliases remain unaudited;
  semantic duplicate-path validation in change sets is distinct from lock identity.
- Change-set validation now compares checked, resolved lexical target paths,
  so a document repeated with `./`, dot segments or an equivalent absolute path
  cannot produce two independent previews/applies. Errors instruct consolidation
  into one change followed by a new dry-run. Related guards reject equivalent
  self/duplicate paths too. Actual request spellings and fingerprint semantics
  remain unchanged; resolved host paths stay internal. Tests cover duplicate
  rejection before any write/event and successful distinct-note transactions.
  This is not complete hard-link/symlink/Unicode identity or cross-process CAS.
- Change-set success receipts now undergo response admission before writes or
  mutation notifications. Final projected paths and JSON indentation count;
  previews may be omitted but all path/revision receipts must fit. Real-file
  tests reproduced edits already applied despite a response-budget error; now
  rejection preserves original revisions and larger-budget retry succeeds.
  This does not certify other mutation adapters' post-write formatting, network
  delivery, cross-process races or rollback atomicity; those remain separate.
- Change sets now recheck each writable target immediately before its individual
  write. Failure recovery only restores content still equal to this transaction's
  planned bytes; already-original targets are skipped, observed external edits or
  deletions are preserved and reported as incomplete rollback. Restored/uncertain
  attempted paths and observed pre-write drift invalidate derived views. Real-file
  race regressions plus an authenticated compiled MCP smoke verify this contract.
  Agents must reread affected targets and reconcile before a fresh dry-run. This
  is not cross-process CAS: final check/write races, uncertain partial writes,
  crash recovery and other write workflows still need independent assessment.
- Checkbox task discovery and mutation now share the same Markdown extractor.
  Line fallback cannot inherit an earlier task match inside a code example;
  duplicate block-derived IDs reject rather than selecting the first checkbox.
  Hidden owners are excluded before aggregation and cannot be toggled, regardless
  of folder. Listing attaches the exact parsed source revision, retained by the
  bounded MCP response; explicit current lines and revision-safe retries remain
  usable. Direct and public MCP tests cover these cases without new task storage.
  Inventory pagination, large-file parsing budgets and cross-process snapshot
  races remain separate audits, not claims of this consistency repair.
- Checkbox inventory now has stateless guarded continuation. Ordinal task pages
  bind status/path filter and the visible task stream's exact source revisions;
  drift rejects the next request instead of silently shifting offsets. Public
  continuation counts only emitted items, retains the public filter and excludes
  credentials. Oversized locators get a bounded same-position retry or explicit
  ceiling error. Non-absence IO failures no longer appear as an empty inventory.
  The scan retains at most one requested page of task bodies and response packing
  uses logarithmic prefix selection. Full inventory scans, per-file parse arrays,
  large-file IO and intra-scan races remain real scale/freshness limitations.
- Task inventory now uses the existing shared bounded I/O coordinator instead
  of direct uncoordinated reads. Concurrent identical source/limit reads coalesce;
  later scans reopen current content, not a persistent task-body cache. An 8 MiB
  source cap fails before partial parsing/counts with a generic narrowing hint.
  Lazy line/task iteration removes full per-note arrays from this scan while the
  array adapter preserves existing parser callers. Full scans, duplicate-identity
  maps, total process memory and source changes during reads remain limitations.
- Vault statistics now check Markdown moderation before counts, byte totals and
  recent selection, including hidden owners outside Community folders. Current
  bounded reads use shared I/O; storage and source-size failures do not produce
  partial successful totals. Public recent paths use scope URIs, zero sample size
  is respected, and whole-JSON packing preserves aggregates while marking omitted
  recent entries. Counts still include allowed non-Markdown inventory and visible
  empty directories as documented. This correctness check costs source IO; an
  atomic inventory or independently freshness-validated cheaper index is not proven.
- Public tag discovery now returns exact bounded pages, literal prefix filtering,
  occurrence totals and emitted-item continuation. A filter-bound fingerprint
  rejects changed tag/count views; private or moderation-hidden contributions
  remain outside counts and fingerprints. Oversized labels get a same-position
  retry or explicit ceiling error, not silent tail loss or fabricated labels.
  The old public bare array becomes a documented envelope; internal arrays stay
  unchanged and no fixed MCP tool is added. Full graph aggregation and eventual
  watcher/reconciliation freshness remain scale/correctness limits.
- Graph refresh now preserves observed invalidations across full/dirty reads,
  stages entries and path membership until a stable generation, and drains
  shared catalog events received during IO. Standalone new/delete events update
  navigation membership. Explicit full resets bypass equal-size/mtime reuse.
  Three unsuccessful stabilization rounds return a bounded retry error rather
  than a known-obsolete view. Both refresh modes schedule batches of 16 complete
  bounded 8 MiB source reads; failed batches drain and remain retryable. Oversized
  sources fail graph queries without partial success or process shutdown. Total
  graph memory, unseen OS changes and cross-process atomicity remain limitations.
- Archive reference samples now select four distinct current source documents
  from a bounded 64-occurrence probe; repeated or stale first-author links no
  longer hide other available usage contexts. Probe overflow has a current
  backlink follow-up and remains explicit even with no valid sample. The final
  follow-up target is checked again and known changed/hidden targets lose their
  old recommendation too. Occurrence-based ranking is still advisory; these
  documents are not automatically independent evidence. Whole JSON remains
  bounded and this does not reduce the whole-inventory counting cost.
- **Remaining scale trade-off: archive rediscovery.** `wiki.resurface_archives`
  now provides safe scan continuation and revision-checked previews, but inventory
  counts still scan metadata and recommendation rank is window-local. Establish
  representative large-vault measurements before choosing a global-ranking or
  inventory-count optimization; do not relabel the current projection as either.
- Metadata full/dirty refreshes now discard observed-obsolete staged results,
  retain invalidation obligations, drain catalog notifications received during
  IO, and retry up to three stabilization rounds. Unknown resets bypass matching
  stats; dirty reads now share the 32-read full-refresh batch bound and failures
  drain before rejection. Regression coverage includes a prerequisite reopened
  during IO: its dependent action must not be offered as ready. This is an index
  read barrier, not atomic filesystem snapshots.
- `workDependencySnapshot` now captures a single metadata inventory rather than
  combining independently refreshed pages. Project planning hydrates only its
  visible non-retired knowledge projects, checks body revisions, and compares
  visible inventory membership/revisions after hydration. Off-project dependency
  changes also reject the plan. Reads use drained 16-source batches with complete
  8 MiB source limits; a no-index reader parses one path inventory once, without
  the previous repeated scans per 500 rows. Scope-invisible changes do not leak
  through cohort validation. Unobserved filesystem races and whole-inventory
  memory remain separate audit topics; selected-body retention is addressed below;
  this is not an OS transaction, globally retained snapshot or partial plan.
- Project packets now budget final formatted JSON, retain exact public source
  identities, flag omitted detail with a bounded source read, and continue by
  emitted row count with a visible-result fingerprint. At a smaller budget the
  same-position retry cannot skip the oversized first record; at the ceiling an
  unrepresentable identity fails explicitly. Authored next-action text and tool
  follow-ups use distinct fields. Planning sections reuse the fence-aware heading
  parser, including matching-close and body thematic-break behavior.
  These changes do not reduce whole-cohort ranking or work-graph memory costs;
  other organization endpoint response packers still require their own audits.
- A 12,000-node work chain reproduced a recursive SCC stack overflow. The shared
  work/MOC component classifier now uses explicit DFS frames and edge iterators,
  preserving input-rank cycle order. Work-stage/propagation queues use cursors,
  not repeated shift/sort. Tests cover a 30,000-node cycle, 150 deterministic
  graph comparisons with a reachability oracle, excluded nodes, self-cycles,
  deep stages and a 2,000-child unlock frontier. No classification cutoff was
  introduced. Full work/index memory and construction
  of the full deepest-chain projection before response compaction remain open;
  stack safety is not a whole-Vault memory or latency bound.
- Project planning now consumes each validated body into three section flags
  before retaining its batch result, on indexed and no-index paths. Work
  snapshots retain metadata only, and requested heading presence shares the
  outline parser without collecting unrelated headings. Existing inventory
  callers that request content without a consumer keep that contract. Revision
  drift is rejected before consumption; metadata drift during consumption still
  rejects the cohort. Failed consumers drain their batch and suppress internal
  error details. This removes application references to the entire body cohort,
  not transient parser allocations, source-size/batch costs, or metadata/graph
  memory. Heap/GC and production latency improvements remain unmeasured.

Record new concrete gaps here when registered schema, dispatcher, service,
persistent representation, guide, invalidation, or bounded failure evidence
disagrees; remove a gap only after checking that complete workflow.

## Completion gate

For each open workflow, inspect its actual registered schema, dispatcher,
service, guide, persistent Markdown result, invalidation behavior, and failure
tests. Prefer fixes that simplify an existing operation. Record a remaining
gap here rather than silently treating an unused helper as a shipped feature.
Run build and risk-relevant integration tests, then exercise the compiled MCP
surface on an isolated vault. Live-server deployment and fork push are separate
facts and must not be inferred from local tests.
