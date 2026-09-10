# Windows PDF AppContainer host: integration handoff

Current Main verification (2026-09-10): per-job host compiled, contracts passed,
native bilingual/column-table and opt-in Korean OCR extraction and cleanup passed.
The synthetic scan preserved five critical sentence bodies and their line boxes;
identifier and spacing errors remain. Actual OS probes on the OCR-enabled host
passed for the selected remote TCP endpoint, private-file read, runtime write,
child policy and stdin EOF. Explicit OCR-only configuration selected a 2048 MiB
job budget; default/native-only budgets remain 1024 MiB. Exhaustion/adversarial
matrices and general OCR accuracy remain unverified; this is not universal
isolation certification.

Historical sidecar handoff: **the original sidecar did not compile or certify the host**.
This sidecar owns only `scripts/pdf-appcontainer-host.cs` and this document.
No profile creation, ACL mutation, compiler/build, npm, installation, NAS access,
Git commit or deployment was performed by this sidecar. Main owns Node admission,
queue/provider integration and all subsequent compile/provision/live tests.

Read-only verification: 12 source-contract assertions passed (creation/attach/
token/resume ordering, zero capabilities, kill-on-close, child policy, stdout cap,
environment/shell exclusion, fixed stderr, diagnostic denial and profile creation
gating). Both new files passed a direct trailing-whitespace scan; scoped
`git diff --check` also exited 0, but does not by itself inspect untracked files.
These are static checks, not compiler, functional or security-test results.

Main subsequently reported that the prior/current-at-that-time source compiled
with .NET Framework csc and its contract test passed, and that a trusted bilingual
two-page fixture passed real native Docling hash/page/bbox checks. These are
Main-reported results, not rerun here and not OS sandbox evidence. Main will
recompile this final per-job-profile revision. Its new profile/delete helper
tests have not been executed by this sidecar. Main's ACL helper remains separately
owned and was not modified here.

## Exact Node runner contract

```text
pdf-appcontainer-host.exe --profile <fresh-profile> --python <absolute-python.exe> --worker <absolute-worker.py> --job-dir <absolute-private-job-root> --max-memory-mb 1024 --timeout-seconds 120 [--runtime-root <dedicated-runtime-root>] [--models <dedicated-readonly-models-root>] -- <worker-flags>
```

- `--profile` is required in **every mode except standalone `--contract-self-test`**.
  Exact format: `mcpvault-pdf-v1-` followed by **32 lowercase hex characters**;
  full-string validation rejects uppercase, whitespace/newlines, other prefixes,
  the legacy fixed `mcpvault-pdf-v1` and missing/duplicate options. Node generates
  `const profile = 'mcpvault-pdf-v1-' + randomUUID().replace(/-/g, '')` once for each
  job (including diagnostic jobs), retains that exact value for cleanup, and never
  reuses it. Host configuration only; no document/model choice of profile name.
  This is the OS identity, not the Python worker's extraction/cache `profile` field,
  which stays unchanged. Data-mode stdout remains the worker bytes.
- `--runtime-root` defaults to the parent directory of `--python`. Both Python
  and the trusted worker copy must be descendants of that root. A venv whose
  Python/DLLs/stdlib live elsewhere is **not** a self-contained runtime. Stage
  a dedicated environment; do not grant the repository or user's Python home.
- `--models` is the exact flag, **not** `--models-dir`. Optional models root is
  separate from runtime and job roots. `--model-manifest` must be underneath it;
  its `artifactsRoot` must be a descendant of that models root, and the manifest
  must be outside `artifactsRoot`. The worker separately checks all file hashes.
- `--input` must be an existing file under `--job-dir`, at most 50 MiB. The caller
  authorizes the source first and copies its immutable revision into that root.
- All CLI configuration and flags come from trusted host configuration. Neither
  PDF text nor metadata nor a model may choose executable, worker, root, manifest,
  provisioning, diagnostics or interpreter arguments. There is no shell.
