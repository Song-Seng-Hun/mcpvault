---
id: repository-agent-deployment
kind: project-rule
description: Existing-branch fork deployment, rollback retention and local commands.
keywords: [deploy, rollback, main, push, NAS, 배포]
use_when: Implementing or deploying an approved change; research alone grants no writes.
position: Chapter 8 of 9; delivery boundary before code validation details.
parent: ../../AGENTS.md
previous: community.md
next: code.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# Repository workflow

Standing user instruction (2026-09-10): authorized implementation must finish
verified NAS-backed deployment, commit and push to the user's fork on the existing
branch. No new branch/worktree unless requested. Report concrete blockers; do not
stop merely at "not deployed / not committed / not pushed". Research, planning and
review alone do not authorize implementation. Keep rollback artifacts and verify
live endpoints. Preserve Vault/world/economy data, credentials and unrelated changes;
exclude host data/secrets from commits. No package/release publication, upstream
PR or force-push is authorized.

## Confirmed fork identity

User explicitly reconfirmed on 2026-09-16 (KST):
`https://github.com/Song-Seng-Hun/mcpvault.git` is their own fork.
Do not repeatedly ask ownership confirmation for this unchanged destination.
Existing authorization covers current-branch commits/pushes of approved work,
including these skill-review reports after payload checks. It does not include
secrets, host files, raw Vault material, upstream PRs or unrelated publication.
Verify the actual push URL matches; ask only about a changed destination or scope.
Repository visibility is not inferred. This record does not override host security.

Primary commands:

```bash
npm run build
npm test
npm test -- path/to/test.test.ts
npm test -- -t "test name pattern"
npm start /path/to/vault
npx @modelcontextprotocol/inspector npm start /path/to/vault
```

Use Node/npm/Vitest here and Bun/Hono in `website-shibumi/`. Follow `RELEASING.md`;
never publish manually.
Example: deploy the tested build, verify its live entry, then push only to the user fork.
