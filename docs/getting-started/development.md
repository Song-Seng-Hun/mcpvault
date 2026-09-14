---
id: "readme-development"
kind: "manual"
description: "Run bounded tests and build checks; preserve rollback and tracked output."
keywords: ["development","MCPVault","manual","안내"]
use_when: "Testing, building, staging or deploying an authorized implementation."
position: "Chapter 11 of 11; source README navigation."
parent: "../../README.md"
previous: "architecture.md"
next: "../../README.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Verification and delivery

```sh
npm test -- path/to/test.test.ts
npm run guidance:generate
npm run build
npm test
npm run test:safe -- --run-id my-verification
npm run guidance:check
git diff --check
```

For constrained hosts, `test:safe` runs fresh single-worker batches with memory
guards and revision-pinned checkpoints. Resume with `npm run test:safe --
--resume=my-verification`; use `test:compact` for one file per process. Neither
disables isolation nor promises OOM-free execution. See [safe test runs](../../docs/safe-tests.md)
for limits, incomplete exits, failure records and ownership recovery.

Guidance generation changes code-owned prose defaults, not schema/permission
authority. Commit handwritten source and corresponding tracked `dist` together.
Exclude credentials, host state, caches and `.agents`. Deployment verification
must load the new runtime, preserve rollback artifacts, and use read-only live
checks; mutation tests belong in isolated fixtures. See [AGENTS.md](../../AGENTS.md)
for this fork's deployment/commit/push workflow and
[refinement record](../../docs/research/2026-09-10-complexity-refinement.md) for current
complexity decisions and verification results.

Example: An incomplete safe-test run is not a passing regression receipt.