- Worker flags: `--check`, `--input`, `--output-json stdout`, `--max-pages 1..200`,
  `--timeout-seconds` (positive, no larger than host timeout), `--pages 2,7`,
  `--layout`, `--ocr off|rapidocr`, `--model-manifest`, `--expected-sha256`.
  Duplicates, unknown options and interpreter flags are rejected. Supply exactly
  one of `--check` or `--input`; enrichment requires a manifest.
- Interpreter argv is fixed `python -I -B <worker> ...`. No user site, inherited
  PYTHONPATH or Python environment overrides; the trusted environment can still
  contain site-packages and its own initialization code.

**Data-mode stdout is exactly the worker bytes, buffered until normal exit**;
there are no host banners or JSON wrappers. Worker exits 0/2/3/4/5 are preserved,
including JSON on nonzero worker exits. The parent validates UTF-8/JSON/schema,
exit agreement, source SHA, provenance, bounds and scope before accepting it.
No host-side claim that malicious child bytes are valid or free of paths is made.
Trusted worker code implements fixed-code error serialization; extracted PDF text
is still untrusted data, not a log or instruction source.

On host failure, stdout is empty and stderr is **one bounded snake_case code plus
newline**, never an exception, command line, path, source contents or native error
message. Worker stderr goes directly to `NUL` and stdin receives immediate EOF.
Abnormal process exits use `worker_abnormal_exit_<8hex>`: exactly eight lowercase
hex digits from the unsigned 32-bit `GetExitCodeProcess` status, formatted with
invariant culture (for example, exit 1 is `worker_abnormal_exit_00000001`). The
host still returns exit **71**, emits no child output and exposes no child stderr.
This indicates process creation, Job attachment, token checks and resume completed,
but the process ended outside the accepted worker statuses 0/2/3/4/5. It is distinct
from pre-resume host errors such as `appcontainer_create_failed`/`job_attach_failed`;
the numeric status helps Main investigate loader/interpreter startup versus later
worker failure, but does not by itself prove the Python worker body started or
identify the root cause. Normal worker statuses and stdout passthrough are unchanged.
The host cannot retract output if its downstream stdout consumer fails while
receiving already validated-size bytes; Node must reject truncated results.

| Exit | Meaning | Examples |
| --- | --- | --- |
| 0, 2, 3, 4, 5 | Worker normal completion | See document-pdf-worker-contract.md |
| 70 | Configuration/admission/ACL/token invariant failed | `invalid_arguments`, `profile_not_provisioned`, `acl_broad_principal_rejected`, `sandbox_busy` |
| 71 | Host/native launch or process failure | `appcontainer_create_failed`, `job_attach_failed`, `worker_abnormal_exit_<8hex>`, `sandbox_host_failed` |
| 72 | Hard deadline expired | `sandbox_timeout` |
| 73 | More than 16 MiB stdout | `sandbox_output_exceeded` |
| 74 | Diagnostic evidence failed/inconclusive | Diagnostic JSON with `passed:false`, or fixed error |

Some diagnostic preconditions use 70/71 rather than 74. Classify host failure by
exit >=70, not solely the example strings. No fallback to unrestricted Python,
automatic installation, shell, OCR subprocess or permission broadening is allowed.

Example Node shape (configuration variables are operator-supplied, not document
parameters; this is guidance, not a change to Main-owned code):

```javascript
const argv = [
  '--profile', profile, // Fresh per-job identity, also used for setup and cleanup.
  '--python', config.python, '--worker', config.worker,
  '--job-dir', privateJobRoot, '--max-memory-mb', '1024',
  '--timeout-seconds', '120',
  ...(config.runtimeRoot ? ['--runtime-root', config.runtimeRoot] : []),
  ...(config.modelsRoot ? ['--models', config.modelsRoot] : []),
  '--', '--input', privatePdf, '--output-json', 'stdout',
  '--max-pages', '200', '--timeout-seconds', '120',
  '--expected-sha256', sourceSha256,
];
// spawn(config.sandboxHost, argv, { shell: false, windowsHide: true,
//   stdio: ['ignore', 'pipe', 'pipe'] });
```

