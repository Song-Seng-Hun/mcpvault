# Resource reduction follow-up: measure before adding parallelism

Source inspection and official documentation checked 2026-09-07. This is a
research/backlog record, not a claim that GPU acceleration or a new pool shipped.
The user approved implementation work without another design confirmation.

## Existing controls, not new proposals

- `src/semantic-profile.ts`: pinned multilingual-e5-small, Q8, CPU, at most two
  intra-op threads, one inter-op thread, sequential execution. These options
  contribute to the embedding-profile fingerprint.
- `src/semantic-inference-gate.ts`: one active native inference per process,
  bounded queue of 16 and five-second admission wait; foreground prioritization
  includes a background fairness turn. This is not a machine-wide gate.
- `src/semantic-search.ts`: process-local model pool, cross-process index-writer
  lease, bounded pending changes/batches and streamed gzip snapshots. A writer
  lease does not make independently spawned Node processes share a model heap.
- `src/cache-budget.ts`: 32 MiB default accounting budget for registered derived
  caches, with an explicit oversized-entry exception. Not a process RSS/native
  memory ceiling. Do not advertise it as total memory bounded to 32 MiB.

## Applied review-route increment

The new review-route tests verify no extra selected-note `readNote` or
`noteExists`, and only one final source hash for identical producer receipts.
Admission bypasses potentially stale indexes and has an 8 MiB per-note limit.
Those correctness checks can add I/O relative to the old cached route; the
operation-count test is not a whole-endpoint speed or memory benchmark.

`FileSystemService.readNoteRevision` still obtains the full decoded UTF-8 string
through `readNoteData`. Metadata projection also reads/parses a complete note
before discarding its body. Removing a service-level body read therefore does
not mean all underlying body bytes are skipped or hashing is streaming.

## Ranked follow-up with acceptance gates

1. **Bounded streaming revision hashing.** Preserve exactly the existing decoded
   UTF-8 revision contract, including malformed UTF-8 and chunk boundaries; do
   not accidentally switch to hashing raw bytes. Preserve PathFilter, path/link
   defenses, file-size checks, missing-file errors and caller access checks.
   Compare hashes against the current implementation for multibyte text,
   malformed bytes, empty files and boundary-sized fixtures. Measure peak
   allocation with a disposable large note; never dump live Vault heap contents.
2. **Avoid duplicate retained representations.** Profile allocations in one
   disposable workload to distinguish parsed bodies, metadata/frontmatter,
   vector arrays and native DB/model memory. Prefer bounded streaming/projection
   or fewer copies to adding more caches. Keep revision and deletion tests.
3. **Only then offload proven synchronous CPU hotspots.** A small reusable pool
   with a bounded admission queue can isolate parsing/graph computations, but
   serial I/O and already-native inference do not automatically benefit. Compare
   p95 event-loop delay, RSS and completed-work throughput at equal concurrency.
   Do not spawn a worker/model per agent or copy an entire Vault into each worker.
4. **GPU remains optional experimentation.** Test a supported runtime/provider
   with the pinned model and quality/latency/memory fixtures, not just a device
   flag. Require CPU fallback, no extra client installation, profile separation,
   correct idle disposal and unchanged permission enforcement. Compare desktop
   responsiveness under concurrent video playback before considering a default.

## Primary sources and limits

Node documents workers as useful for CPU-intensive JavaScript, not I/O, and
recommends a reusable pool instead of creating one per task. Buffer ownership
must be explicit when transferring data rather than cloning it.
[Node worker threads](https://nodejs.org/api/worker_threads.html)

ONNX Runtime's prebuilt Node support is platform/provider-specific; its support
table lists DirectML on Windows and CUDA on Linux x64. This does not by itself
prove the project's Transformers wrapper, installed runtime, pinned Q8 model
and local GPU form a supported or faster combination.
[ONNX Runtime Node support](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)

No live runtime/config changes, native model downloads, GPU benchmark, new
runtime workers, machine-wide memory reduction or desktop-lag resolution are claimed
by this research note.
