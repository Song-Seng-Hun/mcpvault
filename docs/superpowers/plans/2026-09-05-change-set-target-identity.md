# Change-set target identity

Inline TDD and verification; no new agents. Fork-main commit/push authorized.

## Design

Detect equivalent lexical targets before planning a multi-note edit. PathFilter
and existing scope/legacy restrictions remain authoritative. Compare checked
absolute resolved paths, case-folded consistently with existing duplicate policy;
do not expose the absolute key in error messages. An alias duplicate must fail
in dry-run and apply before any write or index notification. Require callers to
combine all intended hunks/Properties into one entry rather than choosing a last
writer. This preserves the advertised preview/confirmation transaction.

Related-note guards also compare resolved lexical identity against the target
and against other guards. A target cannot be its own independent guard via './'.
Keep actual path spellings and fingerprint semantics unchanged. No claim of
hard-link, in-vault symlink or Unicode identity completeness; these need separate
filesystem identity policy. Do not use the lock-only key as an access grant.

## Tasks

- [x] Add real-file failures for ./, dot-segment and absolute duplicate change
  paths; dry-run and apply must leave originals/events untouched. Add target-as-
  guard and duplicate-guard alias rejections. Preserve valid multi-note workflows.
- [x] Normalize checked target identities at the existing duplicate-validation
  boundary. Reuse the same rule for guards, with no body/path rewriting.
- [x] Adjust prior permissive alias-guard regression to the stricter contract;
  run targeted/full tests, build, compiled MCP smoke and diff check. Document
  caller recovery, commit source/tests/docs/dist and push only user fork main.

## Verification

- Baseline: five expected failures, one valid distinct-note workflow passing.
  Equivalent target spellings produced divergent successful previews, and alias
  guards bypassed the existing self/duplicate prohibition.
- Focused identity/lock/filesystem suites: 191 passed, 1 skipped. Full suite:
  1119 passed, 1 skipped across 75 files (48.50 s). Build/diff check passed.
- Compiled MCP with an ephemeral authenticated account over a real temp vault:
  duplicate alias rejected with no write/host-path disclosure, followed by a
  consolidated body-plus-Properties preview/fingerprint/apply and raw re-read.
  Temp account/vault removed after resolved absolute path validation. No live
  user Vault or server restart.
- Inline review retained path filters, traversal/legacy checks, existing case-
  folded duplicate policy and exact-request fingerprint behavior. Validation
  occurs before acquiring transaction locks/planning/writing. Do not reinterpret
  this as filesystem inode identity, permission authority or global atomicity.