Node still bounds its own buffers/stderr, hard-kills a hung host, serializes work,
rejects incomplete output and cleans/revokes job access. The host's Job handle
is not inherited, so host death closes the handle and kills its attached worker.

## Enforced launch sequence

1. Validate the required per-job profile, derive its SID and require its profile folder.
   Normal launch never creates a profile or changes an ACL.
2. Acquire a non-waiting, per-Windows-account global mutex. Start the monotonic
   deadline before path/ACL preflight; defaults 120 seconds, allowed 1..3600.
3. Validate drive-qualified local fixed-volume paths, reject UNC/device/ADS,
   dot segments, DOS device names, short-name aliases, junctions/reparse points
   and hardlinked files. Pin ancestors against rename/delete and existing
   runtime/model/job files against writes while this host is alive.
4. Audit every existing runtime/model/job entry's owner and DACL. Root DACLs
   must be protected. Only current host user, SYSTEM, Administrators and this
   exact container SID may have allow entries; deny/custom/broad ACLs fail
   closed. Container grants must include RX on runtime/models or Modify on jobs,
   with no additional rights (including ACL/owner changes). File/tree enumeration
   is bounded: 32,768 runtime entries, 4,096 models entries, 4,096 job entries.
5. Create Job Object: one active process; process/job committed-memory limits
   1024 MiB by default (64..4096); kill-on-close; no breakaway flags; UI limits.
6. Create child suspended and console-detached using `STARTUPINFOEX`, a zero-
   capability `SECURITY_CAPABILITIES`, child-process-restricted policy, and an
   explicit three-handle inheritance list. Assign Job Object **before resume**.
7. Verify job membership and actual child token: AppContainer, expected SID,
   zero capabilities, low integrity. Any API/invariant failure aborts; an
   unattached suspended process is explicitly terminated, never resumed.
8. Resume, poll/drain stdout under the same deadline, cap at 16 MiB including
   LF, discard stderr, return bytes only after acceptable normal exit. Timeout,
   overflow and errors terminate the Job/process before handles are released.

Job limits are committed memory, **not a precise resident-set cap**, GPU quota,
disk quota or two-thread enforcement. The worker configures parser/math pools to
two threads; native runtimes may create additional helper threads. `DETACHED_PROCESS`
avoids console allocation/attachment but does not prove absence of all UI side effects; AppContainer and Job UI limits are
additional boundaries. Supported target: x64 Windows 10+/Server 2016+ with the
required classic APIs and .NET Framework 4.x. Unsupported attribute/job/token
behavior is a hard failure, never a compatibility fallback.

Environment is created from scratch: Windows directory/SystemRoot, runtime+
DLLs+System32 PATH, job-local TEMP/TMP/HOME/USERPROFILE/APPDATA/LOCALAPPDATA and
cache roots, offline/telemetry flags and thread settings. No parent environment
enumeration occurs; API keys, proxies, credentials, PYTHONPATH and DOCLING debug
overrides are not inherited. Windows Known Folder APIs may still resolve the
AppContainer's own profile storage rather than these environment paths.

`TORCHINDUCTOR_CACHE_DIR` is explicitly job-local as well. PyTorch's default
cache lookup can require a username; the host supplies neither a username nor
an inherited cache path. The Node operator configuration may explicitly select
2048 MiB for OCR-enabled jobs through `ocrMemoryMb`; all default budgets and
native-only jobs remain 1024 MiB. This changes committed-memory limits only,
not capabilities, the 120-second deadline, or the one-process restriction.

## Explicit host provisioning (not per request)

All commands in this section are **handoff instructions, not executed evidence**.
Review/compile the source first. Keep generated binaries outside the repository
unless Main intentionally chooses to track a build artifact.

```powershell
# Later, by Main/operator: classic x64 .NET Framework compiler, no NuGet.
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /platform:x64 /r:System.dll /r:System.Core.dll /r:System.Web.Extensions.dll /out:C:\MCPVaultPdf\host\pdf-appcontainer-host.exe E:\dev\llm_wiki\scripts\pdf-appcontainer-host.cs

# Alternative: Windows PowerShell 5.1 Add-Type, once per fresh process.
# Add-Type -Path E:\dev\llm_wiki\scripts\pdf-appcontainer-host.cs -ReferencedAssemblies System.dll,System.Core.dll,System.Web.Extensions.dll
# [PdfAppContainerHost]::Main([string[]]@('--contract-self-test'))
```

