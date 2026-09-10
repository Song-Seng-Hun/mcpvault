# Local PDF worker contract v1

Implementation handoff for Plan 1 item 2, 2026-09-10. The sidecar owns only
`scripts/document_pdf_worker.py`, `scripts/document-pdf-requirements.txt`,
`scripts/test_document_pdf_worker.py` and this document. Node DocumentService,
resource authorization, adapters, caches and deployment belong to Main.

## Launch and admission

Use an argument array, `shell: false`, one worker process at a time. Provide a
local absolute path to an already-authorized, private temporary PDF snapshot.
The worker never reads the live Vault, takes a URL, installs dependencies, starts
other processes or writes extracted documents. Input and model paths reject
UNC/device paths, alternate data streams, symlinks and Windows reparse points.
The parent owns ACL verification and protection against path replacement races.

```text
python -B scripts/document_pdf_worker.py --check
python -B scripts/document_pdf_worker.py --input <absolute-private-temp.pdf> --output-json stdout --max-pages 200 --timeout-seconds 120 --expected-sha256 <64-lowercase-hex>
python -B scripts/document_pdf_worker.py --input <absolute-private-temp.pdf> --pages 2,7 --expected-sha256 <same-sha256>
```

`--pages` selects original one-based page numbers, sorted and deduplicated;
no selection means all pages. `--max-pages` is whole-document admission, not a
silent prefix: even a selected page in a document over the limit is rejected.
Each selected page receives a result or an explicit failed-page placeholder
after the page count is known. A failure before document opening instead has
`pages: []` and a document gap. Sparse resume converts each selected page once;
it does not invoke an internal retry loop. Repeated invocations may reparse the
PDF, so the parent should group retries and reuse successful cached pages.

Limits: 50 MiB input, 1-200 admitted pages, default 120-second cooperative
deadline (positive and at most 3600), 4 MiB serialized output per page,
20,000 chunks per page, 16 MiB total JSON including the final LF. Input is read
once into an immutable bytes snapshot, and the same bytes go to each
`DocumentStream`. SHA-256 is calculated from these bytes, never decoded text or
Docling's internal hash. The parent must compare it with the resource revision.

The Node parent must enforce hard timeout, memory/CPU limits, process-tree
termination, OS network denial, sandbox filesystem access, stdout byte limit,
queue admission and scoped cache ownership. Python-level network guards and
offline environment flags are defense in depth, not an OS sandbox. Native
libraries cannot be interrupted safely by this cooperative timer. Parser and
inference pools are configured for two threads, with one inter-op thread;
`metrics.threads` reports this setting, not measured total process threads.
Do not embed this module in a concurrent Python server: its offline guard
temporarily changes process-wide environment and socket functions.

## Result schema and exit status

UTF-8 stdout contains exactly one JSON object and one LF. Python and native
diagnostic streams are discarded by the CLI to avoid corrupting the protocol or
leaking PDF contents through logs. Errors expose fixed codes, not exception
strings. `--help` is the sole human-readable CLI mode.

```typescript
type Gap = { code: string; severity: 'warning' | 'error' };
type PdfResult = {
  version: 1;
  sourceSha256: string | null;
  profile: string;
  pages: Array<{
    page: number;
    text: string;
    regions: Array<{
      startOffset: number; endOffset: number;
      bbox: [number, number, number, number]; kind: string;
    }>;
    status: 'ok' | 'failed';
    gaps: Gap[];
  }>;
  gaps: Gap[];
  metrics: {
    inputBytes: number; totalPages: number | null; requestedPages: number;
    processedPages: number; failedPages: number; threads: 2;
    elapsedMs: number; exitCode: 0 | 2 | 3 | 4 | 5;
    // Check mode / dependency failures may add the fields described below.
  };
};
```

`sourceSha256` is null only when no complete admitted snapshot was read, or in
check mode. It is present for an invalid PDF signature, hash mismatch, missing
dependency/model or extraction failure after reading the snapshot. Never cache a
null-hash result as a converted document.

| Exit | Meaning | Parent handling |
| --- | --- | --- |
| 0 | Requested pages produced usable text; warnings may remain | Inspect gaps, validate and cache |
| 2 | Required dependency/version/model unavailable | Report optional PDF unavailable; no automatic install/download |
| 3 | Invalid arguments/input/hash or admission/output limit | Reject request; do not retry unchanged input |
| 4 | One or more failed pages, or cooperative timeout | Keep valid pages; bounded, explicit page retry may be offered |
| 5 | Unexpected backend/setup/cleanup failure | Report failed conversion; no unbounded retries |

`metrics.exitCode` agrees with the process exit status when the process exits
normally. A hard kill can produce no JSON; the parent must treat incomplete or
invalid JSON as failed, not salvage it as a successful partial document.
`processedPages` counts pages with status `ok`, not attempted conversions.

