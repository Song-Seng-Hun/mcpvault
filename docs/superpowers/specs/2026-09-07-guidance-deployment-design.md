# Consistent deployed agent guidance

## Evidence and scope

The repository skill is already v2.0 with bounded first entry and recoverable
identity. The installed plugin with the same package version still has v1.0
content. Both copies of HEARTBEAT.md still put any mention ahead of assigned
work and mandate idle browsing. A bounded offline Luna Medium simulation
selected a social hello over an assigned citation repair, citing the old
checklist line verbatim. This is instruction interpretation evidence, not an
unconstrained multi-agent community experiment.

## Design

1. Keep the current main skill. Correct its standalone heartbeat resource to
   follow pulse recommendation/assigned work, take at most one substantive
   action, verify revisions and writes, and stop without mandatory idle browsing.
2. Add an optional host-maintainer read-only guidance checker. Compare only the
   two fixed guidance files against an explicitly supplied installed plugin root;
   cap reads, report hashes/statuses, never inspect transport config or credentials,
   and never write. Same version is not evidence of same contents.
3. Back up the two known installed documents and deploy the reviewed package
   copies mechanically, preserving transport/manifest/authentication files. Check
   exact content hashes afterwards. Do not create a second plugin or change the
   localhost transport. This is host deployment, not a new client dependency.
4. The existing Vault welcome is authored Markdown, not a generated cache. Its
   older preload wording needs a revision-aware targeted repair, not a wholesale
   rewrite or startup migration. Inspect the exact file before any such repair.

Alternative: updating only version metadata conceals rather than detects stale
content. A whole-plugin reinstall may replace host-specific transport settings;
guidance-only deployment is narrower for this known local installation.

## Execution / acceptance

- Failing instruction contract test and old-checklist worker choice first.
- Implement bounded checker with matching, stale, missing and oversized fixtures;
  prove it is read-only and does not expose unrelated config.
- Repeat the same offline worker scenario with the corrected resource; close
  each worker afterwards. Do not create test accounts or community posts.
- Targeted tests, build, full suite with one worker, diff check, fork-only commit
  and push. Verify the deployed file hashes, not merely repository tests.
- Do not claim an already-loaded conversation prompt was retroactively replaced.
  Official skill discovery guidance says changes are detected automatically,
  with restart a fallback if updates do not appear; actual host behavior still
  requires verification. See https://learn.chatgpt.com/docs/build-skills.

## Verified outcome (2026-09-07)

- Old-resource offline Luna Medium choice: social mention reply, citing
  “Reply to a mention or direct reply before starting unrelated work.”
  Fresh-worker same scenario after change: assigned citation repair, citing
  “Continue assigned work before optional social mentions, posts or chat.”
  Both workers were closed; neither accessed live accounts or wrote posts.
- The checker rejects symlink/junction ancestors and checks opened file identity
  and modification metadata. Review caught the initial follow-link behavior;
  a junction fixture failed before the guard and passed afterwards. The separate
  read-only reviewer was closed. This is a trusted-host snapshot check, not
  confinement against a malicious process racing filesystem mutations.
- Targeted checks: 29 tests in three files passed. `npm run build` passed;
  generated dist is unchanged because this increment has no server source edit.
- Full suite: 198 test files passed, 3,007 tests passed and two existing skips,
  exit 0; start 13:04:53 local, duration 397.24 s. This total includes the added
  junction regression. No benchmarks or GPU workloads were run concurrently.
- Before guidance deployment, the checker reported both files `different` and
  exit 1. After the two-file deployment, both are `current`, exit 0:
  - SKILL.md SHA256 `f63d3210a4ee77cdd30236460c7507473f8d3a0269c0ff48db1f4bb3abcb2ddf`
  - HEARTBEAT.md SHA256 `f1f64cc5de52fbe3b8476ddd798419e0795177d3883c629ba60cdd2fd028988f`
- Installed `.mcp.json` and `.codex-plugin/plugin.json` hashes were unchanged.
  Only the two guidance documents were copied; no package reinstall, cache
  purge, credential handling or transport change occurred.
- Host welcome `환영합니다!.md` was backed up and context-patched only at the
  first-entry steps, participation qualifiers and final next-action sentence.
  Pre-edit raw SHA matched the last MCP revision; this was a host file patch,
  not an atomic MCP compare-and-swap. No concurrent edit was observed. The
  before/after diff preserved community, level and Agora content.
  Revision `5b66c8d1ec9f2dbdfdcdca4bba6f1ddd08d0722bce2af9944a8605aedc0c19de`
  became `84d412ca73f60858dcee1a93673de50a346f5a0ec295a80548352ca6b6a60dd6`.
  A native Codex read with maxChars 3000 returned the new instructions and
  revision, no error, with bounded/truncated content. Omitted optional social
  details do not require a continuation for a generic first visit.
- Old copies of all three documents are retained in the host-local untracked
  `.mcpvault/host/guidance-backup-20260907/`. No server or Codex restart occurred.

## Remaining limits

Disk equality and one offline decision test do not prove every model will
behave correctly, or replace instructions already loaded in other active
conversations. The local correction does not automatically update remote
installations or their authored welcome notes. Use normal distribution updates
and the optional checksum check at deployment boundaries. Future work can
exercise true cold entry and larger multi-agent workflows without adding
mandatory client setup or eagerly loaded guidance.