The output parent directory must already exist and be host-only. Do not run as
administrator for ordinary extraction; create/provision under the same Windows
account that will run Node. Compiler and Add-Type paths above are examples,
not claims about installed components.

Explicit modes, never appended to a document job:

```text
pdf-appcontainer-host.exe --profile <fresh-profile> --create-profile
pdf-appcontainer-host.exe --profile <same-profile> --provision-runtime C:\MCPVaultPdf\runtime --models C:\MCPVaultPdf\models
pdf-appcontainer-host.exe --profile <same-profile> --provision-job C:\MCPVaultPdf\jobs\opaque-job-id
pdf-appcontainer-host.exe --profile <same-profile> --delete-profile
```

`--create-profile` is the **only** mode calling `CreateAppContainerProfile`;
existing profile is **rejected** with exit 70 / `profile_already_exists`, never
silently reused. Creation success returns
`{"version":1,"profile":"<same-profile>","profileCreated":true}`.
Other creation API failures return exit 71 / `profile_create_failed`.

`--delete-profile` is the **only** mode calling `DeleteAppContainerProfile`,
strictly scoped to the validated exact name under the current Windows user.
It accepts only `--profile` and `--delete-profile`, no worker arguments or other
mode flags. Call it **only after confirmed worker exit and closed storage handles**.
It refuses while this host's account-wide launch mutex is held (`sandbox_busy`).
Deletion success returns
`{"version":1,"profile":"<same-profile>","profileDeleted":true}`.
Any nonzero HRESULT returns exit 71 / `profile_delete_failed`, empty stdout and
fixed stderr; no fallback deletion, recursive filesystem cleanup or automatic
retry is attempted. Microsoft defines deletion of a nonexistent profile as success,
so an explicit cleanup retry for the same recorded name is permitted. The API
warns that open handles can prevent complete storage removal and a failed call
leaves state undetermined; the parent must keep the provider blocked on cleanup
failure, verify cleanup, and never reuse the identity. The success field reports
the API result, not secure erasure or a registry/filesystem forensic audit.
[DeleteAppContainerProfile contract](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-deleteappcontainerprofile)

`--provision-runtime` and `--provision-job` are **read-only plan output**. Roots
must already exist. They return `applied:false`, the derived SID, exact directory
and file SDDL templates, and a low-integrity `icacls` argv for jobs. They do not
execute a shell, alter DACLs, mark integrity, or verify/apply the resulting tree.
Plan output deliberately contains operator paths; never expose it as PDF results.

An operator must inspect the dedicated tree and every descendant for links
before applying templates; replace DACLs, do not merge with unknown explicit
grants. The provider uses the trusted **PowerShell 7** `pdf-job-acl.ps1` helper:
it validates every descendant, rejects protected/custom child DACLs, preserves
the verified owner and SACL, and replaces only the root DACL through
`FileSystemAclExtensions`. Inherited child DACLs receive that replacement.
It does not consume the plan's legacy manual `applyWith` text or change owners.
Apply the job-only low mandatory label separately with the `icacls` argument
array (no shell interpolation). RX grants go exclusively to this package SID,
not Everyone, Users, Authenticated Users, ALL APPLICATION PACKAGES, a model's
name or another package. Host user/SYSTEM/Administrators retain full control.
The launcher performs a fresh DACL audit, not a trust of plan output.

Stage runtime and models once, but **replace their container ACL grants for the
new SID on every job**, under the serialized lifecycle with no running worker.
Remove all former package SID grants instead of accumulating RX grants. Stage
the trusted worker inside runtime. Jobs are unique,
host-created directories with only approved PDF/manifest data: the job's exact
SID Modify grant and low label are necessary per-job setup, never a broad parent
grant. The host does not create input/cache/job directories on Node's behalf.
Existing files are pinned read-only during launch; new worker temp/cache files
can be created within the job. No ACL is added to the drive root, user home,
repository, live Vault or ancestor for traversal convenience.

