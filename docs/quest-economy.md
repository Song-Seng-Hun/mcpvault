# Experimental escrow-backed quests

## Deployment status

The reducer, single-writer journal, common service, fixed literal verifier and
dynamic MCP adapters are implemented. The normal server has no economy
configuration and remains disabled. This is not an announcement of a funded
production economy. There is no public mint, transfer or operator adjudication
endpoint. Existing reputation XP and free community participation are unchanged.

An embedding host can supply `CreateServerOptions.economy` with an opened
`EconomyLedger` and the identical host-approved `EconomyPolicy`. Do not invent
owner bindings from `userId`, model names, family, passwords or self-registration.
`storageVerified` is a host attestation, **not automatic proof** of local storage
or crash durability. Never attest a NAS/network drive. The private checkpoint
must be outside the Vault and source checkout. No live policy or currency was
created by these changes.

## Agent flow

Use the existing five MCP tools and `call_endpoint`, not direct journal writes:

1. `economy.wallet` shows only the current authenticated account's spendable XP.
2. `quest.market` returns at most three scope-visible choices. Read one exact
   contract for terms, exclusions, verifier and current revision before acting.
3. Create an existing project-backed Work task first. The requester drafts and
   funds it through `quest.contract`; funding deposits reward and review fee.
4. Another approved owner claims it through `quest.contract`. This bridges the
   existing Work claim/WIP checks. A free `work.claim` cannot take funded work.
5. Submit exact visible artifact revisions. Research/creative work requires an
   assigned reviewer belonging to neither requester nor worker owner.
6. `quest.review` binds the verdict, reason and review artifact to the exact
   submission basis. Approval pays once; a correction or dispute retains escrow.

Use the same `requestId` with the exact original payload after response loss;
do not silently substitute a new revision. A revision conflict requires a fresh
read. Read the same contract after a mutation, especially after automatic
mechanical verification: a submission receipt can precede a separate settlement.

`markdown-literal-v1` checks only agreed `literal:` strings in visible Markdown
prose, excluding frontmatter and fenced/inline code. It runs no shell, scripts,
regex supplied by users, models or external requests. It does not certify truth,
quality, novelty, safety or task completion. Security-sensitive Work kinds cannot
use it for automatic payment.

## Invariants and limits

- Spendable balances plus escrow equal issued supply. Fees return to treasury.
- Issuance/allocation require a separate host authority path, not signup/likes.
- Terms freeze at claim; owner-level paid WIP is one. Pilot owners are capped
  at ten; rewards, daily spend/posts and open contracts are bounded by policy.
- No negative balances, inflation by repeated payment, or public wallet lookup.
- Hidden/private task or project content is excluded before market pagination.
- Current artifacts and auth are rechecked before settlement; Markdown reads
  across different files are not claimed to be one atomic filesystem snapshot.
- The bounded append-only Markdown journal carries one complete financial
  transition per event, replay-checked hashes and permanent retry records.
- An exclusive canonical-Vault writer lock and external prepare/checkpoint fail
  closed on gaps, tail deletion, unknown state or a crash lock. Never steal a
  live lock or delete a checkpoint to make the error disappear.
- Writes stop at 10,000 events, 256 KiB per event or 32 MiB aggregate replay
  bytes. These conservative pilot limits are not a large-scale throughput claim.
- Wallet/market responses default to 4,000 characters, maximum 12,000, including
  the envelope and cursor. Market returns at most three choices.

## Remaining rollout gates

Not implemented/verified yet: administrator provisioning and crash-recovery CLI;
verified host-local storage probe; interrupted Work/ledger bridge reconciliation;
seven-day operator escalation and subjective-contract admission stop; operational
treasury allocation budget; paid Work projections and participation prompts;
real host-model economic comparison and process-kill/power-loss testing.

Until these gates and final security review pass, keep the production economy
disabled. Unit/MCP protocol tests are not actual Gemini/Claude/Codex behavior
evaluations, and a successful replay test is not a power-loss durability test.
