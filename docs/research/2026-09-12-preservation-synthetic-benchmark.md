# Opt-in SYNTHETIC preservation search comparison

This harness measures real local retrieval, not a model or production Vault. It
imports the current working-tree `SearchService`, `DocumentService`,
`DocumentIndex`, `DocumentResourceReader` and their real dependencies through
`node --import tsx`. It does not use `dist`, change package/configuration files,
contact providers, or deploy anything.

## Run contract

```powershell
node scripts/benchmark-preservation-search.mjs --smoke
node scripts/benchmark-preservation-search.mjs --size 100
# Parent only, one size at a time, when its heavy-job slot is available:
node scripts/benchmark-preservation-search.mjs --size 1000
node scripts/benchmark-preservation-search.mjs --size 10000
```

No arguments, other sizes, extra flags, Vault paths and URLs are rejected. Smoke
is the complete 100-document workload. Completed parent runs and interrupted
attempts are recorded below. Programmatic entry also rejects path/options outside
this contract. Internal workers require the parent's IPC channel and ownership
marker; the CLI does not accept a worker fixture path.

The coordinator creates its own randomly named local temporary directory and
sequentially starts a vanilla worker and a preservation worker. Both receive the
same deterministic files, question sequence and current revisions. The changed
document is restored before the next arm. A SHA-256 corpus fingerprint includes
ordered paths and initial content. All generated files and updates stay inside
that fixture. Successful runs return JSON on stdout after cleanup; a failed
correctness gate returns a report with `pass: false` and nonzero exit status.

Every launch requires `os.freemem() >= 3.25 GiB`. The coordinator samples free
memory every 100 ms and terminates only its spawned worker tree below
3.125 GiB, on cancellation, timeout or excessive stdout. Windows termination
uses `taskkill /PID <owned pid> /T /F`; no name-based process killing is used.
The parent must still reserve the single heavy-job slot and supervise any outer
test runner. The guard is sampled protection, **not an OS hard memory bound**;
it cannot guarantee a 3 GiB floor during sudden unrelated allocations.

Each arm has a 180-second timeout, 256 KiB stdout ceiling and 4 KiB retained
stderr. Cleanup waits for the worker to close, checks the exact canonical owned
directory, ownership marker, direct-child relationship to the temp directory,
and the absence of symlinks, hard-linked files and special entries before a
confined recursive removal. Failed ownership checks leave the fixture in place
and raise an error. Forced termination of the coordinator itself or machine
failure can prevent cleanup.

Temp admission rejects raw UNC and device-namespace spellings before any
filesystem operation or subprocess. On Windows, only an absolute drive-letter
path is accepted. A constant PowerShell script asks .NET `DriveInfo.DriveType`
about its validated drive root, passed through an environment value rather than
interpolated into code. Only `Fixed` is admitted; mapped/network, removable and
unknown drives fail closed before the temp path is inspected. The probe uses
`-NoProfile -NonInteractive`, a 5-second timeout, 128-byte stdout/512-byte stderr
ceilings and the same 100 ms free-memory guard; termination targets its own
process tree only. This is local drive classification, not a directory read of
a mapped drive. PowerShell availability is required on Windows.

After drive admission, root-to-leaf lexical ancestors are inspected using
`lstat`; a symlink/junction or non-directory is rejected before descending
through it. Dot traversal, device names and ambiguous Windows components are
rejected lexically. Only then is `realpath` called and compared with the admitted
lexical path (case-insensitively on Windows). The existing generated-fixture
identity and cleanup confinement checks still apply. These metadata checks do
not lock the OS namespace against concurrent hostile replacement of ancestors.

## Comparison and correctness

The corpus has 90% public notes and 10% notes in another user's private scope.
Each note is about 4.3 KiB. All content is deterministic UTF-8 Markdown. Unique
lookup keys, source markers and answer markers occur at varying line depths.
There are six questions per pass: three single-source questions, one two-source
question, a private-only key, and an absent key.