### Main integration clarification: exact job-plan JSON

The CLI below takes the required profile and already-created unique job directory; do not
pass Python, worker, runtime or worker flags to this mode:

```text
pdf-appcontainer-host.exe --profile <same-profile> --provision-job E:\dev\llm_wiki\.mcpvault\pdf-host-v1\jobs\opaque-job-id
```

Exit 0 means plan generation succeeded, **not that access was configured**.
Stdout is one administrative JSON object with these exact fields. `<HOST_SID>`
and `<CONTAINER_SID>` below are placeholders replaced with actual SID strings;
whitespace is illustrative (the launcher serializes compact JSON):

```json
{
  "version": 1,
  "profile": "mcpvault-pdf-v1-0123456789abcdef0123456789abcdef",
  "containerSid": "<CONTAINER_SID>",
  "applied": false,
  "warning": "Replace DACLs only on reviewed dedicated trees; reject links first; never apply to a home, repository, Vault or drive root.",
  "roots": [{
    "path": "E:\\dev\\llm_wiki\\.mcpvault\\pdf-host-v1\\jobs\\opaque-job-id",
    "containerAccess": "Modify",
    "directorySddl": "O:<HOST_SID>D:P(A;OICI;FA;;;<HOST_SID>)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1301bf;;;<CONTAINER_SID>)",
    "fileSddl": "O:<HOST_SID>D:P(A;;FA;;;<HOST_SID>)(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1301bf;;;<CONTAINER_SID>)",
    "applyWith": "Operator: validate every existing descendant is local, not reparse/hardlinked; use DirectorySecurity/FileSecurity.SetSecurityDescriptorSddlForm(sddl, Access|Owner) and Set-Acl -LiteralPath for each. This replaces, not merges, the DACL.",
    "integrityCommand": {
      "executable": "icacls.exe",
      "argv": ["E:\\dev\\llm_wiki\\.mcpvault\\pdf-host-v1\\jobs\\opaque-job-id", "/setintegritylevel", "(OI)(CI)L", "/T"]
    }
  }]
}
```

**The returned `icacls` command only applies the integrity label. It does not
grant the container SID access or replace the DACL.** Node may run that exact
validated argv with `shell:false`, `windowsHide:true`, using the host-configured
absolute Windows System32 `icacls.exe`, after separately applying both SDDL
templates with a trusted host ACL helper. `applyWith` is human guidance, never
script text to evaluate. The launcher has no apply-plan mode or DACL-grant argv.
Keep provisioning logs private; a failed external ACL command may print paths.

For Node's per-job lifecycle:

1. Hold the single-account queue's exclusive slot for **setup through cleanup**.
   The launcher's mutex guards launch/deletion, not the full Node ACL lifecycle.
   Generate and retain a fresh random profile name; explicitly create it. Reject
   reuse/collision. Obtain runtime/models plans for its derived SID and replace
   their DACLs without retaining any earlier package grants; re-read to verify.
2. Create an opaque `job-<32 lowercase hex>` directory beneath the dedicated
   jobs parent. Establish and verify its private DACL **before** staging any
   authorized snapshot bytes. A random name alone does not establish privacy.
3. Request the plan. Require one root exactly matching the resolved job path,
   this exact job's profile, expected derived SID, `applied:false`, expected Modify mask
   and exact integrity argv. Reject links/reparse points/hardlinks and root escape.
4. The trusted PowerShell 7 helper requires inherited descendant DACLs and
   validates the full tree before replacing only the root DACL; owner and SACL
   remain unchanged. Never change the shared jobs parent, repository root or
   another job. Runtime/models receive their own separately validated RX grant.
   Apply the job-only low-integrity argv and check its exit.
5. Re-read owner/DACLs; launch only on success. The launcher independently audits
   the existing tree again. Missing grant/unsupported permissions fail closed.
