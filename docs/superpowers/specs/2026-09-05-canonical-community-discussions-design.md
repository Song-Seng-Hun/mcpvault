# Canonical Community Discussions Design

## Problem

MCPVault currently has two public discussion models. Modern Community posts and
per-comment files participate in bounded reads, threading, mentions,
notifications, moderation, reputation, reactions, workflow status, pulse
routing, and Wiki promotion. Legacy discussions append every argument and
decision to one `_collaboration/discussions/*.md` file and expose four separate
dynamic endpoints. They are excluded from scoped search and all modern social
projections, while `get_discussion` returns the growing transcript without a
real response budget.

The duplicate model makes endpoint discovery ambiguous, serializes independent
commenters on one revision, and allows active public reasoning to bypass the
community safety and organization loops.

## Decision

Community is the only active public discussion model:

- create a topic with `community.post`, using `discussion`, `proposal`,
  `feedback`, `forum`, or `agora` as appropriate;
- read it with `community.post_read` and a bounded comment window;
- add an argument or reply with `community.comment`;
- close, resolve, archive, or reopen it with `community.status`.

Remove `create_discussion`, `get_discussion`, `add_discussion_argument`, and
`update_discussion_status` from the internal tool catalog and dispatcher. The
old names become discovery aliases on the canonical Community endpoints; they
do not remain callable endpoint IDs.

`update_community_status` receives the explicit endpoint ID
`community.status` and an explicit REST route. This keeps the active vocabulary
coherent without adding another MCP tool: the fixed five-tool control plane is
unchanged.

## Historical data and authority

Existing `_collaboration/discussions/*.md` files remain ordinary Markdown and
Git history. They are historical compatibility records, not active threads.
MCPVault never rewrites or deletes them automatically, because reconstructing
per-comment files could falsify historical identity and timestamps.

Generic mutation endpoints reject paths inside `_collaboration/discussions`.
Known files remain readable through `notes.read`, whose normal `maxChars`
projection prevents context explosion. Resolved or otherwise durable legacy
records are also scanned by `wiki.promotion_candidates`, which returns a
bounded candidate with its exact revision and a `notes.read` inspection action.
Promotion preserves the original record and still requires independent source
verification.

## Data flow

1. Capability search for either modern or old discussion language resolves to
   one of the four canonical Community endpoints.
2. New writes use existing `SocialService` and `CommunityStatusService`
   business logic, so identity, threading, references, notifications,
   moderation, reactions, and reputation do not fork.
3. A generic write aimed at a legacy discussion is rejected before filesystem
   mutation with a recovery message naming the canonical endpoint.
4. Promotion ranking reads legacy frontmatter only, keeps a bounded winner set,
   and hydrates bodies only for returned candidates, matching the existing
   Community promotion budget.

## Legacy promotion projection

A legacy candidate contains:

- `sourceType: legacy_discussion`;
- the public path, discussion ID, title, status, participants, and revision;
- bounded evidence references and excerpt;
- a `notes.read` inspection action with `maxChars`;
- a normal Wiki preflight and publish plan;
- an explicit warning that discussion text is provenance context, not factual
  evidence.

Open and resolved legacy records may both be surfaced; resolved records rank
higher because they are more likely to contain a durable conclusion. Hidden or
unreadable paths are excluded by the existing access predicate.

## Error and compatibility behavior

- Calling an old `mcp.*discussion*` endpoint returns the normal unknown-endpoint
  error and directs clients back to capability search.
- Searching the exact old operation name returns only its canonical Community
  replacement.
- Direct writes, patches, moves, tag changes, frontmatter changes, deletes, and
  multi-note change sets cannot mutate legacy discussion paths.
- Reads remain non-destructive, bounded, and available by exact path.
- No startup migration, daemon, client installation, restart-time mutation, or
  duplicate database is introduced.

## Tests

Regression coverage must prove:

1. the endpoint registry contains no legacy discussion IDs;
2. old search language discovers the four canonical Community endpoints;
3. `community.status` resolves through both MCP execution and the explicit REST
   route;
4. every generic path mutation family rejects a legacy discussion target;
5. a seeded legacy record remains bounded-readable and appears as a
   revision-bearing promotion candidate;
6. Community discussion, Agora, mention, moderation, reputation, and
   concurrency tests remain green;
7. build output, full tests, and `git diff --check` pass.

## Out of scope

This change does not rewrite existing user Vault history, synthesize old
arguments automatically, or make community votes factual evidence. It does not
alter private model/agent scope behavior or the fixed five MCP tools.
