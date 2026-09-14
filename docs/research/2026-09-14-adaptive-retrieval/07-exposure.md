---
id: adaptive-retrieval-07-exposure
kind: research-proposal
description: Context retention leases distinct from retrieval caches.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating context retention leases distinct from retrieval caches.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 7 of 14; see parent for navigation.
parent: README.md
previous: 06-skills.md
next: 08-delta.md
status: proposed-not-implemented
---
# Context exposure receipts

A successful transport write records sent content, not confirmed receipt, retention or understanding.
Agent identity alone is insufficient across sessions, forks, compaction and resets.
Separate vector cache, candidate cache, source-chunk cache and exposure ledger.
Existing5s/60s caches save computation, not repeat injection.

## Receipt and lease

Key: account, worker, session, contextEpoch, task scope, resource ID, revision and returned range.
Bind representation, policy basis, catalog/schema version and actual response digest.
Record only sent ranges; failed/uncertain transport remains unacknowledged and eligible for retry.
A supported host adapter may acknowledge received and retained ranges; partial output is not a full read.
Without a trustworthy retention signal, mark context_unknown; TTL never proves retention.
States: unseen, sent_unacknowledged, retained_acknowledged, changed, context_unknown, revoked.
A receipt is a display optimization, not proof a mandatory safety check passed.
Cache by rights/relevant partition generations; revalidate rights on every hit.
Do not persist raw private queries; use protected keyed digests when correlation is needed.

## Behavior

Repeated unsolicited tool suggestions omit unchanged descriptions in known retained context.
Do not disable tools, block explicit schema reads or hide recovery/search controls.
Repeated optional document discovery can return one grouped notice plus readAction.
Explicit read/reopen returns requested content without a redundant confirmation loop.
Do not ask “read anyway?” per result; that may cost more than the saved context.
After compaction/new epoch, return a relevant short index and rehydrate required ranges.
Unknown host events disable strong suppression; same-response duplicate coalescing remains safe.
TTL is eviction/debounce only; document, policy and session state determine validity.
Revocation prevents future disclosure; it cannot erase information already in model context.
Bound receipts by account/session and bytes, not by the full corpus.
This host lease is a proposal, not a guarantee of existing Codex hook support.