6. Wait for confirmed worker exit. Explicitly delete this job's profile and require
   API success. Revoke its runtime/model grants and re-read. Revoke the package SID from **every** remaining
   descendant (root-only revocation is insufficient for protected child DACLs),
   or securely remove the validated exact job tree with reparse-safe cleanup.
   Re-read/verify cleanup before opening the next confidentiality scope. If it
   fails (including after partial setup), leave the provider unavailable until the
   profile, stale grants and job storage are repaired. Never run another scope as
   a workaround for a failed cleanup.

Fresh profile names yield distinct package identities, separating job package
storage/registry instead of reusing the legacy fixed SID. The format validator
cannot prove randomness or historical non-reuse: that is Node's responsibility.
Do not pre-provision concurrent scope-bearing jobs or rely on a job pathname
alone as an access boundary. The old fixed profile is rejected even for deletion;
retiring any old deployment/storage needs a separately authorized operator action.

For Main's reported dedicated embedded-Python staging path, use these runtime
arguments after the worker has been copied there (no provisioning is claimed here):

```text
--profile <same-profile> --python E:\dev\llm_wiki\.mcpvault\pdf-host-v1\runtime\python.exe --worker E:\dev\llm_wiki\.mcpvault\pdf-host-v1\runtime\document_pdf_worker.py --runtime-root E:\dev\llm_wiki\.mcpvault\pdf-host-v1\runtime
```

Grant only that dedicated runtime subtree RX to the current job SID, never `E:\dev\llm_wiki`.
The `--runtime-root` is optional here because it equals Python's parent.

## Explicit OS diagnostic and acceptance gates

Pure helpers, no profile/ACL mutation or child launch:

```text
pdf-appcontainer-host.exe --contract-self-test
```

This checks strict profile validation, missing-profile/config parsing, Windows
argument round trips, lexical rejection/containment and x64
interop structure sizes. It requires compilation and Windows; it is **not** an
isolation test. It was not run in this sidecar session.

After explicit provisioning, supply an existing private, nonsensitive sentinel
file outside all grants plus an **operator-owned, reachable non-loopback IPv4
TCP listener**. Do not point the diagnostic at NAS, a third party or a document-
supplied address. The host performs a TCP handshake as positive control but
sends no application/document bytes. No probe file contents are read or returned.

```text
pdf-appcontainer-host.exe --profile <fresh-diagnostic-profile> --python C:\MCPVaultPdf\runtime\python.exe --worker C:\MCPVaultPdf\runtime\document_pdf_worker.py --job-dir C:\MCPVaultPdf\jobs\diagnostic-id --timeout-seconds 30 --self-test --probe-file C:\MCPVaultPdf\private\sentinel.txt --probe-ip <operator-owned-listener-ipv4> --probe-port <port>
```

The trusted diagnostic runs `python -I -B -c <fixed-probe>` through the **same**
launch/Job/token/pipe/environment path. It does not import the PDF worker's
socket monkeypatch. Host-side opening/connecting must succeed. Inside the
container it attempts private-file read, runtime-file write-open without truncate,
TCP connect and spawning only `python -I -B -c pass`, then checks stdin EOF.
If the sandbox is broken, that harmless child may actually start; no arbitrary
probe command is supported. Exit 0 and `passed:true` require exact native evidence:

| Probe | Required observation |
| --- | --- |
| Network | WSAEACCES **10013**, not refusal/timeout/unreachable |
| Private-file read | ERROR_ACCESS_DENIED **5**, not missing file |
| Runtime write | ERROR_ACCESS_DENIED **5**, not sharing violation |
| Child spawn | ERROR_ACCESS_DENIED **5** or ERROR_CHILD_PROCESS_BLOCKED **367**, not arbitrary process failure |
| Input | EOF |

Other errors are failure/inconclusive, not proof. `--self-test` emits separate
diagnostic JSON, not PDF worker JSON. One IPv4 TCP test is evidence for that probe,
not proof of every interface/UDP/IPv6/IPC policy. Repeat with representative host
network profiles and inspect Windows firewall/network isolation/loopback exemptions
before enabling extraction. Test private scopes with a harmless sentinel whose
ACL resembles production, never with actual credentials.