Both arms use the same real `PathFilter` and `ScopeAccessPolicy` as an anonymous
public reader. Preservation passes the access predicate to `SearchService` and
uses revision-pinned exact line reads from `DocumentService`. The derived search
index may internally read private documents; the read instrumentation includes
those bytes, and the result gates forbid exposing private paths or markers.
This is a fixed ACL workload, not an enterprise revocation/concurrency audit.

Vanilla performs directory enumeration, ACL pruning, case-insensitive lexical
OR search over one file body at a time, bounded top-K selection, and selective
line reads with a fresh SHA-256 revision check. It never concatenates the corpus
into a prompt. It is a transparent Node file-search baseline, not a benchmark of
optimized native `rg`, a specific IDE, or an agent's adaptive query strategy.
Neither arm is given answer paths or expected answers to select results.
Deterministic ground truth is used only for evaluation.

The current `SearchService` deliberately bypasses its result cache when an ACL
predicate is supplied. Thus “warm” here measures the retained search index,
document structures and filesystem cache, not a claim of cached query results.

Both arms have top-K 4, search response ceiling 4,096 UTF-16 characters and a
2,048-character ceiling per selective read. They read the match line and the
following line. For every question, the gate checks the expected answer/source
markers, exact source SHA-256, exact half-open UTF-16 source slices, missing and
duplicate evidence, private result paths, and private markers in returned
search/read payloads. Private `_scopes/users/other` paths and
`scope://user/other` URIs are also rejected anywhere in the returned JSON,
including nested values and object keys, with slash/backslash and case variants.
JSON escapes are decoded before this secondary inspection. After one source changes, a separately measured read with
the previous search revision must be rejected, and another full question pass
must return current evidence.

## Metrics and boundaries

| Report field | Meaning |
| --- | --- |
| `startup` | Current source imports and service construction in that arm |
| `initializationProbe` | First public no-result search; includes lazy initial index construction and that search |
| `cold` | First six-question pass **after** the initialization probe |
| `warm` | Same questions again in the same worker; no cache clearing |
| `incrementalWrite` | One identical fixture rewrite and normal invalidation; logical bytes written reported |
| `staleReadProbe` | Separate rejection check and its IO/latency |
| `incrementalMaintenanceProbe` | Public no-result search that pays pending in-memory index maintenance |
| `incremental` | Six questions against the changed corpus |
| `teardown` | Closing actual service resources |
| `processWallMs` | End-to-end arm wall time, including Node/tsx startup, all phases, evaluation and IPC |
| `io` | Logical successful source bytes/read calls plus metadata and directory attempts in that phase |
| `calls.retrieval` | Search + selective-read application calls for the question; not network round trips |
| `proxy` | Serialized request/response **UTF-16 character counts, not tokens** |
| `processMaxRssBytes` | Node `resourceUsage().maxRSS`, converted from KiB; includes runtime |
| `memorySamples` | In-worker 100 ms samples plus phase boundaries; peaks may be missed |
| `supervisorFreeMemory` | Coordinator's independent 100 ms system-free-memory observations |
| `model`, `modelInputTokens`, `modelOutputTokens`, `modelAnswerQuality` | `null`, not measured; model calls are zero |
| `actualNasReadBytes` | `null`, not measured; fixture is local only |

The character proxy describes the harness's normalized retrieval arguments and
serialized responses. It is not an assembled model prompt, tokenizer estimate,
or actual model input. Correct marker retrieval is not generated-answer quality.

