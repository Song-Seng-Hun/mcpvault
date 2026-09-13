# Revision-pinned compilation foundation

`wiki.compilation` is a dynamic endpoint, not a sixth MCP tool. Markdown,
Properties, exact revisions and the existing access rules remain authoritative.
Policy admission and durable processing records are complemented by local
fidelity diagnostics and a host-selected publication adapter. Codex hook activation
is a separate gate. No model, provider or scheduler is started.

## Independent permission checks

1. Current account, scope, document restrictions and moderation determine access.
2. A trusted host verifier identifies the actual runtime and allowed operations.
3. Each explicitly enrolled source has `source_only` or `synthesis_allowed` mode.

`source_only` rejects synthesis; it does not itself authorize embeddings or other
processing. `embed`, `vision`, `convert`, `index` and `synthesize` each require an
explicit project operation and matching verified runtime. Confidential inputs
also require the existing local-inference access boundary and a verified local
processing runtime. A missing runtime waits; no external fallback is attempted.
Changing a model name or selecting a feature cannot satisfy these checks.

Classification `unresolved` requires review before collection. Existing documents
are never enrolled or reclassified as a side effect of discovery. MCPVault Global
is public/synchronizable, unlike Arkon's company-wide global scope.

## Host configuration

`--compilation-config` accepts an explicit private host JSON file bound to its
`vaultPath`. The loader reuses maintenance's verified filesystem, private-ACL,
link, revision and writer-lease safeguards with a separate `compilation` namespace.
It does not accept a maintenance grant or create a repository/Vault fallback.
Malformed history and interrupted writer markers require host review, not reset
or automatic lease stealing. Do not place actual host configurations in Git.

The configuration has `version:1`, `enabled`, `accountId` and up to32 projects.
Each project supplies `id`, `ruleVersion`, `sources`, `outputPaths`, `runtimeIds`
and `operations`. Each source has an exact canonical Markdown `path`, explicit
`classification` (`resolved`/`unresolved`) and `mode`. Source/output lists are
bounded64/32; runtime IDs16; no wildcards or inherited folder approval. Outputs
cannot be original or managed community/control paths. Those limits are capacity
limits, not recommended batch sizes; a job admits at most8 exact dependencies.

The CLI loads policy only: it cannot attest the execution behind a client and
does not install an application adapter. A programmatic host must separately
provide the `compilation.runtime` verifier, and later a validated
`compilation.adapter` backed by existing publication/change-set services. Neither
can be supplied in endpoint arguments. Without a host configuration all operations
are diagnostic-only; without the actual checker/writer, work remains incomplete.
Operational auto-application stays disabled until quality and real-host gates pass.

`diagnose` reports missing `host_policy`, `runtime_verifier` or
`publication_adapter` components without paths or job counts. Even with those
objects supplied, it reports `automaticApplication:false`, per-job admission and
unattested model quality: connectivity is not an execution grant.

## Existing-session coordinator

Trusted programmatic hosts can call `CompilationService.runSession` for one
already-prepared synthesis job, with its exact job revision. The host supplies
the current session's `generate` callback, fresh `assertCurrent`, cancellation
signal and a deadline of at most five minutes. No model or provider is started
by the service. The callback returns draft/evidence or a no-write observation;
it cannot write documents, including from late asynchronous continuations.

The coordinator reserves generation durably before calling the session, then
uses existing submit/check operations. Default `application:'check_only'` stops
at a checked private draft. Host-only `apply_verified` additionally permits the
existing retry/publication/reread path, but requires actual quality and operation
grants; client arguments cannot select it. Source-only jobs never generate.

Existing drafts are checked first. One partial draft may be refined once.
An uncertain generation reservation is retained across restart and requires
review, not another model call. Cancellation returns promptly while the worker
remains held until the actual callback settles. Completed jobs reconcile without
generation; manual output changes remain conflicts. Missing or corrupt history
is never reset to make a session run.

## Endpoint operations

| Operation | Effect | Required basis |
| --- | --- | --- |
| `diagnose` (default) | Compact availability, no source body or persistent job | none |
| `prepare` | Persist policy/basis header and inherit restrictions | stable request ID, project, input revisions/roles, output revision |
| `read` | Current-authority metadata, optional pinned inspection; never draft body | authenticated job owner and request ID |
| `submit` | Store a bounded draft/evidence OR a no-write observation privately | current job revision |
| `check` | Record actual checker result, or report incomplete validation | current job revision |
| `retry` | Revalidate and reconcile a prior application before attempting work | current job revision and actual host adapter |

All mutating operations require the existing write capability and reject read-only
mode. Tool discovery advertises operation-level availability, but services repeat
the checks. `maxChars` is512..12000; errors and projections omit hidden paths,
titles, department names, bodies and rejected candidate counts.

