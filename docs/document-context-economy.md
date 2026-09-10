# Document and resource context

The five-tool MCP control plane is unchanged. These read-only endpoints use the
same services through `call_endpoint` and REST; they never execute resource code.

| Endpoint | Smallest useful operation |
| --- | --- |
| `documents.search` | Find lexical fragments, optionally using semantic document candidates |
| `documents.outline` | Page through revision-pinned structure without loading full bodies |
| `documents.read` | Read exact or structurally contextual ranges and explicit neighbors |
| `resources.manifest` | Inspect original bytes, hashes, media types and bundle provenance |
| `resources.export` | Export bounded, revision-pinned base64 byte ranges |

Start with search or a known exact range. Outline is not a compulsory pre-read.
Follow returned actions without dropping `expectedRevision`. Fragment IDs and
cursors are invalid when the source generation changes. Global search describes
a bounded discovery window, not a complete Vault inventory; narrow `path` for
exhaustive fragment search within one admitted document. Rankings/descriptions
are navigation, not evidence, permission or proof that a parser understood prose.

## Reading

```json
{"endpointId":"documents.read","arguments":{"path":"Guide.md","startLine":42,"endLine":42,"mode":"exact","maxChars":1500}}
```

Semantic mode retains structural headings, table headers and nearby prerequisite
context. It does not prove semantic completeness. Expand a returned fragment with
`relation:"previous", edge:"tail", lineCount:3`, `relation:"next"`, or
`relation:"parent"`. Up to eight selections can be supplied in `ranges`, instead
of single-selection fields. GET adapters accept bounded JSON for `ranges` and
`knownReads`; MCP uses typed arrays. Complete JSON envelopes, locators, receipts
and continuation metadata count toward `maxChars` (512..12000).

Reading receipts are opaque, process-signed, authenticated-session-bound proofs
of delivered ranges. Supply only receipts actually retained by the caller;
`forceRead:true` explicitly rereads. A restart, different session, changed source
or changed parser invalidates receipts. They neither prove comprehension nor
erase the model's conversation history. Public readers receive no receipts.

Markdown offsets/lines include original frontmatter. Context packets generated
from a note body label offsets relative to that provided body. PDF offsets/lines
are **extracted text**, not physical PDF lines: use original page numbers and
bounding boxes; unboxed content retains page-only provenance. Missing pages,
uncertain reading order, clipping and omitted provenance are explicit gaps.

Canvas and Bases resources remain JSON/YAML text with their own media types;
the document layer does not pretend to parse them as Markdown or execute them.

## Defaults and caches

Existing context/embedding behavior stays at the legacy default. Explicit
`MCPVAULT_CONTEXT_PROFILE=structure-v1` opts into common structural passages and
complete, token-checked embedding coverage. Parser and chunk profiles both bind
the embedding generation. Publication replaces each scoped document's rows in
one database transaction, preserves old rows on failure and retries idempotently.
This is not a cross-table transaction guarantee.

Optional `MCPVAULT_DOCUMENT_CACHE_DIR` must be an absolute host-local directory
outside the authoritative Vault. Structures are disposable, checksummed and
budgeted; source bytes and access are always reread. Catalog events invalidate
hot generations. Missing NAS storage is not deletion. Cache failure cannot make
a valid source unreadable. Private-scope public paths never expose physical
scope storage in returned descriptors.

## Resource bundles

`scripts/resource-bundle-host.ts` is an explicit host import command. It takes a
private local manifest of bounded resources, previews the entire batch and only
applies the confirmed fingerprint. It preserves paths, original byte hashes,
source version/license and rejected/unavailable entries. Bundle source bytes are
immutable and hash-verified on every read; scripts are data, never executable
configuration. Export continuations reconstruct byte-identical originals.

## Optional Windows PDF provider

The Node install has no mandatory Python, Docling, OCR or RAG framework dependency.
Without host configuration, binary document reading returns parser unavailable;
original bytes remain exportable. Set `MCPVAULT_PDF_HOST_CONFIG` only after a
dedicated host has passed the OS and real-fixture verification matrix. An invalid
configuration fails PDF requests without breaking ordinary Markdown startup.

The private JSON config has `version:1`, `boundaryRoot`, `python`, `worker`,
`sandboxHost`, `aclHelper` and a **PowerShell 7** `powershell` executable. The
Python/worker live below `boundaryRoot/runtime`; models, if configured, live
below `boundaryRoot/models`. Optional `layout`, `ocr:"rapidocr"` and
`modelManifest` require separately provisioned, hash-pinned local artifacts.
`ocrMemoryMb` optionally selects 1024 or 2048 MiB only with `ocr:"rapidocr"`;
omission keeps the 1024 MiB default. It is operator configuration, never a
document/MCP argument. The selection applies to the whole OCR-enabled job.
Never put configuration paths, credentials or runtime caches in public notes.

The provider serializes setup through cleanup, admits at most two requests, uses
a cross-process fail-closed lock and gives every job a fresh AppContainer identity.
It establishes a private job DACL before staging source bytes. The native launcher
pins/audits paths and permissions, attaches a one-process Job Object before
resume, checks the actual token, denies network capabilities, limits stdout to
16 MiB and imposes a 120-second parser deadline. No unrestricted Python fallback
exists. Host helper environment is allowlisted, including `PATHEXT=.EXE` so native
PowerShell commands are synchronous. The ACL helper changes DACLs, not owners or
audit policy, and compares SID values without resolving account names.
The default/native-only memory budget is 1024 MiB; only the explicit OCR opt-in
may raise it to 2048 MiB. No automatic escalation is performed.

