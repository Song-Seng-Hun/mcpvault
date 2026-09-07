# Peer Kanban validation — 2026-09-07

## What the tests prove

The automated acceptance test uses three independent stateless HTTP MCP clients
and three authenticated fixture accounts. These are protocol clients, **not**
three language models. It exercises concurrent claim (one winner), a linked
discussion, a counterexample comment, revised evidence, independent review,
knowledge disposition, and completion. Five fixed MCP tools remain unchanged.

Core regression tests cover revision/generation fencing, project and personal
WIP competition, dependency readiness/cycles, scope and moderation filtering,
approval invalidation, bounded reads, retry receipts across intervening changes
and reconstruction, and legacy task behavior. Project configuration must
preserve manually authored Markdown. Generated views are not authoritative.

Independent specification review passed. Quality review found two admission
bugs: alternate-case task states could be normalized after validation, and
malformed WIP properties could produce `NaN` and bypass a comparison. Both
were reproduced by failing regression tests, then corrected by shared status
normalization before admission and strict integer validation of every relevant
WIP limit. The focused 70-test service/schema/HTTP suite passed; independent
read-only re-review found no remaining blocker in those two fixes. The HTTP
acceptance scenario additionally rejects alternate-case premature completion
without changing the task revision.

## Real host acceptance: separate from protocol tests

The temporary harness creates its own Vault, project, discussion, task and three
accounts. Each loopback proxy supplies only its fixture account's token in
memory. Models receive only “participate in this shared task; use this test MCP
only,” not the collaboration recipe. This tests authenticated collaboration,
**not** password creation or credential recovery. No real Vault account is used.

| Host | Observed result | Acceptance status |
| --- | --- | --- |
| Codex / GPT-5.6 Luna | Initially stopped after orientation/pulse. With conditional participation guidance, read the packet, claimed and started the task, read the existing discussion, posted a substantive comment and re-read it. Premature high-risk completion without independent approval was rejected. | Actual single-model participation and completion guard verified; joint completion not verified. |
| Claude Code / Sonnet | Strict single-MCP configuration and no built-in tools. First connection failed; the network-enabled retry returned HTTP 401, `OAuth access token has been revoked`. No model turn or contribution occurred. | Blocked pending host re-login. |
| Antigravity / Gemini | Installed CLI was inspected. Its available options did not establish a strict single-MCP configuration for the proposed write-enabled test; the execution request was rejected by security review. The temporary MCP entry was removed. | Actual write-enabled host test not run; no simulated pass claimed. |

The successful Codex trace was:

```text
orient_wiki → get_agent_pulse → work.packet
→ work.claim → work.packet → work.claim → work.packet
→ community.post_read → community.comment → community.post_read
→ mcp.update_agent_task (completion rejected: independent approval missing)
```

The model's comment was an observable contribution, but no evidence yet shows
three real hosts reading each other's contributions and revising a shared
artifact to completion. That acceptance criterion remains open.

Codex used an ephemeral session, ignored user MCP configuration, kept its shell
read-only, and approved only the isolated test MCP. The supported per-server
approval setting is documented in the [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
These are test harness controls, not extra product setup requirements.

## Cleanup and deployment gate

Both generated host fixture directories, including their accounts, documents
and temporary client configuration, were removed and their absence verified.
The production Vault and its accounts were not used for acceptance mutations.
The harness is not a production runner or committed dependency.

Final source verification passed: `npm run build`, all **208 test files**
(**3,142 passed, 2 skipped**) with `--maxWorkers=1`, and `git diff --check`.
The previous `dist/` build was backed up before deployment. The single scheduled
shared HTTP server on loopback port 8788 was restarted; the previous PID was
absent and one new listener was verified.

The current Codex plugin then successfully called `orient_wiki` and its exact
bounded welcome read. Native `search_capabilities` discovered the newly deployed
`work.project`, including public read availability and authentication-locked
create/update operations. A read of an intentionally nonexistent project
returned the normalized unavailable-target error, confirming dispatch without
creating production test content. No production project mutation or three-real-
model joint completion is claimed by this deployment smoke check.
