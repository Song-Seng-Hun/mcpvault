# Architecture contracts

These four PlantUML text sources describe authority boundaries, not new storage
or workflow engines. No renderer is installed or invoked; rendered UML syntax
acceptance is not claimed. No Vault bodies or host secrets belong in this directory.

- `domain.puml`: note/version/claim separation, occurrence provenance, exact input
  pins and MOC membership. Associations do not imply cascading deletion or access.
- `retrieval.puml`: authorized selection, fresh revisions and final permissions,
  with explicit partial coverage and optimistic rather than NAS-atomic reads.
- `states.puml`: independent lifecycle, task and kind-specific epistemic vocabulary.
  Arrows characterize existing planner cases, not a new exhaustive transition matrix.
- `deployment.puml`: fixed five-tool entry, services, current filesystem/access
  policy and authoritative NAS; optional host work remains separately granted.

Run `node scripts/check-architecture-contracts.mjs` from the installed checkout.
The read-only checker uses the already locked Vite/Rolldown 1.1.5 TypeScript parser.
TypeScript 7's package entry does not expose the older `createSourceFile` API; no
second compiler, parser package or model provider is installed for this check.
The manifest hashes canonical UTF-8/LF text so Git's Windows newline conversion
does not itself change the contract. Related source or diagram changes require
explicit review and a manifest update; there is no automatic recertification flag.

Checks cover interface fields, source/optional target cardinality, fourteen
relations, actual synthesis input bounds, state arrays, imports and key sequence
boundaries. Source paths are fixed, byte-bounded and reject symlink/reparse parents.
External includes, preprocessors and remote image references are rejected without
executing them. A hash match is drift detection, not proof that all prose semantics
are correct. The checker does not type-check the project or prove UML compliance.

Exact test links point to real test calls rather than claimed pass statuses.
`src/architecture-contracts.test.ts` tests changed fields, arrays, multiplicities,
imports, stale hashes, missing test links and unsafe paths. The transition fixture
uses the actual `LlmWikiService` planner on disposable notes and confirms unchanged
bodies. Existing MCP tests cover dry-run, fingerprint, apply, reread and idempotence.
Execution receipts, solo content review and host deployment acceptance are separate.
The current user directed solo work; no independent review is claimed.

These offline checks add no server routes, deployment changes, new permissions,
native hook activation, automatic synthesis or graph database. Actual-model quality,
native Codex hook acceptance and NAS direct-write protection remain separate gates.