Inputs record exact revisions and explicit `source`, `member`, `concept` or `topic`
roles, not similarity-based dependencies. The existing graph contract version is
pinned; its vocabulary is reused, not expanded. Client-declared roles are planning
metadata, never proof of immutable capture or semantic correctness. The later
source/fidelity adapter must establish those facts before publication.

## State and recovery

The host stores at most64 jobs and4MiB of history. Headers pin request identity,
inputs, rule/graph versions, authority and output revision before draft content.
Source restrictions are durably inherited via the existing restriction-only
document policy store before accepting a derived draft. Preparation can leave
conservative policy metadata after a later failure; it must not expose a public
partial body. Existing protected-policy setup is required; the endpoint cannot
invent a public classification or relax a policy to unblock itself.

Generation, checking, application intent, applied state and completion are
separate. A successful write is insufficient: the output is reread, the checks
are bound to its inputs/draft and a completion receipt must persist. If a write
succeeds but acknowledgement is lost, restart verifies the recorded intended
revision; it never reapplies over a different current output. Completed output
is still subject to fresh checks and becomes review-required after drift.

Applied-revision evidence is separate from the current status and final completion
receipt. It survives unavailable adapters and review invalidation. A deletion or
rollback after durable application cannot be replayed through either retry or a
new request ID, even if the final completion receipt never persisted.

Existing untracked output, manual changes (including deletion), conflicting
request IDs and corrupt receipts do not become repair authority. Three failed
application attempts stop retries. A single worker serializes processing; change
and reconcile events only invalidate affected work, without model execution or
automatic publication. Unchanged events leave receipts unchanged.

## Evidence, observations and progressive inspection

Draft `evidence` pins required facts and complete source coverage to exact source
revisions and locators. Semantic judgments remain attributed agent reports;
the server separately checks source bytes, locators and literal correspondence.
The v2 checker reports verbatim preservation separately from literal matching.
Conditions, negations, counterexamples and contradictions require exact selected
text preservation; an unchanged number cannot prove a changed condition safe.
Identical prose without numbers can be verified verbatim while its literal
status remains out-of-scope. Paraphrases and translations are not inferred to
match. Code, examples and metadata remain excluded. Literal-only correspondence
for numbers/dates/versions/quotes is not a claim of semantic equivalence.
One refinement may preserve or add obligations, never silently discard or re-anchor
them. Optional `rationale` records actual constraints, rejected alternatives with
reasons, and failure conditions. It is agent analysis, not proof of a user decision
or consent. Do not invent decisions to populate it. The complete report is bounded
to24000 characters and remains in the restricted host history.

Alternatively, submit `observation` without draft or evidence:

- `source_only`: requires `index`, a reason and complete pinned source coverage.
  The concrete checker verifies immutable bytes/local metadata and checkpoints.
  It does not synthesize, embed, call a provider, or claim an embedding rebuild.
- `already_covered`: requires `synthesize`, query, reason, full coverage and paired
  source/member locators. Existing lexical source comparison, lifecycle and ACL
  checks precede exact selected-text preservation checks. This is an agent's coverage
  assessment, not a machine guarantee of semantic equivalence.

Successful no-write verification stores a completion receipt without a publication
intent or output revision. `wroteOutput:false` distinguishes this outcome from
publication. Missing/partial checks cannot complete it; unchanged repetitions do
not rewrite history. Restart and authority/source/output drift are revalidated.

Use `read` with `includeInspection:true` for bounded input actions, attributed
assessments, mandatory facts, checkpoints and paired matches. Follow the returned
`inspectionCursor` and `expectedJobRevision`; nonzero cursors require the exact
job revision. Small budgets return `partial` with a larger-budget continuation,
never silently skip a checkpoint. Execution status and inspection-page coverage
are separate. Draft bodies are never returned. Every dependency is authorized
again, including later inputs after an earlier input changed.

When a host is configured, existing answer packets and the exception board also
include current, owner-only `compilationReview` findings: missing evidence,
incomplete checks, conflicts, changed sources, authority and manual edits. They
carry source revision, job basis, attribution and an exact inspection action.
Hidden or revoked jobs contribute no identifiers or counts. Reading diagnostics
revalidates the original packet too. If both views cannot fit, a partial response
preserves the inspection action instead of silently dropping warnings or evidence.

Programmatic hosts may supply `compilation.adapterFactory` to construct the
concrete adapter using current filesystem, access, source comparison, publication
and authorizer services. It is considered only with explicit host and runtime
configuration and outside read-only mode. An explicitly supplied adapter takes
precedence. This connection is not an execution grant and is not selected by the
CLI or live runtime by default.

Unit tests and deterministic checks do not establish model quality or truth.
Actual-model evaluation, explicit production grants, runtime verification and
host-hook activation remain separate acceptance gates; automatic application
stays disabled until those gates pass.
