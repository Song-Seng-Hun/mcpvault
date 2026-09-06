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

At this inspection baseline, `FileSystemService.readNoteRevision` obtained the full decoded UTF-8 string
through `readNoteData`. Metadata projection also reads/parses a complete note
before discarding its body. Removing a service-level body read therefore does
not mean all underlying body bytes are skipped or hashing is streaming.

Follow-up implementation: `2026-09-07-streaming-revision-design.md` replaces that
hash-only full-string path with streaming decoded-UTF8 hashing under the existing
coordinator. At that increment metadata projection was unchanged. Its separate plan records tests,
benchmark limitations and publication; do not confuse it with the earlier
review-route operation-count improvement. The subsequent
`2026-09-07-streaming-metadata-design.md` increment also projects fresh metadata
through a single decoded stream: all bytes are still hashed/read, but only the
header is retained. It preserves the existing index fast-path and leaves
index-rebuild/query body reads outside that increment's scope. The subsequent
`2026-09-07-index-metadata-projection-design.md` applies the shared projection
to metadata index entry rebuilding as well, retaining generation/barrier and
snapshot behavior. Graph/full-note/query hydration remains distinct. No
whole-Vault memory ceiling or header-only disk-I/O claim follows from this.

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
   Follow-up source evidence: `FrontmatterHandler.parse` passes a string to
   gray-matter; the installed `lib/to-file.js` constructs `orig` through
   `utils.toBuffer`, whose string branch calls `Buffer.from(input)`. The handler
   returns its own original string, not `parsed.orig`. This is a concrete extra
   full-input allocation identified at the inspection baseline. The subsequent
   `2026-09-07-data-only-frontmatter-design.md` increment removes that body copy
   for plain/closed-header inputs and blocks a separately confirmed executable
   default engine. Metadata reads still obtain the original decoded text; this
   does not make metadata I/O header-only. Its plan records isolated measurements
   and verification. The later streaming-metadata increment removes the decoded
   body retention from fresh metadata service reads, not every index producer.
   Do not claim a parser cache leak: explicit
   options currently prevent gray-matter from populating its content cache.
   The concrete `VaultMetadataIndex.readEntry` follow-up is now implemented by
   the index-metadata-projection increment: it uses the same coordinated header
   and digest instead of its old full-string read/hash. Dirty-event and reset
   races, same-size/mtime invalidation, batch draining and binary snapshot reuse
   are verified separately; injectable race hooks follow the projection boundary
   without suppressing mutation/error scenarios. Do not extrapolate this to
   graph parsing or body-bearing query hydration, or to an index memory cap.
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