Offsets are zero-based UTF-16 half-open offsets **within each page's returned
text**. They are not PDF byte offsets or Python character indices. Text chunks
are joined with exactly one synthetic LF. Existing text, including CRLF and
astral characters, is preserved; separators have no region. Bounds are PDF
points in top-left origin, `[left, top, right, bottom]`, not pixels. A missing or
invalid box retains text without inventing a region and reports
`bbox_unavailable`. Extracted text lines are never physical PDF source lines.

Native regions use Docling item labels, usually `text`. Layout output can also
include `title`, `section_header`, `footnote`, etc. Table cells use `tableCell`
and `tableHeader`. Table text is emitted cell-by-cell, with no generated Markdown
table. Multi-page tables without unambiguous per-cell page provenance are
rejected as incomplete; native text is retained when enrichment cannot provide
a complete page. `failed` pages may contain usable native text, but must not be
treated as complete OCR/layout results. A page can be `ok` with warning gaps.

Common warning gaps: `reading_order_unverified`, `layout_order_unverified`,
`image_text_not_extracted`, `ocr_quality_unverified`, `bbox_unavailable`,
`table_structure_unavailable`. Failure gaps include `no_extractable_text`,
`page_extraction_failed`, `enrichment_failed`, `timeout`,
`output_budget_exceeded`, `region_budget_exceeded`, `invalid_provenance` and
`unlocated_content`. Blank or scanned pages without usable text are `failed`;
the worker does not claim to distinguish a blank page from an unrecognized scan.

Successful conversion profiles are `mcpvault-pdf-v1:<sha256>`, binding direct
dependency versions, Python major/minor, thread configuration, enabled stages
and model manifest fingerprint. Page selection and temporary file location do
not change the profile. The bare prefix on early failures/check mode is not a
conversion profile. Include source hash, full profile, scope/resource identity
and original page number in cache keys. Timing metrics are nondeterministic and
must not be hashed as extracted content. Direct pins are not a complete
environment lock; record the operator's resolved environment alongside caches.

## Optional layout, tables and Korean OCR

