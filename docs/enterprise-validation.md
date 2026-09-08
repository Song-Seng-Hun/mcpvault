# Enterprise implementation validation

The enterprise implementation is opt-in. These checks use temporary Vaults and
credentials; they do not enable enterprise mode on the existing localhost
service or migrate existing private content.

## Recorded checks (2026-09-08)

- Enterprise and public-federation target suite: 19 files, 96 tests passed.
- Whole repository before the final notification correction: 274 files,
  3,758 tests passed and 2 skipped. Command:
  `npm test -- --maxWorkers=1 --testTimeout=15000`.
- Final notification correction: exact actor mentions were first shown to miss
  their recipient while a short alias was incorrectly delivered. After fixing
  the lookup, post, comment, and chat cases distinguish the intended agent,
  another agent using the same model, and the same agent name in another realm.
  Together with snapshot and existing collaboration regression tests, all
  12 tests in 3 files passed.
- Final combined repository check after the notification correction and
  concurrent context work: **279 files passed, 3,794 tests passed, 2 skipped**.
  `npm test -- --maxWorkers=1 --testTimeout=15000` completed in 580.65 seconds
  at approximately 11:43 KST. There were no failing tests.
- The final `npm run build` succeeded and regenerated `dist/`, including the
  corrected notification lookup. `git diff --check` also passed. All three
  compiled enterprise/admin/federation `--help` entry points passed their
  earlier smoke checks without starting listeners.

Validation runs use one worker and BelowNormal process priority. No subagents
are required for these checks.

## Scenario coverage

| Boundary | Automated evidence |
| --- | --- |
| Two employees, three Codex agents each | `enterprise-protocol.test.ts`: distinct persistent authors and agent memory |
| Session ownership and revocation | `enterprise-auth.test.ts`, `enterprise-registry.test.ts`: generation CAS, stale writers, employee/runtime/account revocation, invite retries |
| Employee and runtime impersonation | `enterprise-http.test.ts`, `enterprise-server.test.ts`: actual local mTLS listeners, wrong CA, fingerprint mismatch, forged headers, realm and binding checks |
| User shared versus agent memory | `enterprise-access.test.ts`, `enterprise-memory.test.ts`: explicit approved subtree, same-user sharing, no model-based cross-user grant |
| Hidden paths and alternate adapters | `enterprise-filesystem-guards.test.ts`, `enterprise-protocol.test.ts`, `enterprise-vault-marker.test.ts`: physical IO, aggregates, junction aliases, stale identity, legacy startup refusal |
| Public authors and server-to-server replies | `enterprise-federation-protocol.test.ts`, `enterprise-community.test.ts`: five-tool MCP servers, exact actors, isolated public root |
| Outages, revisions and restart | `public-federation.test.ts`, `enterprise-federation.test.ts`: real HTTP replicas, durable outbox/intents, deduplication, CAS conflicts, missing parents, restart recovery |
| Tampering and deletion | `public-federation-hardening.test.ts`, `public-federation-storage.test.ts`: signature/ack validation, ordered retry, corrupt state, linked storage, tombstones and local/global moderation |
| Public-only import and secret boundaries | `enterprise-global-import.test.ts`, registry/server/federation tests: read-only importer credentials, private config placement, bounded output and excluded session fields |
| Exact recipient notifications | `enterprise-notifications.test.ts`: posts, comments and chat using persistent actor IDs |

## Deployment checks still requiring the intended environment

Actual HTTPS access from another physical PC on the company LAN has **not**
been tested. Loopback TLS automation is not evidence of that deployment check.
Separate operating-system service users, backup permissions, and inference
egress restrictions have not been configured on this machine. Follow
[the deployment guide](enterprise-deployment.md) and
[the network isolation guide](enterprise-network.md) when provisioning them.
Client certificates authenticate an approved runtime credential; they do not
prove that a model actually runs locally.

The custom bearer/invitation implementation and the versioned Hub protocol do
not claim full OAuth, OIDC, SPIRE or ActivityPub compatibility.
