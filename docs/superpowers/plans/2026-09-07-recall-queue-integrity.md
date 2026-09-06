# Recall Queue Integrity Implementation Plan

> Inline executing-plans/TDD; review delegated separately. User approved design
> autonomy and fork main; preserve .agents/ and .mcpvault/.

**Goal:** Faithful bounded private-reader recall with verified current inputs.
**Architecture:** fresh metadata -> bounded interleaving -> selected reference
enrichment -> source/state revision check -> whole-response packing.
**Tech Stack:** TypeScript/Vitest, existing filesystem/references/interval helpers.

- [x] Add src/recall-queue-integrity.test.ts with safe real temp Vault fixtures.
  Reproduce whole JSON overflow, hidden contrast target disclosure, source/private
  drift, future resolved repair, invalid interval and relative link resolution.
  Assert JSON.stringify(result,null,pretty?2:undefined).length<=maxChars.
- [x] Add src/recall-queue.ts and src/recall-queue.test.ts. Streaming collector
  retains limit groups * limit entries, sorted by priority/path, with exact group
  count via keys. Differential test against exhaustive sort/group/round-robin
  reference. Packer tests preserve exact prompt/revision or actionable retry.
- [x] Update src/llm-wiki.ts recallQueue: bounded fresh source/private
  metadata, existing interval normalization, selected-only bounded reference
  resolver, moderation/access/source-relative checks, final revision validation.
  Keep readPrivateRecall's other consumers and mutation workflows unchanged.
- [x] Pass prettyPrint to recallQueue from src/createServer.ts. Update tool
  description in src/llm-wiki-tools.ts, README.md and _wiki/SCHEMA.md. Add
  in-memory MCP budget verification and source/private/target drift tests.
- [x] Run focused suites, npm run build, npm test -- --maxWorkers=1, independent
  integrity review, git diff --check. Record exact results before publication.
- [x] Commit explicit source/test/docs/dist files, push origin main only and
  verify local HEAD/tracking/live remote match. No actual Vault/server actions.

## Evidence
The preceding MOC work is already pushed as aa5c95b; design commit 670105a.

- Initial integration cases reproduced response overflow, hidden/relative target
  errors, missing revisions, private body reads and interval overflow. Collector
  tests compare exact output to exhaustive round-robin across input orders.
- Review found unrestricted discovery, basename repair substitution, whitespace
  grouping drift and invalid-interval review routing. Fixes add the fresh bounded
  filesystem metadata iterator, exact stored repair paths and review routing.
- Intermediate whole suite: 180 files passed; 2787 passed, 1 skipped; 317.22s.
- A later review found prompt inspection revealing answers and a nested 3200-char
  recall retry suppressing private repair priority. Three RED cases reproduced
  these. Additive property/offset support on notes.read and bounded 12000-char
  internal recall admission fixed them. Focused 36 tests passed; build passed.
- Delta review found property revision conflicts routing to body outlines.
  A regression now follows the restart action, not only the immediate error.
  The targeted run reproduced the wrong mcp.get_note_outline action. The conflict
  helper now restarts the same Property at offset zero with a fresh revision;
  the test follows that action and confirms no body disclosure. Focused 36 tests
  passed again (7.32s), and build passed. Both delta reviewers are closed.
- Second intermediate whole suite (before the conflict fix): 180 files passed;
  2790 passed, 1 skipped; 327.94s. This is not final-change verification.
- Third intermediate suite (conflict fix included): 180 files passed;
  2790 passed, 1 skipped; 322.90s. A final hard-ceiling propagation test then
  reproduced an unchanged queue retry for taskUnavailable. It now preserves an
  explicit unavailable state instead of creating a fake executable action.
  Focused 37 tests passed (7.49s), followed by a successful build.
  Final whole-suite verification: 180 files passed; 2791 passed, 1 skipped;
  323.22s (2026-09-07 05:15:37 local start), exit 0. Build and staged diff check
  passed. Implementation committed as 92fe468a70cc0114441b5b25c01a2f07ec5d97ec
  and pushed to Song-Seng-Hun/mcpvault main. Local HEAD, origin/main and live
  ls-remote main matched that hash. Only pre-existing .agents/ and .mcpvault/
  remained untracked; no actual Vault/server or client configuration was changed.

## Resource follow-up (investigated, not implemented in this increment)

Current semantic-profile.ts already selects multilingual-e5-small q8 on CPU,
intraOpNumThreads <= 2, interOpNumThreads = 1 and sequential execution.
semantic-inference-gate.ts serializes native inference per process with a bounded
waiting queue. semantic-search.ts shares one embedder per process and releases
idle resource leases; neither pooling nor the gate is a cross-process limit. Snapshot files already
use gzip; adding compression again would not establish a new optimization.

CPU-heavy JS work may justify a small reusable worker pool, but file I/O is not
itself a reason to create workers; compare transfer/heap costs first. See the
[Node worker documentation](https://nodejs.org/api/worker_threads.html).
ONNX thread spinning and thread counts are separate tuning options. The local
semantic-profile test deliberately rejects unsupported extra spinning options;
verify Node binding support before proposing any such setting. If supported in a
future runtime, disabling spinning is an idle-load benchmark candidate, not an
assumed latency win.
See [ONNX thread management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html).
GPU acceleration remains unimplemented and unbenchmarked; do not claim reduced
RAM/VRAM or desktop lag from this queue change. No model downloads or new client
installation were needed. Full-file revision hashing still performs bounded
source reads; only retained detailed candidates/reference work are reduced.
