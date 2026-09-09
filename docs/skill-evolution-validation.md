# Skill evolution verification — 2026-09-09

Branch: `codex/skill-evolution`, based on
`25c4db8164175dd5400d21ace06b00cfff1f662b` in the user fork.

## Verified scope

- Synthetic experience → candidate → fixed comparison → automatic promotion →
  current-version search/context → approved rollback, without rewriting imports.
- Authentication/capability/read-only checks, forged results/principals, profile
  changes, private aliases/embeds, source/evidence drift and rejected candidates.
- Concurrent skill transactions, historical idempotent responses, signed old-file
  replay rejection, interrupted writes, post-write drift, and generic mutation
  rejection for service-owned journals.
- Real killed child-process lock persistence and explicit host-only recovery.
  Windows junction-parent rejection executed; the file-symlink recovery case uses
  the existing permission-skip convention when Windows denies creating a symlink.
- Six dynamic endpoints over the existing five-tool MCP surface, shared REST
  dispatch, bounded responses, current-version projection respecting filters,
  exclusion of audit/candidate records, and one optional relevant pulse action.

## Commands and evidence

The focused eight-file run completed with **88 passing tests**:

```powershell
npm test -- src/skill-evaluation.test.ts src/skill-evolution.test.ts src/skill-evolution-lock.test.ts src/skill-evolution-recovery.test.ts src/skill-evolution-mcp.test.ts src/skill-evolution-pulse.test.ts src/skill-library.test.ts src/skill-library-mcp.test.ts --maxWorkers=1
```

Two subsequent focused regression checks passed: hidden candidates do not affect
public cursor positions, and invalid output budgets are rejected before writes.
The latter was first reproduced as an unexpected persisted experience/receipt,
then verified with zero writes after the fix.

`npm run build` passed after the last code change. Guidance generation reported
3,989 entries, 4,536 occurrences and zero pending bindings. `git diff --check`
and the staged equivalent passed.

Final full-suite command:

```powershell
npm test -- --testTimeout=30000
```

Result: **327 test files passed; 4,262 tests passed, 2 skipped** (4,264 total),
exit code 0, 255.80 seconds. This used the repository's default bounded worker
parallelism. No test assertions were removed or weakened.

The earlier single-worker run exposed three policy regressions: the expected
policy version needed updating, and long evolution guidance displaced retrieval
safety rules at bounded budgets. The detailed guidance now lives in the knowledge
topic, with a short retrieval continuation; all 22 policy tests passed afterward.
That run also exceeded Vitest's default 5-second limit while initializing native
ONNX (12.427 seconds). The unchanged semantic-profile file passed all four tests
on isolated retry; the final full run used a 30-second test timeout for native
cold-start tolerance. Final guidance consistency and whitespace checks passed.

## Deployment boundary

No live NAS Vault was changed, no runtime restarted, and no production key or
real skill evaluation profile provisioned. Activation remains an explicit host
SDK configuration step. Synthetic tests do not establish semantic safety for
arbitrary real skills or atomic behavior of the deployed SMB server. See the
[operational contract](skill-evolution.md) for host configuration, recovery,
cooperative-lock and whole-Vault-restore limitations.
