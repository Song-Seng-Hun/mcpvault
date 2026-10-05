# Feature-domain review (llm_wiki-002)

Decision input for item ③ of llm_wiki-001: which feature domains could be removed.
Read-only review at `85403dc07`. No source was changed. Numbers come from scripts over `git ls-files`
(regex import graph, file-prefix ownership) plus spot reads.

## How to read this

- **Removal units already exist.** `src/host-features.ts` defines 11 host features (`HOST_FEATURE_IDS_V1`) and maps
  every MCP tool to one of them. The server only enables what the owner-private `--features-config` /
  `MCPVAULT_FEATURE_CONFIG` file selects, and the default is `wiki-core` only. **The live NAS selection is not in the repo.**
  It sits next to the Vault, so which features are actually on is the first user question.
  Separate servers (enterprise, global-sync, public-federation hub, economy host) are their own `bin` entries outside that gate.
- **Size** = production / test lines in files the domain owns (filename prefix).
- **Guidance**: catalog entries whose every source is in the domain. Today each entry costs ~15.6 generated lines
  (83,781 / 5,356). After R1 from refactor-map it would cost ~1.
- **Coupling** = production files outside the domain that import it. The registration points (`createServer`, `endpoint-registry`,
  `index.ts`, `host-features`, `server.ts`) count as cheap edits. Anything else is real entanglement.
- **Completeness signals** are weak across the board. Every domain has tests, zero TODO/FIXME, and commits within 2026-09-01..23.
  So "finished vs half-built" can only be judged on wiring, not on markers. CHANGELOG mentions none of the feature domains.

## Per domain

### roleplay (+ story, computer-worlds), host feature `roleplay`
- What: persistent roleplay worlds/characters/scenes/TRPG turns with evolution; a story-writing workspace (projects, branches,
  artifacts, exports, visual event models); a "computer world" simulation for roleplay. 20 MCP tools.
- Entry: `manage_roleplay_*`, `manage_story_*`, `manage_roleplay_computer`; `--roleplay-config`; `scripts/roleplay-host.mjs`,
  `verify-roleplay-nas.mjs`, `verify-roleplay-live.mjs`, `provision-roleplay.ps1` (NAS verification, last touched 2026-09-09).
- Size: roleplay 2,312 / 1,983, story 3,122 / 2,728, computer-worlds 329 / 246 → **5,763 / 4,957**. Guidance 546 entries.
- Coupling: **high, for a structural reason.** 30 outside production importers. Most of them do not use roleplay itself; they import
  `roleplay-storage-host.ts` (`canonicalRoleplayPath`, `validateRoleplayStorage`) as a generic host-path utility.
  Importers include `account-store`, `host-feature-config`, `skill-release-*`, `owner-activity-*`, `explanation-host`, `economy-*`, `document-index`.
  Core also imports `fiction-domain` (`search.ts`, `semantic-search.ts`) and story/roleplay mutation boundaries (`filesystem.ts`).
- Completeness: wired and gated, with NAS verify scripts. Looks finished and was deployed at least once.
- Quality: a feature module acting as a foundation breaks the "lower layers never import higher layers" rule. `any` density 3.1/1k (roleplay).
- Removal: first extract `roleplay-storage-host` path helpers into a neutral host-storage module (~150 lines moved).
  Then delete the domain plus 3 core guards. Saves **~10.7k lines + 546 guidance entries (~8.5k generated lines today)**.
  Cost: medium-high. **Verdict: needs-user-input** ("do you use roleplay or story writing?"). Story could go separately from roleplay.

### enterprise + public-federation + global-sync (multi-server federation stack)
- What: multi-tenant enterprise registry/server/admin CLI; a public federation hub with a replica puller; a global sync server.
  The only MCP tools are 4 `public_federation_*` (in feature `collaboration`).
- Entry: bins `mcpvault-enterprise`, `mcpvault-enterprise-admin`, `mcpvault-public-hub`, `mcpvault-global-sync`;
  root hosts `enterprise-server.ts`, `enterprise-admin.ts`, `public-federation-server.ts`, `global-sync-server.ts`.
- Size: enterprise 2,664 / 2,494; public-federation 1,949 / 869; global-sync 1,719 / 369 → **6,332 / 3,732** (+4 root hosts).
  Guidance 314 entries.
