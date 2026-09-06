# Coherent, Bounded MOC Rebalance Proposals

User delegated design approval and fork-main publishing. Proposal-only; no live
Vault changes, new MCP tools/services, client setup, or server restart.

## Evidence and options

mocRebalance treats every Markdown occurrence as a wikilink, repeatedly reads
whole member/relation bodies without a byte bound, checks only the root revision,
renders scope:// addresses and unsafe aliases into drafts, reveals hidden target
existence through noteExists, and trims entries without trimming draft links.

Recommended: share exact safe proposal-link rendering with mocCandidates; use
one request-local bounded fresh metadata cache, verify observed revisions, and
regenerate draft/dependency projections when trimming. Alternative root-only
validation leaves member drift undetected. Removing limits violates the context
and resource contract. No global transaction or new permanent cache is claimed.

## Requirements

1. Read root with MAX_NOTE_CONTENT_BYTES. Resolve each authored occurrence by
   its actual syntax, preserving source-relative Markdown/Obsidian resolution.
2. Read member/relation/collision metadata fresh/strict with the same byte cap,
   at most once per physical identity and at most256 distinct metadata paths.
   No member bodies retained. Exceeding inspection budget requests a smaller
   limit, not a silently fabricated complete plan.
   Use a request-local resolver factory: indexed deployments reuse their index;
   unindexed deployments enumerate allowed paths once, and only bare alias terms
   load descriptors through the same bounded reader. Path enumeration remains
   proportional to namespace size. Revalidate returned identity matches against
   admitted metadata so a stale index alias cannot bind to a new unrelated revision.
3. Final bounded revision validation covers root and every observed visible
   metadata source, including relation labels and destination hints. Any drift,
   hiding, deletion or unavailable read fails closed with a refresh instruction.
4. Preserve physical exact-extension links in drafts; special filenames use
   explicitly relative encoded Markdown. Escape untrusted title/section text.
   API addresses remain public scope addresses. moc_parent must be a safe exact
   physical wikilink; if the parent filename cannot be represented, omit that
   property and provide an explicit parentLinkWarning. Do not invent hierarchy.
   Normalize Windows separators. Bare root filenames also use relative Markdown
   to avoid nested namesakes; root moc_parent uses an explicit ./ wikilink from
   the same-directory proposed sub-MOC.
5. Collision state discloses visible notes only. New proposals carry
   expectedRevision:missing; visible collisions carry a bounded notes.read
   nextAction, never permission to overwrite. Scope/reference filters remain.
6. When response budgeting trims a branch entry, regenerate its draft and drop
   cross-branch dependencies whose displayed endpoints were removed. Keep
   memberCount as observed total and entriesTruncated explicit. Final full
   envelope remains bounded, with a compact fallback if needed.
   If the compact echoed root path itself exceeds the budget, omit only that
   path with rootPathOmitted, keep its revision, and direct notes.read to the
   originally requested path. Do not truncate an identifier into another path.

## Validation

Real temporary notes: relative links and root namesakes, private scope draft
resolution, malicious titles, special parent filenames, hidden collisions,
member/relation/destination drift, byte caps and single metadata admission,
budget projection agreement and in-memory MCP surface. Run targeted tests,
build, independent integrity review and full one-worker regression suite.