Main's minimum later validation matrix:

- Compile, pure contract test, missing-profile rejection; unknown/duplicate flags,
  UNC/ADS/junction/hardlink/sibling-root and broad/missing/writable runtime ACL rejection.
- Actual sandbox diagnostic positive/negative controls, then `-- --check` metadata
  probe and a native PDF fixture under the same settings. `--check` alone does not
  import DLLs or prove native PDF availability.
- Trusted test-only worker fixtures: stdout at 16 MiB / +1, noisy stderr, no stdin,
  hanging process, abnormal exit, >memory allocation, child creation attempt.
  Fixture executables/scripts must stay in a dedicated ACL-audited runtime.
- Verify timeout/overflow leave no child process; forcibly stop a live host and
  verify Job kill-on-close; attempt concurrent launch and require `sandbox_busy`.
- Intentionally incompatible outer Job/unsupported attribute: no fallback or
  resumed orphan. Verify normal exits 0/2/3/4/5 preserve exact stdout bytes.
- Model manifest outside allowed root, artifactsRoot escaping it, absent/extra
  model files; verify worker hash checks and unavailable behavior.

## Approved data-free debugger mode (operator only)

`verify-pdf-sandbox-check.ps1` normally runs the configured production host without
a debugger. Its optional `-DiagnosticHost` and `-ConsoleDebugger` must be supplied
together and are not exposed to MCP clients. The diagnostic executable must be
the dedicated boundary's `pdf-appcontainer-debug-host.exe`, compiled from this
source with `/define:PDF_HOST_DIAGNOSTICS`. The normal build has no wait hook.

The diagnostic build requires `--check`, creates the same suspended AppContainer
child, assigns the same Job and verifies its token before emitting the child PID.
The operator opens and retains a kernel process handle before parent/image
validation; CDB attaches only to that PID. WMI's image path can be unavailable
before loader initialization, so the image is obtained from the retained handle.
Only CDB resumes the diagnostic child; production retains its strict single
`ResumeThread` check. Deadlines remain enforced and an unconfirmed child exit
prevents profile/ACL/job cleanup and retains recovery state.

CDB must have a valid Microsoft signature. `pdf-loader-diagnostic.cdb` sets
process-local loader snaps and bounded diagnostic commands; it contains no
OS-build-specific offsets. `-xe ld` initializes tracing before DLL initialization,
`-cf` avoids command-line quote ambiguity, and debugger-generated breakpoint
events are logged and continued for this data-free test. OS public symbols may
be downloaded from Microsoft's symbol server into the dedicated local cache.
No real PDF input, registry/IFEO/WER edits, machine-wide tracing, dumps, source
server requests or shell commands are part of this mode. Local loader logs stay
under the excluded host boundary and may contain machine paths; do not commit them.

2026-09-10 evidence: `ConsoleAllocate` returned `0xc000049d`; `ConsoleInitialize`
returned false at base initialization stage `0x258`, after CSR and NLS succeeded.
The detached diagnostic build reached stage `0x2bc`, returned success from console
initialization and exited `--check` normally. This proves the startup correction
in diagnostic mode, not real extraction. After explicit approval, the backed-up
production executable was replaced and its non-debugger data-free `--check` also
passed. The later synthetic PDF check returns `input_unavailable` before hashing;
production extraction readiness is still unproven.

## Concrete limitations / enablement blockers

