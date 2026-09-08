# Vault guidance verification — 2026-09-09

## Automated checks

- `npm run guidance:generate` and `npm run guidance:check`: 3,708 definitions,
  4,223 occurrences, no remaining source instrumentation drift. Bindings:
  3,247 call, 460 projection, 1 connection, 0 pending within the scanner's scope.
- `npm run build`: passed.
- `npm test -- --maxWorkers=1`: **314 files passed; 4,107 tests passed,
  2 skipped**, 689.31 seconds. The skipped tests are not represented as passing.
- `git diff --check`: passed before deployment; repeated before publication.
- An earlier full run caught a packaged-skill size regression. The added entry
  was shortened, not the 9,000-character limit weakened. The final full run
  includes the instruction-budget checks.

Coverage includes request-local isolation, exact error identity, missing/hidden
or denied templates, broken host settings, malformed placeholders, stale source
fallback, CAS conflicts, delegated edit/revocation, source re-review with unchanged
wording, bounded source continuations, protected ancestor moves, and exclusion
from ordinary knowledge inventory. AST tests preserve structural schema values,
regular expressions and nested template syntax without evaluating source code.

Focused security review findings about runtime visibility, broken settings,
error response limits, and source re-review were fixed and regression-tested.
This is not a claim that all possible security issues have been eliminated.

## Actual host and Codex MCP checks

- Target: `E:\llm_wiki\llm_wiki`. Original notice configuration, launcher,
  welcome/schema notes and the previous committed server build were backed up
  beneath the host-local `.mcpvault/guidance-deployment-20260909/` directory.
- Preview reported **3,708 creates and no collisions**. Explicit fingerprint
  apply completed; a fresh preview reported **3,708 unchanged**.
- Host configuration enables `_wiki/Interface` with no delegated editors.
  Ordinary accounts can read and propose feedback, not revise official prose.
- The existing shared task was restarted. One matching server process owned
  `127.0.0.1:8788`; no new client registration or additional server was needed.
- Actual Codex `search_capabilities` discovered `guidance.catalog`.
  `guidance.catalog`, `notice.read`, and compiled `sourceId` reads succeeded.
- A single newly created template (`guid-d0f5144b3c280de2`) was temporarily
  changed using a host revision-checked write. The next real MCP search for
  `notes.read` returned the Korean path description without a server restart.
- The template was restored; both its exact original file revision and the
  original MCP description returned. No test account, post or comment was made.
- `wiki.search` for that known template ID with frontmatter search returned no
  knowledge results. Explicit notice access remained available.
- `wiki.policy` topic `notices` returned the new catalog, source re-review,
  feedback and authority instructions within the requested 4,000-character limit.
- Original welcome/schema hashes remained respectively
  `84d412ca73f60858dcee1a93673de50a346f5a0ec295a80548352ca6b6a60dd6`
  and `64bc86c8564479ec7eb9d5502f7472004158184a687c5a78102577595fc01568`.

## Deliberate limits

- This stores reusable prose/templates, not private calls, arguments, secrets,
  complete responses or user-authored messages.
- The AST inventory is explicit and bounded: it does not certify that every
  concatenated string, custom error type, CLI/debug line or generated document
  body is migrated. Bootstrap validation and executable/machine contracts stay
  code-owned. See `docs/vault-guidance.md` for the coverage boundary.
- Fixed tool/initialize descriptions can remain cached by a client. The live
  test verified dynamic endpoint descriptions, not forced cache invalidation.
- Obsidian UI rendering was not tested using computer use. Files and actual MCP
  behavior were verified; no claim of UI interaction is made.
- Synchronization is explicit and per-file revision-safe, not a global atomic
  transaction or background autonomous adoption of community suggestions.
- Runtime settings, Vault documents, backups and local compiler-artifact
  quarantine are excluded from the source commit. They remain host-local.
