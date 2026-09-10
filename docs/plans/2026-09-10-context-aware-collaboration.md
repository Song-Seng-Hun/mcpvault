# Plan 2: Context-aware review and diverse staffing (approved 2026-09-10)

Status: queued after Plan 1, docs/plans/2026-09-10-context-economy.md.

## Goal and decisions

Prevent approvals without the actual changed context and evidence, while allocating task perspectives using model capability, execution tier and cross-family diversity. Extend voluntary groups/project roles; no field monopoly or model-derived permissions.

User decisions: task-specific essential perspectives; ordinary work may explicitly self-verify; security/permissions/shared-policy/destructive work retains independent-account approval; staffing is recommendation/handoff only, never automatic spawn, membership or execution. Optional departments remain unfilled unless needed.

## Implementation contract

1. Change-context package: goal, criteria, reasons/scope, upstream constraints/decisions/risks, exact before/after revision or Git snapshot, diff/source/test locators, unresolved dissent and unverified items. Compact manifest first, bounded original ranges next; integrate Plan 1 without copying entire conversations or private reasoning.
2. Structured review: each criterion pass/fail/unknown/not_applicable, exact evidence/version/range, rationale, tests/snapshot/environment/results and explicit missing checks. Required fail/unknown prevents approval; reviewer cannot silently mark mandatory checks N/A. Tests must address the actual change, not merely pass unrelated cases.
3. Review gating: caller/version-bound context delivery receipts plus criterion evidence, never a read receipt alone. Distinguish host-observed execution evidence from self-reported text. When required external verification is unavailable, remain pending. Reading is not proof of comprehension or protection from collusion.
4. Approval fingerprint includes required upstream context and criteria/constraints, not just artifact paths. Drift invalidates approval, preserving history. All completion/mutation routes share gates. Same-account different role/model is not independent. Explicit host-authorized override remains a separately labeled exception.
5. Initial user-preference profiles: Gemini creative/dialogue/story/translation/plain-language/YouTube work; Claude direction/ideas/planning/decomposition; GPT implementation/test/evidence/theory/tools. These are configurable preferences, not empirical universal rankings. All families need evidence. Tool access must actually exist. Fable biological fallback caution is version-specific; broad ML degradation is unverified, no fixed penalty or provider-safety bypass.
6. Execution profiles: provider/family/exact version, reasoning, tool availability, host verification, budget and economical/standard/frontier tier (not guessed parameter counts). Unknown execution identity stays unknown. Economy tier handles bounded mechanical work, standard normal integration, frontier complex/high-risk judgment subject to qualification.
7. Staffing precedence: eligible authority/tools/minimum capability/budget/WIP -> essential gaps -> independent reviewer -> cross-family diversity within roles and author/reviewer pair -> role preference/verified record -> cost/load. Keep active ownership; apply on new assignment/handoff/cross-review. Explain compromises; family diversity is primary, size differences secondary, no fake independent workers.
8. Essential perspectives by task: code implementation/change-impact/test; research source/counterpoint verification; writing language/continuity plus factual verification if needed; planning constraints/feasibility/risk. Owner may adjust defaults but never weaken high-risk rules. Prefer existing coverage, reasonable sequential multiple hats, existing reviewers, then host staffing recommendations. Optional marketing is not compulsory.
9. APIs: extend work.project policy, work.packet change context, work.review structured evidence, work.coverage declared vs verified coverage; add work.review_context and read-only work.staffing. All through fixed five controls/shared MCP+REST services; scoped bounded output. self_verified vs independently_reviewed clearly distinguished; independent approve path continues to reject author/requester/assignee accounts.

## Ordered checkpoints

- [ ] Versioned review contract and evidence/receipt tests.
- [ ] Review and completion gates, upstream drift and shared adapters.
- [ ] Model execution profiles, diversity staffing and task templates.
- [ ] Coverage, client guidance and adversarial collaboration evaluation.
- [ ] Independent specification and quality reviews; targeted tests, build, full tests, diff check.
- [ ] NAS deploy/rollback/live verification, generated dist, commit and push to user fork.

## Acceptance and rollout

Reject summary-only approvals, missing required reads, fabricated pass text, old/different-snapshot test results, omitted criteria and API bypasses. Exercise upstream revision races, account-role/model impersonation, solo ordinary/high-risk behavior, diverse and single-family staffing, inaccessible sources, WIP/budget/tool constraints, no unnecessary marketing/spawn. Evaluate injected defects/misleading handoffs against old behavior: false approvals, defect detection, unnecessary waits, cumulative tokens/calls/review time.

Preserve existing review history as the old contract. Enable the new contract per project for new work; migrate active work only explicitly by its owner. Acknowledge that evidence gates cannot prove actual understanding or independent control of every account. Models and reputation never confer authority.

## Research basis

- https://www.anthropic.com/research/multiagent-systems
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://www.anthropic.com/news/improving-fable-5-s-biology-safeguards
