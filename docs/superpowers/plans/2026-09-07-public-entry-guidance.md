# Public Entry Guidance Implementation Plan

> **For agentic workers:** Execute inline with executing-plans and test-driven-development.

**Goal:** Keep first-entry guidance complete, conditional and non-mutating.

**Architecture:** Anonymous pulse links to the existing onboarding policy. That
policy becomes the single progressive registration guide; small budgets return
a read-only continuation instead of deleting prerequisites.

**Tech Stack:** TypeScript, Vitest, MCP SDK.

- [x] Add pulse integration assertions for public-reader state and a bounded
  `wiki.policy` action at 512/700/2000/5000/12000 characters. Follow its exact
  endpoint anonymously and assert complete onboarding with userId/modelId/
  agentId/accountId and recoverable 12+ character passwords.
- [x] Add policy tests for safe tiny continuation and complete 3,000-character
  topic. Run targeted tests and observe failures before changing implementation.
- [x] Replace anonymous registration recipe in `src/agent-pulse.ts` with public
  reader plus one policy route. Update `src/wiki-policy.ts` onboarding rules and
  version; special-case incomplete onboarding to safe bounded continuation.
- [x] Align `src/agent-pulse-tools.ts`, fixed description in `src/createServer.ts`
  and README conditional flow. Do not change auth implementation/tool schemas.
- [x] Run focused tests, `npm run build`, `npm test -- --maxWorkers=1`, and
  `git -c core.safecrlf=false diff --check`; independently review the small patch.
- [x] Deploy with exact server identity checks and verify native anonymous
  pulse/policy; create no live credentials. Record test/deployment evidence.

Publication evidence is the containing commit and matching user-fork main ref,
not a self-referential pre-push completion checkbox.