Confirmed worker exit precedes profile deletion, runtime/model grant revocation
and exact job removal. A cleanup failure blocks the provider and leaves a
content-free recovery ledger; do not delete a lock without checking its process,
profile, grants and job. One hot PDF generation is reused in memory after source
authorization; restart the provider after trusted runtime/model maintenance.

See [worker contract](research/document-pdf-worker-contract.md) and
[Windows sandbox contract and limitations](research/pdf-windows-sandbox.md).
The AppContainer is not a VM or a claim that all OS resources are inaccessible.
Real network/file/process denial and cleanup must be verified on the actual host.

Initial native-host verification (2026-09-10): approved child-only debugger tracing identified
Windows console allocation returning `0xc000049d` inside `KERNELBASE.dll`, causing
the original `worker_abnormal_exit_c0000142` before Python. The source fix uses
`DETACHED_PROCESS` with unchanged AppContainer/Job/child-process restrictions.
Compilation and the new creation-flag contract pass; a separate diagnostic build
passed sandboxed data-free `--check` (exit 0). Following explicit user approval,
the active host was backed up and replaced, and its non-debugger `--check` also
passed with cleanup verified. Full suite: 4855 tests passed, 2 skipped.
The subsequent `input_unavailable` was traced to worker `lstat` calls above the
private job grant. Opening the staged file succeeded; inspecting its ungranted
ancestors and strict realpath resolution failed. The broker now appends its
audited/pinned input/model roots, rejecting caller overrides. Windows worker
checks include the root and every descendant; standalone calls retain full
ancestry validation. No ancestor permissions were broadened.

Final native fixtures passed under AppContainer: bilingual PDF (2 pages) and
columns/table PDF (1 page), with source hashes, original page boxes and cleanup.
At the initial native-only deployment, the scan fixture correctly reported
`ocr_unavailable` and failed-page gaps. See the later OCR verification below;
layout/table quality and Tesseract comparison remain unverified.
Reading order is explicitly unverified for the native-only profile.

Actual OS probes, without the worker socket monkeypatch, verified outbound TCP
permission denial to a reachable operator-owned NAS endpoint (10013), private
file-data read denial (5), runtime file-data write denial (5), child-process
policy denial (367), and stdin EOF. Both host positive controls succeeded.
This is scoped evidence, not universal egress, hostile-PDF or VM certification.
Profiles, runtime grants, jobs and locks were cleaned; Node tests also cover
failed ledger persistence and unconfirmed-process-exit retention.
No real PDF was used for debugger tracing, and no machine-wide tracing policy was changed.

Initial deployment verification (2026-09-10): native-only PDF was enabled on the existing
NAS-backed shared runtime. All 747 deployed dist files matched the build; previous
release/launcher and native-host backups are retained. World/economy checkpoints
and journals were preserved through audited writer-lock recovery. Authenticated
live five-tool MCP verified native bilingual PDF text (including negation), both
original page boxes, document search, stale-revision refusal and byte-identical
original export over six bounded calls. Verification used an explicitly imported
synthetic resource bundle, not private user documents. Existing roleplay/skill
health checks passed. Final full regression: 4855 pass, 2 skip; Python: 32 pass.

Subsequent OCR verification (2026-09-10): a separately provisioned Korean
PP-OCRv5 environment passed the real AppContainer test with an explicitly
approved 2048 MiB job budget. Five critical scan sentence bodies survived
whitespace-normalized comparison, including negation and 5 versus 50; each
matched the correct image-line coordinates. Native text and column/table
markers, cleanup and actual OS network/file/child denial probes passed too.
Worker tests: 33; Node PDF tests: 25. The Chinese v4 direction classifier's
incorrect 180-degree rotations are disabled; upside-down text is not repaired.
Scan-only pages use full-page OCR; mixed pages preserve PDF-first merging.
Identifier `0/o` errors and spacing differences remain. This is not broad OCR
accuracy, mixed-mode multi-page memory, or semantic table certification.

OCR deployment/live verification completed on the existing NAS-backed shared
runtime. All 747 staged build files matched. Authenticated five-tool MCP verified
scan outline/read/search, the five critical sentence bodies, original page boxes
and the expected OCR profile. Native and scanned originals both round-tripped
byte-identically over 12 bounded exports; stale revisions were refused. The new
writer retained the exact previous world/economy checkpoint hashes and journal
counts, and roleplay/skill health checks passed. Prior runtime/launcher backups
are retained. Final four-worker regression had 4854 passes, 2 timeouts and 2 skips;
both timeout files passed all 8 tests alone without changing their assertions or
limits. The final guidance/PDF rerun passed 38 tests, and build/catalog checks
passed. This is not a claim that the parallel run itself was all green.

## Framework adapters and evaluation

`documentRecords`, `toLangChainDocument` and `toLlamaIndexNode` export framework-
neutral text, public-path metadata, exact locators and relationships without
importing either framework. Call only on a currently authorized index result.
The caller owns its scoped vector store. LlamaIndex relationships are neutral
metadata rather than invented version-specific `RelatedNodeInfo` instances.

`tests/fixtures/context-economy-v1.json` fixes 100 synthetic text queries across
ten Korean/English categories. Contract tests check important qualifiers, exact
source mappings and deterministic structures. `scripts/build-document-pdf-fixtures.py`
adds three synthetic native/scan/column-table PDFs and 21 page-grounded queries.
These are not a real-world answering-model benchmark. Fake PDF backend tests do
not establish OCR correctness. A successful dependency metadata check is not a
successful DLL import, conversion or isolation test.

The >=30% target concerns cumulative model input with tool envelopes, additional
reads and repeated history, not isolated snippet length. Until the same answering
model passes correctness/citation and cumulative-input gates on the mixed corpus,
keep the legacy default. Do not label the target as measured savings.
