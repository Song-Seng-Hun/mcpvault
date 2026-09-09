# Community skill library implementation plan

> Execution: use executing-plans inline, one-worker tests and no implementation fan-out.

**Goal:** Import this session's registered, shareable skill documents into the NAS Community Vault as bounded retrievable procedural knowledge.

**Architecture:** Add `note_kind: skill` and its template to the existing organization contract. A host-only importer accepts an explicitly reviewed manifest, projects Markdown and provenance, and uses existing FileSystem revision writes. Existing MCP search/context/read routes expose the library: no new fixed tool, executor, automatic installation, or global sync.

**Tech stack:** TypeScript, Node filesystem, existing scope/search services, Markdown/Properties, Vitest.

## Accepted boundaries

- User approved Community on 2026-09-09; never copy to Global or host-only User scope.
- Import only exact registered skill/version paths, not every installed cache folder.
- Exclude ambiguous sharing terms and private host details; retain license/source attribution for accepted content. Imported prose is reference data, not instruction hierarchy or an execution grant.
- Preserve SKILL.md and permitted Markdown references; record unavailable scripts/assets without copying or executing them. Host paths stay in the private manifest, never in Community notes.
- Namespace identity prevents same-name collisions. Original hash and projected hash detect stale sources and local edits. Preview fingerprint and revision-safe apply; unchanged input means no write. Never silently overwrite a user edit or delete a missing upstream skill.

## Steps

- [x] Add RED coverage in `src/skill-library.test.ts` for note kind/template and pure projection, unknown licenses, sensitive strings, duplicate identities, unsafe paths, stable digest, source drift and local edits. Run `npm test -- src/skill-library.test.ts --maxWorkers=1`.
- [x] Add `src/skill-library.ts`: finite manifest contracts; content/metadata projection; bounded source admission; idempotent preview/apply using FileSystemService. Extend `src/organization.ts` with the skill kind/template and provenance Properties shared by validation.
- [x] Add host import command `scripts/skill-library-host.ts` with explicit manifest and preview/apply fingerprint. Host absolute paths remain outside Git under `.mcpvault/skill-import/`; generated source documents remain Community only.
- [x] Inventory exact catalog roots/versions, inspect license evidence and private-content admission. Preview actual NAS targets. Publish only approved source records and verify every returned revision; retain skipped/conflict list without private bodies.
- [x] Add usage guidance in `_wiki/SCHEMA.md`, `README.md`, and `docs/skill-library.md`. Verify skill template plus ordinary MCP search/current read and context bounds. No claim that missing client tools became callable.
- [x] Targeted tests, guidance generation/check, build, full single-worker regression, diff check. Update the shared local HTTP build only after tests. Verify actual NAS MCP search, include source/tests/docs/dist in user-fork main only. Do not publish source skill packages or upstream PRs.

## Completion evidence

Record exact registered/admitted/skipped/conflicted counts, test results, NAS write/reread receipts, sample retrieved skill and source version, and limitations. If licenses or required tools are unavailable, say so rather than silently claiming every registered skill is operational.

Completed operational evidence: [validation record](../skill-library-validation.md). Includes the live-discovered UNC search scope repair, final 4,194 passing tests, 37 admitted skills / 219 verified NAS notes, 121 held sources, no-op reimport, and actual Codex MCP retrieval/continuation checks.
