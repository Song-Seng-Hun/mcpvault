# Layered memory: retain, recall, correct, reuse

MCPVault stores memory in ordinary Obsidian Markdown. The server does not
capture conversations, run a second LLM, pin host context, or wake stopped
agents. Existing agents select useful experiences during authorized work,
interpret them, save through normal revision-safe writers, then re-read.

## Three independent axes

| Axis | Values |
| --- | --- |
| Role | `core`, `episodic`, `semantic`, `procedural`, `resource` |
| Reading depth | small brief, relevant excerpt, exact original |
| Scope | `personal` (default), `community`, `global` |

Role is not note kind, lifecycle, task status, permission, or proof. Personal
memory requires the authenticated agent identity; the same model/family does
not grant another agent's memory. User storage remains host-only. The server
operator can read files; private scope is not an encrypted secret store.

## Record one meaningful experience

Use existing `mcp.write_journal_entry` for a private diary/log/reflection. The
body permits 20,000 Unicode code points; chat and comments still permit 280.
An update requires its current `expectedRevision`. Omitted `memory_entries`
preserves previous entries; `[]` clears markers, not the diary body.

```json
{
  "kind": "log",
  "title": "File watcher investigation",
  "content": "On this NAS mount, events missed an update. Polling found it. This does not establish a rule for every NAS. ^nas-test",
  "memory_entries": [{
    "block_id": "nas-test",
    "role": "episodic",
    "observed_at": "2026-09-08",
    "retrieval_cues": ["NAS missing file changes"],
    "use_when": "Investigating this mount's watcher behavior"
  }]
}
```

Each of at most 32 block records points to one real terminal Obsidian block
anchor, not an example inside a code fence. Keep situation, attempt, outcome,
conditions and uncertainty in Markdown, not duplicated inside Properties.
Use `[[Note#^block-id]]` in prose for navigation.
An anchor on its own line binds only the preceding Markdown block, not all
earlier paragraphs. Place it on the actual experience, not a trailing privacy
disclaimer. After writing, verify the same journal and its `memory.recall`
excerpt; repair the anchor if the excerpt omits the intended experience.

A durable lesson/procedure/resource can instead be a normal note with
`memory_role`, optional `memory_state`, `memory_basis` and `memory_corrects`.
Do not use `memory_role` and `memory_entries` on the same note. Ordinary
`observed_at`, `valid_from`, `valid_until`, `retrieval_cues`, `use_when` apply.
Do not invent exact event times. `created_at`, when recorded, is recording
time, not necessarily event time.

`basis`/`memory_basis` contain up to eight `{path, revision, block_id?}`
references. `corrects`/`memory_corrects` contain up to eight
`{path, block_id?, revision?}` old targets. Paths are exact Vault-relative
`.md` paths or authorized `scope://` URIs, not host filesystem paths. Keep
credentials elsewhere. A role called core is not permission to invent a
personality or treat recalled preferences as a new system instruction.

## Retrieve before repeating work

Call through the existing `call_endpoint` executor:

```json
{"endpointId":"memory.recall","arguments":{"query":"NAS missing file changes","scope":"personal","maxChars":4000}}
```

- `memory.recall`: past experiences, conditions, failures and corrections.
- `memory.brief`: a small relevant work packet; default 2,000/max 4,000 chars.
- `memory.consolidate`: read-only comparison worksheet; the connected agent
  decides what is supported and writes any synthesis with existing tools.

Recall/consolidate default to 20 items/4,000 chars, maximum 100/12,000. These
are ceilings, not promised counts. Identity, locators, warnings and next
actions share the same serialized response budget. At most eight distinct
document bodies are retained per call; metadata/revision checks and cold index
initialization are additional I/O. Candidate discovery does not hydrate bodies.
All selected-scope memory metadata pages are checked for corrections, including
corrections outside a requested subfolder. A 10,000-note scope safety guard fails
closed instead of declaring incomplete history current. Search itself can be
`partial`; it is not an exhaustive knowledge claim. Ordinary short-query
candidates are confirmed against current content or recall cues before output.

Use exact returned `nextAction` for original line reads and preserve its
revision. Preserve `nextCursor` and the same query/filter arguments for
pagination. If data changed, restart without the cursor. Semantic search is
optional; failure leaves lexical search available and is reported separately.

Shared memory must use an explicit shared scope. Community and Global are
not silently unioned with personal results. A shared lesson cannot cite a
private/narrower-scope source. First prepare separately reviewed shareable
material; synthesis does not authorize publication.

## Correct and consolidate without rewriting history

Write a new observation pointing to the old target. Preserve the original
diary as the historical account of what was believed. Default recall follows
corrections; `includeHistory=true` also admits archived/corrected records.
Competing corrections are alternatives to examine, not votes proving truth.
Unresolved correction chains or corrections outside the requested filters return
a warning and a historical/broader lookup action, not an invented current winner.

Consolidation shows basis revisions, changed/unavailable support, body-summary
freshness, and related candidates not listed in the existing basis. Candidates
are not automatically new facts; compare conditions, failed attempts and
counterexamples. Current revision means unchanged bytes, not true content.
The server never renews a stale summary fingerprint on the agent's behalf.

Set whole-note `memory_state: archived` or a block's `state: archived` to
exclude it from ordinary memory views. This does not change task state or
knowledge lifecycle, delete the raw note, or erase Git/backups. Restoring
`active` re-enables memory retrieval subject to corrections and visibility.

## Resume with less context

Continuity answers “where did I stop?”; memory brief answers “what past
experience helps now?”; `wiki.recall_queue` remains a learning exercise.
Save exact memory references in the existing continuity checkpoint, not
copies of memory bodies. Consult memory when relevant, retain important
outcomes and verify writes. Do not journal every turn, manufacture activity,
or preload every memory layer at login. A different account needs explicit
authorized handoff, never a copied password.

See progressive `wiki.policy` topic `memory` and the public Properties
contract for machine-readable guidance. No extra MCP registration is needed
for individual memory endpoints: the stable five-tool surface is unchanged.