Read instrumentation wraps `fs.promises.readFile`, `open`, and the returned
`FileHandle.read/readFile` before dynamically importing production modules.
Named ESM imports are synchronized. Only operations under the fixture corpus
are counted. The synthetic corpus is UTF-8, so re-encoding returned strings
provides its logical byte length. Reads repeated for revision checks count
again; zero-byte EOF reads count as calls. Metadata/directory counters are API
attempts, including instrumented handle stats, not bytes. Sync filesystem
operations, callback/stream APIs, module loads and physical disk/cache/SMB
traffic are outside coverage. Instrumentation adds overhead to both arms.
Worker maxRSS and samples describe that worker process, not a summed peak for
every loader/helper process in its tree; the coordinator's free-memory guard
observes system availability independently.
Question latency includes instrumentation and deterministic correctness grading.
The worker reads its maxRSS high-water mark before serializing its final report.

No durable index cache is configured: initial in-memory construction and one
incremental refresh are measured, but persistent snapshot maintenance and
restart-from-snapshot are not. Vanilla has no persistent index; its two no-result
probes are full scans. These explicit probes must not be treated as an inherent
vanilla startup tax in a cost comparison. Use the separated fields to assess
the desired workload and amortization, and include all relevant startup and
maintenance costs rather than comparing warm retrieval alone.

“Cold” does not mean an OS-cold disk: fixture creation, arm order and preceding
probes warm the filesystem cache. The fixed vanilla-first order, one process per
arm, small uniform notes, unique keys and lack of repeated trials limit timing
inferences. No claim that preservation is cheaper or universally faster than
competent vanilla follows from this benchmark. Paid same-model answer/evidence
comparison remains pending explicit model choice and budget.

## Verification record

The pure tests use Node's built-in test runner because repository Vitest
discovery does not include this `.mjs` file. No discovery configuration changed.

```powershell
node --test tests/benchmark-preservation-search.test.mjs
# Opt-in behavioral smoke; reserve the heavy slot first:
$benchmarkPreviousSmoke = $env:PRESERVATION_BENCHMARK_SMOKE
$env:PRESERVATION_BENCHMARK_SMOKE = '1'
try { node --test tests/benchmark-preservation-search.test.mjs }
finally { $env:PRESERVATION_BENCHMARK_SMOKE = $benchmarkPreviousSmoke }
```

Implementation observed a real initial RED (four missing-feature assertion
failures), then GREEN (four passing pure tests). A subsequent returned-marker
leakage assertion also failed before its implementation. The first real smoke
completed both arms and all 36 question gates using the actual working-tree
services: 100 documents, 432,716 UTF-8 bytes, initial corpus fingerprint
`f610ea5e9774bfc41bcd4242d778546c165d4b4f4a042f08aa82b1f7eeff0edb`.

At the first handoff, the heavy slot belonged to the parent. The later returned-marker
leakage fix, stale-read probe, opt-in behavioral test, and small signal-listener
lifecycle correction have **not received a final GREEN/smoke run**. The latest
test run before those fixes was the expected RED: three passing pure tests,
one failed leakage assertion, and the behavioral test skipped. The parent must
run the commands above under its 100 ms memory supervisor before accepting the
final harness. With the environment flag set, the expected outcome is five
passing tests, including a real 100-document smoke with both stale reads
rejected; this is an expectation, not a claimed result.

No full suite, build, 1,000/10,000-document run, NAS access, model call, commit or
push was performed by the harness implementer. Larger runs remain for the parent
after integration, with one heavy command at a time and the same memory guard.

### SPEC2 regression handoff

The parent confirmed a genuine RED for all eight new SPEC2 regressions: private
fixture paths in returned payloads were accepted; six raw UNC/device temp cases
called `realpath` before rejection; and local fixed-drive admission was missing.
Those boundary tests intercept all `fs.promises` operations and subprocess
spawning, so the synthetic network spellings cannot cause network access.

The payload and temp-admission fixes are now implemented. No tests or build were
run by the implementer after that RED confirmation; the parent retains the only
heavy slot. Pending parent GREEN:

```powershell
node --test --test-name-pattern=SPEC2 tests/benchmark-preservation-search.test.mjs
```

