# Bounded process-shared semantic inference

The user delegates design approval and requests lower resource burden without
client installs, extra services or mandatory configuration. Current model pooling
deduplicates weights, not inference calls. VaultIoCoordinator limits file reads;
HTTP adapters limit auth attempts, not native model execution. A model execution
gate is a different resource boundary, not another file or transport queue.

## Chosen design

- One process-wide active inference job, including model load and single-input
  fallback; at most 16 waiting jobs. Waiting jobs expire after 5 seconds, without
  interrupting native computation already in progress. The queue retains no
  results and exposes no private content/status aggregate.
- Foreground query priority, but a queued background job runs after at most four
  foreground selections. FIFO within each class. Saturation/expiry/cancellation
  use a dedicated temporary busy error; they must not disable semantic search
  globally for five minutes or trigger batch-to-single retry storms.
- Schedule before acquiring the shared model. Each service tracks its scheduled
  jobs, cancels queued work on close and waits for active inference before releasing
  its model lease. Resource-idle cleanup also recognizes scheduled work. Existing
  same-query deduplication stays in place. This does not claim cancellation of
  native computation or redesign all DB/HTTP shutdown paths.
- Batch fallback calls the single-input primitive under the already held gate,
  never recursively re-enters it. Index saturation preserves/requeues source
  intents and does not convert temporary busy into a native failure/backoff.
- Pass supported ONNX Node session options: at most two intra-op threads (one on
  a one-CPU host), one inter-op thread, sequential graph execution. Keep CPU q8,
  model revision, normalization and other existing options. Include these options
  in the embedding profile, so incompatible cached rows rebuild gradually through
  the existing bounded worker. No manual cache deletion or eager full reindex.

Unbounded native concurrency retains needless working sets. Spawning more model
workers duplicates them. Explicit bounded scheduling plus native thread policy
is preferred; this prioritizes coexistence over maximum bulk indexing throughput.

## Constraints and verification

ONNX's documented `extra` session settings are marked WebAssembly-only in both
installed 1.24.3 types and the official JS reference. Do not claim Node spinning
is disabled via an ignored option. CPU/memory arena tuning and GPU remain future
measurement questions, not required client setup.

Tests first: gate serialization, capacity, expiry, class fairness, errors and
queued cancellation; cross-service native-call integration with a deferred fake
model (no model download), batch fallback deadlock prevention, close/load races,
busy search without five-minute circuit-break, background intent retention.
Test native option compatibility on a tiny in-memory ONNX Identity graph, not an
actual embedding-model throughput benchmark. Verify build/full one-worker suite,
review and fork-only source/dist integration. No live Vault/server restart.

Sources: [ONNX threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html),
[JavaScript SessionOptions](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.SessionOptions.html),
installed Transformers.js pipeline session_options forwarding. No diagnosis of
the earlier desktop stutter or measured throughput/RSS improvement is asserted.