- Coupling: **highest.** Enterprise is imported by 23 production files, including core auth/storage (`scope-auth`, `scope-access`,
  `filesystem` via `enterprise-storage-context`, `mcp-http`, `llm-wiki`). `public-federation-storage.ts`
  (`readFederationFile`, `writeFederationFileAtomic`) is the de facto atomic-file utility for 21 unrelated hosts.
- Completeness: built and tested. Last enterprise commit 2026-09-20; federation/global-sync stopped 2026-09-13.
  No NAS verify script exists. The site (`shibumi-server.json`) is upstream's website, not these servers.
- Quality: 4 copies of lockfile/`processIsAlive` logic (enterprise-registry, enterprise-server, global-sync, public-federation).
  24 `.catch(() => undefined)` sites, mostly best-effort cleanup. One masks a failed `chmod(secretFile, 0o600)`
  (`enterprise-registry.ts:604`) and leaves the secret file permissive with no signal. 18 `as unknown as` casts.
- Removal: extract federation-storage atomic IO to neutral core first, then untangle enterprise from scope-auth/filesystem.
  Saves **~10k lines + ~4.9k generated**. Cost: **high** (auth and filesystem are full-regression areas).
  **Verdict: needs-user-input** ("do you run more than one server / an enterprise tenant / a public hub?"). If not, this is the largest safe-in-principle cut.

### collaboration (community/social/chat/whisper/reputation/notifications), host feature `collaboration`
- What: blog posts/comments/reactions/guestbook, chat rooms, whispers, watch/save, reputation, community participation records,
  notifications. 42 tools.
- Size: community-social 4,040 / 1,151, notifications 1,374 / 203 → **5,414 / 1,354**. Guidance 371.
- Coupling: medium. 10 outside importers (agent-pulse, codex-hook-adapter, context, economy, enterprise-federation, ideation, roleplay).
  `moderation` (519 lines) is **core**: 76 importers through `moderation-policy`. Keep it.
- Completeness: the most-iterated domain (69 commits). Finished.
- Quality: notifications `any` density 8.7/1k.
- Removal: saves **~6.8k + ~5.8k generated**. Cost: medium. **Verdict: needs-user-input** ("do agents/people actually post, chat or whisper on your vault?").

### ideation-workshop, host feature `ideation-research`
- What: idea board (branch/evaluate) and facilitated workshops with research steps. 19 tools.
- Size: **2,518 / 1,714**. Guidance 266. The research half (`knowledge-*`, `independent-research*`, `research-*`, 1,917 / 2,658)
  is partly core: `knowledge-synthesis-model` is pinned by `check-architecture-contracts.mjs`, and `llm-wiki`/`organization`/`topic-packet` import it.
- Coupling: low for ideation/workshop (5 importers: agent-pulse, independent-research, llm-wiki, work-service).
- Removal: ideation+workshop only saves **~4.2k + ~4.1k generated**. Cost: low-medium. **Verdict: candidate-to-remove if unused.**

### economy, host feature `economy`
- What: wallets, a quest market and quest contracts (XP/reward ledger). 4 tools, plus `economy-host.ts` bin-less host.
- Size: **1,367 / 1,078**. Guidance 173.
- Coupling: low (server.ts, benchmark-service/host-cli, roleplay-quest, work-service, test fixture).
- Quality: clean (0 `any`).
- Removal: saves **~2.4k + ~2.7k generated**. Cost: low, but benchmark depends on it, so remove the two together or stub the benchmark reward.
  **Verdict: candidate-to-remove if unused.**

### benchmarks, host feature `benchmarks`
- 5 tools (list/submit/review/finalize benchmarks). **993 / 879**, guidance 156. Imported only by registration points.
- Removal: saves **~1.9k + ~2.4k generated**. Cost: **low** (cleanest cut found). **Verdict: candidate-to-remove if unused.**

### explanation-translation, host feature `explanation-translation`
- 6 tools: claim/submit/review source-pinned plain-language explanations. **623 / 496**, guidance 64. Registration-only coupling.
- Removal: saves **~1.1k + ~1k generated**. Cost: **low**. **Verdict: candidate-to-remove if unused.**

