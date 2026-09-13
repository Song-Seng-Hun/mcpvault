# Safe, resumable local test runs

`npm test` retains Vitest's normal workflow and its existing maximum of4 workers.
For memory-constrained hosts use:

```sh
npm run test:safe -- --run-id verification-one
npm run test:safe -- --resume=verification-one
npm run test:compact -- --run-id compact-one
```

The safe runner asks installed Vitest for its actual file inventory. Each batch
uses a fresh coordinator and one isolated worker, each with512MiB old-space.
The orchestration process uses128MiB. Default chunk size20 is a ceiling, not a
promise that every host can fit20 files; `--chunk-size=1` reduces it. Compact uses
one file per process, not `isolate:false` or removed `poolOptions` flags.

Start admission needs2.3GiB free host RAM; sampling below2GiB cancels only the
runner's own process tree. It never closes user apps. The guards sample every50ms
and cannot guarantee prevention of all OOM/native-allocation spikes. A15-minute
batch timeout, cancellation and output bound also stop without accepted coverage.
Exit0 means the exact full inventory passed with explicitly counted allowed
skips. Exit75 means incomplete/deferred, never passed; exit1 means failed or
unavailable. Shell/npm wrappers may map nonzero codes differently on Windows.

For a bounded execution opportunity:

```sh
npm run test:safe -- --run-id short-window --chunk-size=1 --max-batches=1
npm run test:safe -- --resume=short-window --chunk-size=1 --max-batches=1
```

This intentionally remains incomplete until every file finishes. The next run
skips only accepted completed batches. Source/test/build/configuration/runtime
and file inventory must still match; otherwise begin a new ID. Reducing the
batch size on resume does not alter assertions or test isolation.

## Checkpoints and failure handling

Ignored `.mcpvault/test-runs/<id>/` contains a manifest, batch intent, actual
Vitest report and completion receipt. Interrupted/unreceipted reports are not
accepted. No previous artifact is overwritten. Failed assertions, runtime errors,
unknown skips, todo, empty or duplicate/missing files cannot certify completion.
Existing conditional Windows and absent recorded-model-evaluation skips are
listed centrally in `scripts/testing/report.mjs` and counted separately from pass.

Inspect `batch-N.failed.json` and its actual report after failure. A failed run
requires inspection and a new run ID; ordinary resume never erases that failure.
The single-repository `worker.json` lease prevents two safe runners from sharing
resources. Normal cancellation releases it after the process exits. A hard-killed
supervisor can leave a lock: verify its exact process is dead before manual
recovery. Never delete a live/unverified lock or reset damaged history.

The basis includes root TS/Markdown/config/package files, src/tests/scripts/dist,
architecture artifacts and optional recorded workshop inputs. It also pins Node,
platform, architecture and the installed Vitest package metadata. This guards
accidental drift, not a hostile user forging their own local receipts or all
external environment variation. No test result certifies real-model quality,
NAS performance, production authorization or native hook trust.

Keep host artifacts out of Git. No external Vault path, model/provider, package
installation or background scheduling is accepted by this runner.
