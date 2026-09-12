# Revision-pinned compilation foundation

`wiki.compilation` is a dynamic endpoint, not a sixth MCP tool. Markdown,
Properties, exact revisions and the existing access rules remain authoritative.
This is the first Arkon-inspired delivery bundle: policy admission and durable
processing records. The later fidelity/publication adapter and Codex hook bundles
are not supplied by this foundation. No model, provider or scheduler is started.

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

## Endpoint operations

| Operation | Effect | Required basis |
| --- | --- | --- |
| `diagnose` (default) | Compact availability, no source body or persistent job | none |
| `prepare` | Persist policy/basis header and inherit restrictions | stable request ID, project, input revisions/roles, output revision |
| `read` | Current-authority metadata projection; never draft body | authenticated job owner and request ID |
| `submit` | Store one bounded generated draft in private history | current job revision |
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

This foundation does not assert model quality, semantic understanding or truth.
Fidelity checks, one-refinement preservation, source comparison/publication and
host-hook activation have their own subsequent implementation and acceptance gates.
