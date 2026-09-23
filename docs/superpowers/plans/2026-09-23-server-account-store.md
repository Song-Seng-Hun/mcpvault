# Server Account Store Implementation Plan

> **For agentic workers:** Use executing-plans with test-driven-development.

**Goal:** Make existing MCP registration/login use an explicitly protected
Windows-server account database without moving NAS notes or weakening callers.

**Architecture:** Preserve ScopeAuthService and the five-tool MCP surface.
Add an opt-in accountStorePath host option and --account-store CLI flag. Validate
the existing file before account reads/writes, and lock beside that database.
This is the storage portion of remote authentication, not a replacement login.

**Tech Stack:** TypeScript, Node, existing native Windows ACL checks, Vitest.

## Execution receipt (2026-09-23)

- Implemented account-store admission, CLI/factory wiring and adjacent locking.
- RED: five new assertions failed before implementation (CLI/store routing,
  missing-store handling, locking, unsafe paths).
- Target verification: 55 tests passed across account-store, CLI, scope-security,
  enterprise-auth and Windows ACL suites. `npm run build` exited 0.
- Full integration NOT passed: run `server-account-store-20260923` stopped in
  batch 1 with 239 passed / 1 timeout (`benchmark-host-cli.test.ts`, 5000 ms).
  Isolated diagnostic of that file passed 5 tests; it does not replace full
  integration or establish the timeout's root cause. Reports remain under
  `.mcpvault/test-runs/server-account-store-20260923/` and must not be committed.
- Runtime inspection (metadata only): PID 18204 uses source dist/server.js,
  stdio, no explicit account store, and Vault argument `E:llm_wikillm_wiki`
  (drive-relative, not the authoritative NAS root). Authoritative NAS directory
  and its account database exist. Do not infer this process's resolved cwd/root
  or copy its data into the NAS.
- No production account migration, account creation, restart, tunnel change,
  credential retrieval or Vault write was performed. Mac credential-to-call
  integration remains unresolved; this storage feature alone is not completion.
- Changes remain uncommitted/undeployed pending full integration and live-root
  reconciliation. Existing unrelated work was preserved.

## 1. Reproduce missing host configuration

- [ ] Add CLI tests: `parseCliArgs(['Vault', '--account-store', 'private.json'])`
  must preserve Vault and yield accountStorePath; missing/duplicate values fail.
- [ ] Add isolated account-store tests using owner-only temporary storage:
  registration writes only to selected database; a second service can log in;
  password/token plaintext is absent; lock belongs to selected database.
- [ ] Add rejection tests for missing database, Vault/source-relative paths,
  symlinks/hardlinks, permissive ACL, and conflicting enterprise configuration.
- [ ] Run `npm test -- src/account-store.test.ts src/cli.test.ts` and retain
  the expected feature-failure evidence before implementation.

## 2. Implement bounded storage admission

- [ ] Add `src/account-store.ts` for canonical path/source-boundary checks,
  native ACL verification, local fixed-volume validation on Windows and
  hardlink rejection. Reuse existing storage helpers; do not change live ACLs.
- [ ] In ScopeAuthService, optional personal `accountStorePath` is exclusive
  with enterprise/internal authPath. Validate before cached reads and writes.
  Missing explicit stores fail; never silently create or fall back.
- [ ] Set the explicit personal lock to `${accountStorePath}.lock`; retain
  legacy defaults and enterprise behavior. Verify temporary file permissions
  before writing verifier data, and preserve atomic publication.
- [ ] Wire CreateServerOptions, CLI parser and server entrypoint. Keep this
  host-only: no endpoint accepts a storage path or grants an identity.

## 3. Verify and document

- [ ] Rerun targets plus scope-security and enterprise-auth tests, then build.
- [ ] Document that the operator must provision a private existing store and
  migrate under stopped writers with a protected backup; no automatic copy.
- [ ] Run full integration before any live replacement, inspect source/dist
  diff, stage only owned files and run check:staged.

## 4. Deployment and remaining authentication boundary

- [ ] Verify live runtime source and NAS root before deployment. Do not use a
  recovered local Vault, invent an account ID or silently replace a database.
- [ ] Preserve rollback artifacts. Deploy only the verified build and only
  configure storage after the private destination and account migration are
  verified. Commit/push only to the current branch of the confirmed fork.
- [ ] Separately validate a client-private credential-to-MCP call path before
  claiming Mac writes work. Existing auth.register/login still require caller
  proof; server storage alone cannot replace it. Do not bind all tunnel calls
  to one account, create a public listener, or reintroduce browser OAuth scope
  without a concrete approved design. Report this boundary if unavailable.
