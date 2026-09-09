# Independent research verification — 2026-09-09

## Implemented scope

Opt-in rounds attach to existing Workshops used by persistent subject groups and
temporary Work teams. Two dynamic endpoints leave the five-tool MCP surface
unchanged. Markdown snapshots, CAS, authenticated participants, explicit disclosure,
peer fingerprint-bound review and unresolved/synthesis closure are implemented.
Neutral invitations carry workshopId/roundId through existing task/chat/comment
paths; there is no automatic worker, round assignment or scheduling system.

## Automated and review evidence

Isolated temporary Vaults use independent fixture accounts and in-memory MCP
clients. They do not create operational NAS accounts, posts or memberships.

- Initial missing endpoint tests failed before implementation.
- Independent static review found and regression tests reproduced: hidden config
  references, revoked actor at the locked write boundary, multi-source guard
  exhaustion, unreadable legal Unicode submissions, forged synthesis state,
  parent-Workshop source snapshot loss, hidden source path/hash errors, and
  insufficient terminal storage reserve. Fixes passed their targeted tests.
- Further review reproduced dot-path private-source acceptance and equivalent
  public path guard duplication. The common ReferenceService now classifies
  normalized paths and rechecks the filesystem-resolved identity. Windows alias
  folding is Windows-only; the POSIX spelling regression also passed.
- Existing Whisper operation was explicitly regression-tested after adjusting
  managed-container normalization (a container is not a generic read grant).
- The latest compatibility set passed 63 tests, including Whisper, continuity,
  subject groups, Obsidian references and research. The subsequent focused set
  passed 31 tests after the POSIX change. These overlapping totals are not additive.
- Static reviewer sign-off: no remaining concrete blocker found in the reviewed
  increment. Static review is not runtime or model-behavior evidence.
- Build and guidance catalog consistency passed; 3,833 definitions, zero pending
  bindings. Full regression and live deployment are recorded below when verified.

The first full-suite attempt was deliberately stopped for the additional path
security fix. It is not counted as a completed test run.

## Limits

An actual two-session Codex model timing pilot was subsequently completed:
[preregistered evidence and results](research/independent-timing-pilot-20260909.md).
On six controlled fictional cases, early and delayed peer-hypothesis exposure
both scored 11/12 finally; this does not establish superiority or equivalence.
The fixture broker, scripted peer hypotheses and existing protocol regression
are distinct from actual authenticated multi-agent MCP collaboration. Gemini,
Claude, web research, token efficiency and real disk/network I/O remain untested.
The ArcticSwarm numbers in the preserved plan are the authors' reported results,
not MCPVault performance.

The server cannot erase prior model context, isolate sessions sharing an account,
control other channels, or protect files from the NAS/host operator. Stored prose
is reference data, not authorization or verified truth. Structural validation is
not a signature against a privileged host. No XP, task approval or completion is
issued by research closure. Ordinary public contributions remain public.

## Final regression and deployment

Final clean run: `npm test -- --maxWorkers=1` passed **319 files / 4,169 tests**,
with 2 skipped (4,171 total), in 666.82 seconds. The preceding complete run had
one failure: a prior NAS handoff addition made AGENTS.md exceed its 9,000-character
bootstrap budget. The same NAS instructions were compacted without changing
authority, its four focused checks passed, and the clean full run above followed.
Skipped tests are not counted as verified. Build and `git diff --check` passed.

The active NAS Vault received 71 new protected guidance defaults; 3,762 existing
documents remained unchanged. Every created document was reread and matched its
write revision and compiled default. No operational research accounts, rounds,
posts, memberships or tasks were created. Host receipts and the previous committed
build rollback archive are retained outside source Git, under `.mcpvault/`.

The existing shared HTTP scheduled service was replaced on 127.0.0.1:8788 with
the same NAS Vault/configuration. Compiled files were written before the replacement
process started. Actual current Codex MCP calls discover `workshop.research` with
its new field projections and authentication lock, and read `wiki.policy` ideation
with both new routes and the independent-first workflow. This required no Codex
restart. Live authenticated writes were not attempted; mutation evidence remains
the isolated protocol tests above, not a claim of actual multi-model cooperation.