Then run the complete pure/behavioral smoke command above before integrating.
The new Windows DriveInfo probe and real ancestry checks need that real local
smoke; the pure drive-classification test alone does not validate the OS probe.

### Parent verification and measurements (2026-09-12)

The preceding handoff descriptions are historical, not the current test result.
Independent SPEC and a separate fresh QUALITY review passed on source. Parent
then observed all eight SPEC2 tests GREEN and all 13 Node tests GREEN, including
the real Windows drive probe and 100-document behavioral smoke. Both arms
passed all 18 query gates per size and rejected the stale read (36 query gates
plus two stale probes for each completed size). Smoke minimum sampled free RAM
was 3.684 GiB under an additional outer 50 ms supervisor.

The 1,000-document run completed with the same quality result. Its complete
synthetic report is [preservation-benchmark-1000.json](2026-09-12-preservation-benchmark-1000.json).
One 10,000-document attempt was stopped at a sampled 3.456 GiB by the outer
supervisor, which confirmed successful tree termination. No valid scale result
is claimed for that attempt. Its synthetic temporary fixture was retained
because the coordinator was forcibly stopped; no real Vault was used.

After free RAM recovered, a fresh 10,000-document run completed successfully:
all 36 query gates passed, both stale reads were rejected, and the outer
supervisor sampled at least 4.206 GiB free. Its full report is
[preservation-benchmark-10000.json](2026-09-12-preservation-benchmark-10000.json).

Measured first/warm passes below each contain six fixed questions, not six
independent repeated trials. Values are rounded; see raw data for the 1,000
case. Logical bytes are successful instrumented local reads, not physical/NAS IO.

| Documents | Arm | First-pass ms | Warm-pass ms | Warm source bytes | Initialization bytes | Maintenance bytes | Worker max RSS MiB |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | vanilla | 224.0 | 212.8 | 2,358,299 | 389,444 | 389,444 | 82.3 |
| 100 | preservation | 258.4 | 204.4 | 43,270 | 432,716 | 4,327 | 126.9 |
| 1,000 | vanilla | 2,265.1 | 2,464.1 | 23,388,245 | 3,894,435 | 3,894,435 | 87.5 |
| 1,000 | preservation | 375.2 | 311.9 | 43,270 | 4,327,153 | 4,327 | 146.5 |
| 10,000 | vanilla | 23,362.4 | 20,759.5 | 233,687,723 | 38,944,348 | 38,944,348 | 115.1 |
| 10,000 | preservation | 1,152.9 | 1,052.4 | 43,270 | 43,271,522 | 4,327 | 378.9 |

For 1,000 documents, sum of all measured phases, including startup, initial
probe, three query passes, source update, stale probe, maintenance and teardown:
vanilla 8,922.5 ms / 77,957,932 source bytes; preservation 2,956.3 ms /
4,465,617 source bytes. The corresponding process wall times were 9,198.2 and
3,238.6 ms; fixture creation was a separate shared 1,645.3 ms. These totals do
not price module IO, persistent cache creation or a model.

At 10,000 documents, the same all-phase totals were vanilla 83,750.7 ms /
778,956,192 source bytes and preservation 11,169.7 ms / 43,409,986 source
bytes. Process wall times were 83,993.8 and 11,428.6 ms; shared fixture creation
took 16,407.9 ms. Startup/initialization costs and higher indexed worker memory
are retained in these comparisons, not hidden as a free precondition.

Each six-query pass used 11 retrieval calls and 1,187 serialized request
characters in both arms. Vanilla returned 2,112 characters, while preservation
returned 5,292 characters because its evidence envelope is larger (at 10,000
documents: 2,113 and 5,293 respectively). These are
UTF-16 counts, **not model tokens**: lower read IO did not mean a smaller reply,
and the indexed path used more peak worker memory. No overall token, monetary,
semantic-answer-quality or NAS-traffic improvement is established by this data.
