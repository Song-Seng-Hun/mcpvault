# Source-pinned plain-language explanations

This opt-in service recommends voluntary work; it never calls a model, wakes an
agent, creates an account or grants tool authority. Gemini drafting preference is
the operator's role preference, not a claim of higher model quality. Other verified
model families review. Existing user work, assigned work and notifications take
priority; optional benchmark participation follows explanation work.

## Host configuration

Pass `--explanation-config /absolute/private/explanations.json`. The existing
owner-private file and its directory must be outside the source checkout and Vault.
The Vault binding and file permissions are verified. No settings or identity are
guessed; changing the file invalidates the running binding until a verified restart.

```json
{
  "version": 1,
  "enabled": true,
  "vaultPath": "/absolute/live-vault",
  "sources": [{ "path": "Guide.md", "language": "ko", "audience": "beginner" }],
  "profiles": [
    { "accountId": "approved-writer", "family": "gemini", "version": "exact-host-verified-version", "hostVerified": true, "tier": "standard", "tools": [], "capabilities": ["task"] },
    { "accountId": "approved-reviewer", "family": "gpt", "version": "exact-host-verified-version", "hostVerified": true, "tier": "standard", "tools": [], "capabilities": ["task"] }
  ]
}
```

These account names and versions are illustrative, not live approvals. Use existing
verified account IDs and actual versions. At most 64 explicitly selected sources
are allowed. Start with small onboarding/usage notes. There is no recursive scan.
Repository documents must first be explicitly imported using `mcp.ingest_source`
(discover its current schema once), with literal content and its repository commit
and file identity recorded in the source metadata. Re-read the immutable imported
source and configure its returned Vault path; never pass host paths to this service.
The immutable source revision pins the actual imported bytes. Updating an imported
document creates a new snapshot and requires an explicit collection change.

## Pull workflow

1. `explanations.list` or an idle `get_agent_pulse` identifies eligible work.
2. `explanations.read` returns exact source/job revisions and a voluntary continuation.
   Read its `sourceAction` before drafting. `explanations.claim` uses those revisions,
   a caller-selected `requestId` and the authenticated task account. One active job
   per writer is allowed; `explanations.release` relinquishes unfinished work.
3. `explanations.draft` submits 1–24 blocks, each with `text`, `startLine`, `endLine`
   and optional `example: true`. Lines refer to the Markdown body, excluding Properties.
   Each block is limited to 3000 text characters and 4000 serialized JSON characters
   so controls/escaped Unicode cannot make an accepted block impossible to retrieve.
   Cover every substantive source line. Preserve numeric/API/path/inline-code tokens,
   fenced commands, and original conditional/prohibitive sentences verbatim beside
   their plain-language explanations. Keep original technical terms. Examples remain
   labeled and cannot introduce unsupported literal claims.
4. A different host-verified account from another model family calls
   `explanations.review`. All four criteria (`fidelity`, `coverage`, `no_invention`,
   `clarity`) need a reason and every relevant zero-based block index. Only four
   complete `pass` judgments authorize reuse. Uncertainty or requested changes hold
   publication. A read receipt is not approval. Source errors should be reported
   separately, not silently corrected in the explanation.
5. Re-read the same target after each mutation. `explanations.read` serves approved
   blocks only while the source revision and current account/review authority match.
   Otherwise it returns the original-source action. No old text is served as current.

Drafts pin their author's host-verified execution profile; reviews pin the reviewer's
profile as well. Family, exact version, provider, reasoning setting, tier or declared
tools/capabilities changing across restart invalidates reuse. Volatile price and
remaining budget are not identity. A changed reviewer can explicitly review again
when the original author basis is still current; an author-profile change requires
an explicit new draft and review. Invalidated approvals permit this recovery rather
than leaving an immutable job permanently stuck. Records without pinned provenance
are not treated as current approvals.

Mechanical checks are deliberately conservative, not semantic truth verification.
The independent review must still catch omissions, unsupported meaning and misleading
simplification. Agreement does not prove the source itself is factually correct.

## Visibility and Obsidian

Drafts/reviews live in managed `_whispers/explanations/<job-id>.md` records, excluded
from ordinary note/search/export routes. Obsidian's trusted host user can inspect a
readable snapshot, source link, exact revision and criterion judgments. Its heading
explicitly says snapshot: offline Markdown cannot promise live freshness. Public
guidance must use `explanations.read`, never copy a snapshot into a public index.
Authenticated approved task profiles may see drafts only if they can also read the
source. Public approved text never widens source access. WIP, current account status,
source revision and CAS checks remain active on the short reuse route.
Read-time revision checks cover the complete listed inventory; request-local change
observers and a final synchronous access check reject in-process changes between
awaits. These safeguards are not a cross-process filesystem snapshot guarantee.

No live collection or account profile is created by deployment. Without explicit
host configuration, the dynamic endpoints are disabled and existing guidance is
unchanged. Disabling the feature does not delete originals or work records.
