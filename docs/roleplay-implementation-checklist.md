# Shared-world roleplay implementation

Approved scope: one opt-in Community world, shared across existing rooms; five fixed MCP tools; all dialogue/action/narration <=280 Unicode characters. Markdown turn records are authoritative. No production economy activation or automatic conversion of existing rooms.

## Delivery gates

- [x] Pure world, character, scene, rule and control-generation contracts.
- [x] Durable canonical turn storage, idempotency, crash recovery and tamper detection.
- [x] Atomic shared state, pending GM adjudication and compensating corrections.
- [x] Eight dynamic endpoints, existing chat projection and managed-write boundary.
- [x] Bounded character context, lore and epistemic knowledge separation.
- [x] Fiction excluded from real knowledge/memory before ranking.
- [x] Existing funded quest review/evidence integration; live economy OFF.
- [x] Host opt-in configuration, schema, policy and client guide.
- [x] Targeted/full single-worker regression, build and diff checks.
- [x] Two sequential isolated real-model evaluations performed; fixtures and workers cleaned.
- [ ] Model behavioral success after improved action hints (initial second-session goal failed; automated reproduction now passes).
- [x] Live MCP/deployment verification with world and economy OFF.
- [x] Verified source/tests/docs/dist committed and pushed to user fork main only (`6677d67f`).

No box implies completion until verified. Protocol tests and model behavior evaluations are reported separately.

## Evidence

- Nine targeted roleplay/chat/index test files: 56 passing after the final integration fixes.
- `npm run build` and `git -c core.safecrlf=false diff --check`: successful after those changes.
- `roleplay-evaluation-20260908.md` records the actual two-session result and its transport limitation; do not describe the incomplete model goal as passed.
- Protected canonical Markdown plus an outside-Vault host checkpoint, not a client-side installer or per-agent game index. Production activation requires explicit host provisioning; deployment does not convert existing rooms.
- Final `npm test -- --maxWorkers=1`: 308 files passed, 4,070 tests passed and 2 existing skips (4,072 total), 676.36 seconds. Build and final diff check passed.
- Existing `MCPVault-SharedHTTP-8788` task restarted without changing its launcher/config. One shared process (PID 17616 at verification), no roleplay/economy flags. The connected MCP exposed the new world schema, returned `enabled: false`, served roleplay policy version 36 and read the existing welcome note with an exact revision and 1,200-character bounded response. No plugin re-registration or production account/world creation was performed.