Default extraction uses Docling's model-free `NativePdfPipeline`, with page
rasterization and bitmap image decoding disabled. Native text has no guarantee
of semantic reading order or table structure. These are explicit upstream
limitations, preserved as warning gaps. [Native pipeline source](https://github.com/docling-project/docling/blob/v2.126.0/docling/pipeline/native_pdf_pipeline.py)

`--layout --model-manifest <absolute.json>` enriches selected pages locally.
Provide `--pages` to select known complex pages; the worker does not claim an
automatic multi-column/table classifier. A `table` manifest entry additionally
enables TableFormer; without it, layout can run with a table gap. The default
Docling layout model and directory convention for this pinned release must be
provisioned. `artifacts_path` is always explicit, external plugins and remote
services are false, and picture description/classification plus code/formula
enrichment remain disabled. [Pinned pipeline options](https://github.com/docling-project/docling/blob/v2.126.0/docling/datamodel/pipeline_options.py)

`--ocr rapidocr --model-manifest <absolute.json>` runs native extraction first,
then OCR only for pages with bitmap pictures or no native text. Mixed pages are
therefore eligible; text-only pages skip OCR. `--layout` can be combined with
OCR. OCR necessarily uses Docling's local layout stage too. A failed enrichment
retains native text and marks the page failed. No silent fallback to another
OCR language, engine, model version, remote service or generative model occurs.

The selected API supports Korean PP-OCRv5 with ONNX Runtime; current RapidOCR
defaults have moved to PP-OCRv6, so the worker explicitly configures v5 and local
paths. A v4 direction classifier is compatible with the v5 detection/recognition
pair and must also be pinned. [RapidOCR model matrix](https://rapidai.github.io/RapidOCRDocs/main/model_list/),
[pinned Docling OCR adapter](https://github.com/docling-project/docling/blob/v2.126.0/docling/models/stages/ocr/rapid_ocr_model.py)

An operator creates a private manifest outside `artifactsRoot`. It is data only,
never executable configuration. Required form (placeholders are intentionally
invalid; no real model hashes have been invented or downloaded):

```json
{
  "version": 1,
  "docling": "2.126.0",
  "artifactsRoot": "C:/private/pdf-models",
  "layout": { "revision": "OPERATOR_PINNED_LAYOUT_REVISION" },
  "table": { "revision": "OPERATOR_PINNED_TABLEFORMER_REVISION" },
  "rapidocr": {
    "version": "3.9.2", "onnxruntime": "1.23.2",
    "engine": "onnxruntime", "ocrVersion": "PP-OCRv5", "language": "korean",
    "revision": "OPERATOR_PINNED_OCR_MODEL_REVISION",
    "detection": "ocr/det.onnx", "classification": "ocr/cls.onnx",
    "recognition": "ocr/korean-rec.onnx", "keys": "ocr/korean-keys.txt"
  },
  "files": [
    { "path": "ocr/det.onnx", "sha256": "REPLACE_WITH_ACTUAL_SHA256" }
  ]
}
```

`files` must list **every** file recursively under the root, including layout,
optional table, all three ONNX models and the recognition dictionary. The sample
is incomplete on purpose. Hashes are exactly 64 lowercase hexadecimal digits.
Unknown extra files, duplicate JSON keys, traversal, links/reparse points,
missing files, mismatched hashes or incompatible OCR settings are refused.
Manifest limit: 128 KiB, 256 files, 1024 directory entries, 512 MiB per file,
2 GiB total artifacts. Keep the verified model tree read-only throughout the
job; the worker does not eliminate races against another privileged writer.

TableFormer uses the pinned Docling layout under
`docling-project--docling-models/model_artifacts/tableformer/accurate/`, including
`tm_config.json` and its referenced weights. Include those files and revision
when enabling `table`. [TableFormer loading contract](https://github.com/docling-project/docling/blob/v2.126.0/docling/models/stages/table_structure/table_structure_model.py)

`--check` does not import Docling or run inference. It reports metadata/pin
availability in `metrics.dependencies`, with `{name, expected, installed,
status}` (`ok`, `missing`, `version_mismatch`). It adds `check: true`,
`available`, `backendProbe: 'not_run'`, and `models` (`not_required`,
`unavailable`, or verified manifest fingerprint). With layout/OCR flags it also
checks that manifest. `available: true` is a configuration/metadata check, **not
a successful DLL import, model initialization or PDF extraction test**.

## Dependencies and validation status

### Main integration verification (2026-09-10)

The dedicated native environment is provisioned with transitive wheel hashes
retained in host-local installation evidence. Dependency-independent worker
tests now pass 32 cases. Native bilingual (two pages) and column/table (one page)
fixtures passed through the real Windows AppContainer provider with source hash,
page boxes and cleanup. Scan input reports `ocr_unavailable`; no OCR accuracy,
layout model or Tesseract comparison result is claimed.

The native host alone supplies hidden `--trusted-input-root` and
`--trusted-model-root` arguments after canonical ancestor pinning. Its caller
allowlist rejects both, including abbreviated and equals forms. Windows worker
paths are lexically contained and inspected root-inclusively, without querying
ungranted parent metadata. Standalone paths retain all-ancestor checks; the
non-Windows CLI rejects trusted-root arguments. SHA/fstat/model inventory checks
remain unchanged. Neither these flags nor model manifests grant access.

The following original implementation-session notes are historical; see the
current integration evidence above and the Windows sandbox verification limits.

Reviewed pins: [docling-slim 2.126.0](https://pypi.org/project/docling-slim/2.126.0/),
[docling-core 2.95.0](https://pypi.org/project/docling-core/2.95.0/),
[docling-parse 7.18.0](https://pypi.org/project/docling-parse/7.18.0/),
[pypdfium2 5.13.0](https://pypi.org/project/pypdfium2/5.13.0/).
Optional pins are [docling-ibm-models 4.0.2](https://pypi.org/project/docling-ibm-models/4.0.2/),
[torch 2.10.0](https://pypi.org/project/torch/2.10.0/),
[RapidOCR 3.9.2](https://pypi.org/project/rapidocr/3.9.2/) and
[ONNX Runtime 1.23.2](https://pypi.org/project/onnxruntime/1.23.2/).
The older ONNX pin intentionally supports the host's Python 3.10, matching
Docling's `<1.24` constraint for that interpreter. Requirements list native
dependencies by default and optional provisioning lines as comments. Resolve
transitive versions and platform wheel hashes separately before production.
No dependency resolution/install, model download or real backend smoke test has
been performed in this implementation session.

Run dependency-independent tests:

```text
python -B -m unittest discover -s scripts -p test_document_pdf_worker.py -v
```

Tests use in-memory fake backend/Docling result objects and temporary fixture
bytes. They prove serialization, bounds, hashes, recovery and adapter arguments;
they do not establish PDF correctness or Korean OCR accuracy. Provision an
isolated, pinned environment separately, then evaluate native, scanned Korean /
English, mixed, multi-column, table, footnote, corrupted/encrypted and large-page
fixtures. Verify exact page provenance, failure preservation, no network egress,
thread/memory limits, determinism and real native package imports before enabling
this sidecar for users.

Implementation-session verification: 28 tests passed on Python 3.10.9;
the real CLI `--check` returned exit 2 with all four native dependencies marked
missing. Scoped whitespace checks passed. No dependencies/models were installed,
and no npm command, build, full suite, NAS operation or Git mutation was run.

## Tesseract comparison, never a production second pass

`tesseract_comparison_command(executable, image_path, tessdata_dir)` returns this
argv; it **never executes it**:

```text
tesseract <same-rendered-fixture-page.png> stdout --tessdata-dir <local-traineddata> -l kor+eng --psm 3 tsv
```

Use the same page images and fixed ground truth for the RapidOCR/Tesseract
evaluation. Record Tesseract binary version, kor/eng traineddata hashes and
render DPI, then compare accuracy, word boxes, reading order, latency and memory.
Run the returned argv only in an explicitly scheduled evaluation harness with
its own limits. No production worker invocation starts Tesseract.
[Official Tesseract CLI documentation](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)