1. **Historical startup blockers, subsequently resolved.** Approved
   child-PID-only WinDbg tracing identified `KERNELBASE!ConsoleAllocate` returning
   `0xc000049d` during `ConsoleInitialize`, followed by DLL initialization failure
   `0xc0000142`, before Python starts. CSR and NLS initialization succeeded.
   The source now uses `DETACHED_PROCESS` instead of `CREATE_NO_WINDOW` without
   changing capabilities, Job UI mask `0xff`, process/memory limits or child
   restrictions. The old flag fails the new creation-flag contract; the new flag
   passes. A separately compiled diagnostic host passes data-free `--check` with
   exit 0 and verified profile/ACL/job cleanup. After host approval policy rejected
   replacement twice, the user explicitly approved the exact executable backup
   and replacement. The non-debugger production `--check` then passed (exit 0)
   and cleanup was verified. The later `input_unavailable` was traced to `lstat`
   above the private job grant: staged-file open succeeded, ancestor metadata
   and strict realpath resolution failed. Broker-owned roots now bound the
   worker's checks while the native host retains all-ancestor canonical pins.
   Caller root overrides are rejected. Native bilingual and column/table PDF
   extraction passed, with original hash/page boxes and cleanup. The scan
   fixture initially reported OCR unavailable. Later OCR provisioning and the
   synthetic scan passed as summarized above; layout quality, hostile-PDF,
   hard-timeout and memory-exhaustion matrices are not certified.
   No security restriction or ancestor ACL was relaxed.
2. AppContainer is not a VM/chroot. Ordinary AppContainers can access OS resources
   granted to all application packages and their own per-user persistent package
   storage/registry. The code does not implement LPAC, securely erase storage or
   globally enumerate external SID grants. Do not claim the job root is its only
   writable location or that an audited runtime is the whole accessible filesystem.
3. **Fresh identity and verified cleanup are mandatory.** The legacy stable SID
   is no longer accepted. Each new profile has its own SID and package storage;
   never reuse a name or retain previous SID grants on runtime/models. Profile
   deletion is explicit, not automatic on extraction failure. Node owns cleanup
   even after partial setup or host crash, and must block on any cleanup failure.
   One host-account mutex prevents concurrent launches through this host, not
   another broker/process using the SID. Use a dedicated Windows service account,
   one lifecycle queue, no other launchers and verify old grants/storage are gone.
   Multi-tenant confidentiality and complete deletion are not certified here.
4. Ancestor inspection grants no permissions. The native host validates and pins
   every ancestor, then appends `--trusted-input-root` and configured
   `--trusted-model-root`; neither flag is accepted from its caller allowlist.
   Windows `local_path` requires component-aware containment and checks the root
   itself and every descendant. Input/model roots are passed separately. Without
   these broker-only arguments the worker checks the full ancestry; non-Windows
   CLI calls reject them. These flags are not authentication or an access grant.
   Never grant home/drive listing or broad RX to work around a failed check.
   Antivirus/inherited enterprise deny ACLs may be incompatible with the baseline.
5. Host/admin/SYSTEM are trusted. Handles protect existing objects from rename/
   write races, but this is not a defense against another privileged process
   changing ACLs, mount configuration or appending new children during preflight.
   Keep roots quiescent and package storage private. The root-name checks cannot
   prove an operator-selected directory contains no secrets.
6. Job low integrity labels are required but not independently read/attested by
   the launcher. Missing labels usually cause temp writes to fail; verify a real
   extraction that uses temp files. No disk/output-file quota exists. Parent must
   bound job staging/storage, monitor cleanup and retain an external host timeout.
7. Deadline covers preflight+child work after mutex acquisition, with up to a
   two-second failure cleanup wait. Synchronous OS/filesystem calls and blocked
   downstream stdout cannot themselves be interrupted by this managed timer;
   Node must retain its own watchdog. Global mutex is non-waiting; profile lookup
   and configuration parsing happen before that timer. Memory limits may be too
   low for optional layout/OCR and must not be silently raised.

## Official API basis

- [AppContainer launch and capability/access model](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)
- [CreateAppContainerProfile](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createappcontainerprofile)
- [DeleteAppContainerProfile](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-deleteappcontainerprofile)
- [DeriveAppContainerSidFromAppContainerName](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-deriveappcontainersidfromappcontainername)
- [Process attributes: security, explicit handles and child restriction](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
- [Process creation flags: detached versus hidden console](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)
- [CDB command-line options](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/cdb-command-line-options)
- [SECURITY_CAPABILITIES layout](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-security_capabilities)
- [Token information classes](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class)
- [Job Objects and nested-job/breakaway semantics](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Job limit fields and committed memory](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)

These references informed the source design; they are not evidence that this
implementation or deployment passed the corresponding behavior tests.
