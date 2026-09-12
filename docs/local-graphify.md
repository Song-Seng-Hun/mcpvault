# Host-only Graphify

The developer host runs this on demand. No operational Wiki document is needed
or created. Markdown/Git and current source files remain authoritative; the graph
is a disposable structural navigation aid, not proof, access control or a test run.

## Install (Windows x64, Python 3.10)

Use an existing Python to create `.mcpvault/graphify/venv`, then install with
`python -m pip --isolated install --only-binary=:all: --require-hashes -r
scripts/graphify-windows-py310.lock` using that venv's Python. The lock contains
the exact official Graphify wheel and all baseline dependency wheel hashes.
No global Python/PATH changes, optional provider/DB packages, assistant skill
registration or Git hooks are required. **Do not run `graphify install`,
`graphify codex install` or `graphify hook install`.**

Official stable at implementation start (2026-09-12): `graphifyy==0.9.58`, wheel
SHA256 `e239803288e91c723d6e30540860bd6d5a1dc3f0914b9fc1104b0233e98aaeb8`.
Sources: [official repository](https://github.com/Graphify-Labs/graphify) and
[official release metadata](https://pypi.org/pypi/graphifyy/0.9.58/json).

## Commands

Run from the repository with the isolated interpreter:

```powershell
& .mcpvault/graphify/venv/Scripts/python.exe -B scripts/local_graphify.py build
& .mcpvault/graphify/venv/Scripts/python.exe -B scripts/local_graphify.py query buildTopicPacket --max-chars 4000
& .mcpvault/graphify/venv/Scripts/python.exe -B scripts/local_graphify.py impact src/topic-packet.ts --max-chars 4000
```

The checked-in [allowlist](../scripts/graphify-inputs.json) selects only the graph/
topic subsystem's code, tests and design documents. It is not a whole-repository
coverage claim. Repeated `build --file src/example.ts --file docs/design.md` values
replace this list. Supported types are TypeScript/JavaScript/Markdown only
(`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.md`). Paths must be explicit, local,
repository-relative, with no hidden segments, parent traversal, drive/UNC/ADS paths,
symlinks or reparse points. At most512 files,2MiB each,32MiB total are admitted.
NAS Vaults, credentials, host settings, `.agents`, `.mcpvault`, `.git`,
`node_modules`, generated `dist` and other nonselected files are not analysis inputs.

## Extraction and provenance

The [adapter](../scripts/local_graphify.py) copies only allowed files to a fresh
temporary corpus under validated local `.mcpvault/graphify/staging` and invokes
the pinned AST API in one short-lived child. Ambient TEMP/TMP cannot select
network staging; local drive types and reparse points are checked. It
does not invoke the provider-aware CLI. Child environment does not inherit model
API keys; networking and subprocess execution are rejected by a Python audit
hook. Out-of-corpus reads (including ancestor manifests/configs) are rejected;
installed Python/package files are trusted runtime dependencies. This is defense
in depth, **not an OS sandbox for native dependencies**. No source is executed.

Raw per-file `nodes`, `edges`, `raw_calls` and other returned extraction facts are
copied before Graphify's cross-file rewriting/deduplication. The upstream parser
itself collapses byte-identical edge payloads; the adapter does not claim a complete
token-occurrence trace. A10,000-fact cap rejects oversized extraction before raw
results accumulate; document edges share the remaining resolved-graph budget and
are admitted incrementally. Nothing is silently dropped to manufacture a pass.
Distinct relation kinds/locations returned by the parser
are retained. Resolved edges, unresolved source stubs and the unsigned undirected
clustering projection are separate. Resolution labels are not confidence scores.
Each cache has repository identity, source SHA256, locations, method and tool
version. External/unselected import stubs cannot become current source evidence.

Documents connect only explicit Markdown/wikilink/code-formatted file references
to selected files; ambiguous destinations remain unchosen. Matching backtick and
tilde fences are ignored. Prose instructions are data and are never executed or
published. Semantic interpretation belongs to the current agent.

## Query and invalidation

`query` returns a bounded two-hop structural neighborhood. `impact` presents
related implementation/design/test file candidates, preserving the original
direction, relation kind and source locator in a separate file view. A connected
test is always `testStatus: not_executed`, not a passing test. Partial/sampled
output never claims exhaustive impact or topic coverage.

Every selected input is re-read and hashed before and after packet construction.
Any changed, removed or unavailable input invalidates the complete snapshot and
returns a `build` action without old nodes/edges. This intentionally conservative
first version rebuilds the small explicit corpus rather than serving potentially
stale cross-file resolutions. Cache `.mcpvault/graphify/cache-v1.json` is Git-ignored
and atomically replaced only after a successful complete extraction/recheck.
No automatic knowledge publication, runtime endpoint or sixth MCP tool is added.

## Verification status

Final source is frozen for `graph-p3-final1`, basis
`4415720161cea2b15c7cbf401983845f3f2ba2b1a69a4d5945360e1ffca868d6`.
Python sources and release/dependency locks have additional pinned hashes in the
host's verification receipt. Strict build passed without changing runtime/dist.
Local fixture tests:15 passed,1 skipped because this host could not create a file
symlink; no failed assertions. Tests cover traversal/Windows path aliases, fenced
and hostile text, blocked ancestor config reads, import stubs, uppercase Markdown,
raw relations, document fact budgets, two-hop selection, changes and deletions.
The unexecuted symlink case is not claimed as a passing integration test.
Independent SPEC and QUALITY reviews each found three issues; reproduction tests
and fixes closed all six, followed by narrow static re-review. Reviews themselves
did not execute tests.

An11-file real repository sample produced157 nodes and484 resolved/file-view
edges. One warm-host measurement observed1.6618s construction, approximately37ms
first/repeated queries and impact packets at4000 characters, and1.6214s for a full
rebuild of a copied real corpus after one edited file invalidated the old cache.
This is not a cold-OS-cache or whole-repository performance claim. The source
repository was not modified for the update measurement. Inference/API calls:0.
SMB raw host-share counter deltas were0 during a separately observed5.56-second
window; caching and other clients mean this proves neither zero logical I/O nor
network savings. The Python wrapper's Windows peak working set was27,901,952
bytes (26.6MiB). Sampling the AST launcher and its interpreter descendants every
20ms observed a maximum simultaneous family working set of48,652,288 bytes
(46.4MiB); individual interpreter peaks were44,179,456 to45,232,128 bytes.
These are process-scoped observations, not a whole-host peak or heap guarantee.
Minimum host free RAM during this measurement was5.33GiB. No unrelated app was
terminated and no operational Wiki document was created.

The455-file TypeScript full regression completed:6,377 passed,4 existing skips,
0 failed. Durable per-file receipts retained the first277 completed files;
a single-worker batch covered exactly the remaining178 without rerunning them.
This host-only stage changes no runtime source or generated dist files. Live
unchanged-runtime acceptance and fork-only delivery are recorded in the execution
record and Git; no restart or operational-document fixture is required.
