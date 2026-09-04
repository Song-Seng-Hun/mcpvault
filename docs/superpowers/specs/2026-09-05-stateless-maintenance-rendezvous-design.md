# Stateless Maintenance Rendezvous Routing

Date: 2026-09-05
Status: Approved for autonomous implementation

## Problem

`get_agent_pulse` now pulls one current Wiki maintenance plan when an agent has
no direct obligation. The cache is correctly scoped per authenticated account,
but every cache miss asks `wiki.review_packet` for the same globally first
priority. Multiple idle agents therefore spend context investigating the same
note. `expectedRevision` prevents an unsafe final overwrite, but does not
recover the duplicated reading and reasoning cost.

## Goals

- Spread equal-urgency maintenance candidates across authenticated worker
  identities without installing a runner or writing coordination records.
- Preserve the existing global priority order for ordinary
  `wiki.review_packet` callers.
- Never route a lower numeric priority ahead of a higher one.
- Keep one-candidate behavior, visibility, snooze filtering, current revisions,
  output bounds, and read-model invalidation unchanged.
- Make it explicit that routing is advisory and not an exclusive lease.

## Approaches considered

### Persistent claim Properties

Writing `maintenance_claimed_by` and an expiry to the target note would provide
strong coordination, but merely reading pulse would mutate authoritative
Markdown, create Git churn, need abandoned-lease cleanup, and make the claim
revision compete with the repair revision. Rejected.

### Server-local leases

An expiring in-memory map would avoid note churn, but assignments would differ
between processes and disappear on restart. It would make stateless deployment
semantics false and become a second coordination truth. Rejected.

### Authenticated rendezvous routing

Selected. Pulse derives an internal attention key from the authenticated
command center, account, model, and agent identity. `reviewPacket` gathers its
normal bounded, visible, unsnoozed candidates and identifies the minimum
numeric priority band. For each candidate in that band it computes
`sha256(attentionKey + NUL + path)` and chooses the lexicographically greatest
digest. The selected item moves to the front; every other candidate keeps its
existing deterministic order.

Rendezvous hashing is stateless and minimizes reassignment when a candidate is
removed. Different workers are likely, but not guaranteed, to choose different
targets; collisions remain safe because revision checks are authoritative.
When the band contains one item, all workers correctly see that same urgent
item.

## API and data flow

`LlmWikiService.reviewPacket` receives a fourth internal-only options object:

```ts
{ attentionKey?: string }
```

The registered `wiki.review_packet` endpoint continues calling it without that
object, so external callers cannot impersonate another identity's routing or
change its global order. `AgentPulseService` passes its existing per-principal
maintenance cache key as the attention key. No MCP tool, endpoint schema, REST
route, Property, file, or database is added.

When internal routing is used, the packet includes:

```json
{
  "attentionRouting": {
    "mode": "stateless_rendezvous",
    "candidateBand": 4,
    "exclusive": false
  }
}
```

The compact pulse plan carries this small card into its `wiki_maintenance`
context and signal. The action reason tells the agent to re-read the current
revision because the selection is not a lock.

## Security and failure behavior

- The key comes only from an authenticated `ScopePrincipal`; it is never a
  public endpoint argument and is not returned.
- Hashing happens after scope filtering, metadata freshness checks, moderation
  filtering, and snooze filtering. Hidden paths cannot affect the visible band.
- The card exposes only the visible bounded band size, not hashes or identities.
- Missing/empty keys use the original order.
- Hashing failure is not expected for bounded strings; the existing selected
  first item remains a safe fallback if no scored candidate exists.
- This is load distribution, not ownership. Every mutation still requires the
  existing current revision and permissions.

## Acceptance criteria

1. The public `wiki.review_packet` returns the same globally first candidate
   for the same Vault state.
2. Two authenticated identities can receive different candidates from a
   multi-item equal-priority band through `get_agent_pulse`.
3. Repeated pulses for one identity remain stable while the Vault generation
   and candidate set are unchanged.
4. A lower-priority candidate never wins over a higher-priority band.
5. A one-item band behaves exactly as before.
6. Routing metadata says `exclusive: false` and does not expose the key.
7. Hidden and snoozed notes cannot affect a visible worker's band or selection.
8. Minimum pulse output remains valid and bounded.
9. Build, focused tests, full tests, and `git diff --check` pass; `dist/` matches
   source.

## Delivery boundary

Commit and push only to `Song-Seng-Hun/mcpvault` branch `main`. Do not create a
pull request, release, tag, package publication, or upstream contribution.
