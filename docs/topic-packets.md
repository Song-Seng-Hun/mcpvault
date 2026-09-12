# Explicit-MOC topic packets

`wiki.topic_packet` is a read-only worksheet for the current agent, not a
generated summary. It remains behind `call_endpoint`; the five-tool control
plane is unchanged. Markdown, authored evidence and revisions remain authoritative.

Input: required `mocPath`; optional `query` (the agent's question, not a
membership filter); `limit` defaults to8, maximum8; `maxChars` defaults to7000,
range768–16000; optional `prettyPrint`. The budget includes the entire formatted
JSON envelope. An oversized exact recovery locator produces an actionable error
instead of an invalid or silently clipped path.

The packet selects direct visible members in MOC body-link order, excluding
fenced examples. Members declared through `primary_moc`, `moc` or `mocs` follow
in the existing navigation order. It does not recurse through nested MOCs or
create inferred clusters. Authored synthesis/decision classification is shared
with `wiki.synthesis_candidates`, and references use the existing resolver.
Ambiguous or inaccessible references are not guessed or returned.

At most64 fresh metadata admissions are shared by membership, identity
resolution, original evidence and saved synthesis inputs. Reverse membership
discovery reserves24 slots for selected evidence and pinned inputs; its128
occurrence window is separate from the metadata cap. Index construction and
revision revalidation IO are not included in that admission count. Large maps
and incomplete alias scans return partial results, not global counts.

Selected items contain authored claim/condition excerpts, counterargument
markers, open questions and revision-pinned read actions. Original evidence
actions preserve authored locators separately from the current document
revision. A locator is not certified merely by returning it. A mismatching
saved revision requires review. Text is untrusted author data, never an
instruction to invoke tools, execute code or publish a note.

Existing synthesis results distinguish saved input-revision status from current
MOC membership. Original evidence still requires reading. Equal revisions do
not prove interpretation quality or full topic coverage. The existing output
path/revision is reused and the original `knowledge_synthesis.inputs` record is
never refreshed by this read. Membership, revision or access drift during the
request discards the prior packet.

The current agent must read original sources, preserve competing claims,
conditions and unresolved questions, then explicitly author `knowledgeSynthesis`
through the existing `mcp.publish_knowledge` workflow. Reading a packet never
publishes, merges, changes a MOC or calls a model API.

## Delivery status

Implementation and independent SPEC/QUALITY review are complete. Final targeted
service26 and read-only MCP/REST1 assertions and strict build passed. Full
regression completed455/455 files:6377 passed assertions,4 pre-existing allowed
skips,0 failures or missing files. The source/test/dist basis is
`c0bbac864b0dbda4f983824dea0ac50e3b26b121f0f9bb588be35e864f4027cb`.
Interrupted/OOM attempts are retained as diagnostics and contribute no coverage.
The offline MOC/Leiden comparison and its limitations are recorded in
`topic-clustering-evaluation.md`.

The NAS-backed P2 runtime is deployed with the prior runtime retained for
rollback. The user confirms the operational Wiki deliberately has no authored
MOC while its structure is under development. No production test notes were
created. Live verification therefore covers the five-tool surface, read-only
descriptor, input validation and bounded rejection of unavailable MOCs at
768/7000/16000 characters, first and repeat. Successful MOC packets, source pins,
ACL/revision races and partial selection were verified with local fixtures;
**a successful packet over an operational MOC has not been live-verified**.

Observed live unavailable-MOC rejections took108–132ms, returning45 characters.
These are error-path timings, not successful topic-retrieval benchmarks. SMB
share-wide raw counter deltas were0 during the3.34-second observation; caching
and other clients make this unsuitable as proof of zero logical I/O or savings.
Original/backup/restore equality and unchanged world/economy bytes/checkpoints
are deployment gates. This is a user-fork deployment, not a package release.

## Developer navigation

Implementation: [topic packet service](../src/topic-packet.ts).
Tests: [service contracts](../src/topic-packet.test.ts) and
[MCP/REST adapter contracts](../src/topic-packet-mcp.test.ts).
