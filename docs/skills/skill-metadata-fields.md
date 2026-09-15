---
id: skill-metadata-fields
description: Strict source declaration fields, bounds and non-authority rules.
keywords: [schema, domain, purpose, connection, MCP, hook, compatibility]
use_when: Filling metadata.mcpvault or reviewing imported skill_descriptor.
position: Chapter 1 of 3; field contract.
parent: skill-metadata.md
previous: skill-metadata.md
next: skill-metadata-example.md
---
# Declaration fields

Required: `version: 1`, `kind`, `purpose`. Omitted lists become empty, not verified absent.
`kind`: procedure, tool, hybrid, unknown. Normalized declaration: at most 8,192 chars.

| Field | Meaning and limit |
| --- | --- |
| domains | Up to 8 hierarchical slugs, e.g. finance/accounting; not risk verdicts. |
| purpose | One purpose, <=512 chars. |
| useWhen / avoidWhen | Up to 8 concise applicability or exclusion conditions each. |
| keywords | Up to 24 aliases; preserve needed Korean names. |
| inputs / outputs | Up to 8 expected input/output descriptions each. |
| compatibility | Up to 8 platform/tool/version requirements; not verified installation. |
| relatedSkills / incompatibleSkills | Up to 8 stable skill IDs each; advisory only. |
| effects | Declared operations from the fixed set below, not grants. |
| connections | Up to 8 objects: kind, logical target, effects. |
| examples | Up to 4 objects: query, action, expected, optional avoid. |
| impactClaims | At most one claim per axis, always unverified author claims. |

Effects: read_public, read_private, write_workspace, delete_data, read_credentials,
modify_account, write_environment, network_send, install_dependencies, start_process,
register_mcp, register_hook, financial_transaction, irreversible_action.
Connection kinds: path, program, api, uri, hook, mcp, package, process, environment.
Targets must omit secrets, URL query/fragment/userinfo and personal host paths.
Mentioning MCP does not mean registration; declare register_mcp only when intended.

Example query <=256, action <=128, expected <=512, avoid <=256 chars.
Action is a logical identifier such as documents.read, never a shell command.
Examples are inert search data, not tool availability, consent or execution.
Impact claim: axis, level, scenario, assumptions, jurisdictions, references.
Axes: domain, policy, legal, assets, accounts, data, system.
Levels: unknown, low, moderate, high, critical; never average independent axes.
Use jurisdiction/policy version/date in review references; no automatic compliance verdict.
Unknown fields (including approval, usage counters and host grants) are rejected.
Existing skill_origin/version/origin_sha256/license preserve provenance, not safety proof.