### work-management (work, agent-tasks), host feature `work-management`
- 14 tools: work groups/projects/boards/claims/handoffs. **2,601 / 3,774** (+ agent-tasks).
- Coupling: **very high.** 48 importers. `work-model` is a shared vocabulary for evolution, story, explanation, compilation and llm-wiki.
- **Verdict: keep.** Removal is a redesign, not a cut.

### skill-evolution (skill-*), host feature `skill-evolution`
- Reviewed-skill release/serving from NAS plus quarantined skill evolution. **3,337 / 3,640**, 19 importers (account-store, filesystem boundary,
  retrieval, mcp-http, owner-activity).
- The latest commits (232e07b9 "serve reviewed skills from NAS", 6c923b97) show this is **live**.
- Contains 2 test-only modules (`skill-release-admission`, `skill-review-evidence`, R5 in refactor-map).
- **Verdict: keep.** Only the test-only modules are candidates.

### codex-hook
- Codex hook adapter/checkpoint (495 / 383). Not mapped in host-features; wired only via `createServer`. `codex-hook-checkpoint` is test-only.
- **Verdict: needs-user-input** ("do you still run Codex with MCPVault hooks?"). Cheap either way (~0.9k).

### Core, not removal candidates
`wiki-core` (llm-wiki, organization, compilation, evolution/, curation/, fidelity, continuity, maintenance, notices), `document-search`,
`personal-memory` (layered-memory/memory: 13 core importers, `any` density 22.6/1k is the worst production hot spot), `semantic`,
`owner-activity` (auth), `moderation`. Quality hot spots for later refactor: `any` usage in llm-wiki (110), createServer (30),
layered-memory (30), evolution (24, plus 9 empty catches).

## Ranked table

Savings = production + test lines, plus today's generated guidance lines (entries × 15.6). Cost reflects non-registration coupling.

| Rank | Unit | Prod / test | Guidance (gen. lines) | Total lines | Removal cost | Verdict |
|---:|---|---:|---:|---:|---|---|
| 1 | Benchmarks | 993 / 879 | 156 (~2.4k) | ~4.3k | Low | Candidate if unused |
| 2 | Explanation-translation | 623 / 496 | 64 (~1.0k) | ~2.1k | Low | Candidate if unused |
| 3 | Economy (with benchmarks) | 1,367 / 1,078 | 173 (~2.7k) | ~5.1k | Low | Candidate if unused |
| 4 | Ideation + workshop | 2,518 / 1,714 | 266 (~4.1k) | ~8.3k | Low–Med | Candidate if unused |
| 5 | Collaboration (social/chat/notifications) | 5,414 / 1,354 | 371 (~5.8k) | ~12.6k | Medium | Needs user input |
| 6 | Roleplay + story + computer-worlds | 5,763 / 4,957 | 546 (~8.5k) | ~19.2k | Med–High (extract host-storage first) | Needs user input |
| 7 | Enterprise + federation + global-sync | 6,332 / 3,732 | 314 (~4.9k) | ~15k | **High** (auth/filesystem) | Needs user input |
| 8 | Codex-hook | 495 / 383 | 5 | ~0.9k | Low | Needs user input |
| — | Work-management, skill-evolution, core | — | — | — | Very high / live | Keep |

If **every** candidate went (1–8): about **23.5k production lines (≈25% of 94.7k)**, ~14.6k test lines and ~29.6k generated lines
(1,895 entries), about 68k in total.
That is the only route to a large reduction. The refactor-only route (refactor-map) gives ≈2–3%.

**Prerequisite for 6 and 7:** move `roleplay-storage-host` path helpers and `public-federation-storage` atomic IO into a neutral
host-storage module. This is worth doing even if nothing is removed, because it fixes a layering violation.

## Questions only the user can answer

1. What does the NAS `--features-config` select today? (Or: which of these 11 features do you actually use?)
2. Do you use roleplay, story writing or the computer-world simulation? Could story stay while roleplay goes?
3. Do you run, or plan to run, more than one MCPVault server (enterprise tenants, public hub, global sync)?
4. Do agents or people post, chat, whisper or react on the vault (collaboration)?
5. Are benchmarks, the economy (wallets/quests), explanations and idea/workshop boards in use, or were they experiments?
6. Is Codex still connected with MCPVault hooks?
7. Is removal reversible enough for you if it is done as one tagged commit per feature (git revert restores it), or do you want the code archived elsewhere first?
