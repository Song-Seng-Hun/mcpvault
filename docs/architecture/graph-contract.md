# Shared graph contract, version1

Phase1 extracts the existing vocabulary into
[graph-contract.ts](../../src/graph-contract.ts); it introduces no new authored
relation, validation restriction, endpoint, inference engine or graph database.
Markdown, source revisions and the existing access policy remain authoritative.

The compatibility exports in [organization.ts](../../src/organization.ts) retain
the same fourteen names, order, direction/target descriptions and reciprocal flags.
`getOrganizationRelationContract()` still returns fresh entries with exactly
`field`, `direction`, `target`, `reciprocal`; the version is a separate export.
Reciprocal relations still require the existing reciprocal-link change procedure.

| Consumer | Shared projection | Preserved boundary |
| --- | --- | --- |
| organization | relation names and semantics | public serialization unchanged |
| llm-wiki | claim input/property/relation mapping; target-kind reason | caller normalization and ACL unchanged |
| vault-graph | relation fields; derived claim backlink labels | extraction occurrences and locators unchanged |
| question-graph | narrow question retrieval profile | declaration order, reverse contradiction only, two hops |

Only `answers_questions` requires `question`; `tests` accepts `question`,
`hypothesis`, or `assumption`. Unknown names are not rejected by this small helper;
existing caller validation continues to decide them. Descriptive relation targets
are not additional type restrictions. `same_as` is not OWL equality.

Question retrieval allows virtual `evidence`, `supports`, `contradicts`,
`depends_on`, `derived_from`. Evidence is not a fifteenth authored property.
Counterpoints/prerequisites precede evidence pins and then supporting context;
inverse discovery remains limited to contradiction and claim contradiction.
Existing40 metadata/eight body/80 relation budgets and the81 declaration sentinel
remain unchanged. Shared vocabulary never grants access to hidden targets.

Characterization and projection checks live in
[graph-contract.test.ts](../../src/graph-contract.test.ts), alongside the existing
organization, claim authoring, VaultGraph and question-packet integration tests.
They pin exact public descriptions/error strings and all three claim backlinks;
the question fixture prevents widening retrieval to all fourteen relation types.
Links to tests identify verification targets, not evidence of a passing execution.
Phase1 did not implement the later assertion, validation or UML phases.

## Subsequent occurrence and local-validation contract

The optional [assertion view](../graph-assertions.md) extends existing
`wiki.neighborhood` without changing the default or fixed five MCP tools.
`graph-assertion.ts` is the private occurrence model; only the separate bounded
packet service may release currently visible, revision-checked target identities.
The Graphify adapter consumes the existing host-only P3 result and never becomes
a second AST extractor or public runtime endpoint.

`graph-validation.ts` now owns the exact existing claim ID/reference/anchor
helpers used by lint and preview as well as occurrence inspection. The local
profile catalog documents, rather than widens, existing constraints. Current
source revisions, valid syntax, complete topic coverage, verified evidence and
passing tests remain independent claims. UML/measurement delivery is separate.

## Phase1 execution evidence, 2026-09-12

- The two public characterization tests passed before extraction; four new shared
  contract tests failed while the module was absent, then passed after extraction.
  Targeted coverage:91 cases across six files. One new fixture initially used an
  invalid16,000-character question budget; corrected to the existing12,000 maximum
  without changing production validation. Strict build passed.
- Existing SPEC and QUALITY reviewers independently performed static comparison
  against baseline`16dcb945`; both reported no findings. They did not run tests.
- Frozen source/test/dist basis
  `640e4a8eee04706304fab96a51b648573b80d04e51d65e51e03184c20f9f670d`:
  full456-file regression,6,386 passed,4 existing skips,0 failed. One coordinator
  and one worker,512MiB heap ceilings each; minimum observed host free RAM4.064GiB.
  The existing2.3GiB admission/2GiB stop guard remained unchanged.
- Deployed888 matching dist files to the NAS-backed runtime. The prior P2 release
  and launcher are retained for rollback. Canonical original/world/economy bytes
  and checkpoints were preserved across the switch, with dead writer locks
  recovered only after exact process-identity and fingerprint checks.
- Actual MCP`wiki.property_contract` returned all14 fields, unchanged semantics
  and fingerprint`cd28d1a8c956d8e3ff8641f37182650c996a1983a16fd7342cb4a723f0121858`
  in1,744 characters. Five fixed tools and the intentional empty-MOC topic-packet
  behavior passed. No operational test document was created or published; positive
  MOC coverage remains local-fixture-only. No inference call or new graph server.
- Source and generated dist travel together on the user's existing fork`main`;
  no PR, upstream contribution, release or package publication. Subsequent phases
  must coordinate shared-file and verification ownership with the Arkon work.
