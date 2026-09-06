# Graph visibility cache authorization

## Evidence and contract

The WeakMap used a predicate function plus graph generation as the entire
visibility identity. A caller could retain the same function while changing
its captured permission state. Outlinks/unresolved/orphan results then reused
previously visible membership or missed newly granted targets. Backlinks could
mix authorization states across their asynchronous source checks.

Three initial tests reproduced stale revocation/grants/inventory. Two additional
tests reproduced permission changes during backlinks with and without snapshot
output. The pre-existing per-author backlink access check already passed one
control test, so the defect is not described as universal author disclosure.

## Implementation

- Re-evaluate known path membership each visibility query, without extra note
  body reads. Reuse sorted resolver and incoming-edge cache only if membership
  and graph generation match. Membership equality compares actual path sets,
  never only their count.
- After asynchronous backlink source checks, require the graph generation and
  visibility view to remain stable. Otherwise reject with a generic retry error.
- No new endpoint, client requirement or authority store. Revisions, scopes,
  moderation and Markdown remain authoritative; a cache cannot grant access.

## Verification scope

Tests cover revocation/grants, unresolved/orphan inventory, asynchronous drift,
same-size membership swaps, contextual redaction and interleaved identities.
Build, full suite and compiled cache smoke are required before publication.

This change checks permissions over known graph paths. It does not independently
refresh every file's contents/moderation, discover all missing watcher events,
or claim an atomic external-filesystem census. Those audit items remain open.

Astra review independently probed membership swaps, cross-identity separation
and asynchronous changes. It also identified an obsolete archive optimization
test that required fewer than 100 authorization calls; current membership
checks correctly require 923 in that fixture. The test now distinguishes
mandatory authorization checks from expensive reverse-cache identity and
source parsing reuse. The first full suite failed only that old assertion.

Compiled graph smoke confirms grants/revocation, context redaction and async
drift rejection with zero additional body reads after warm-up. Temporary Vault
removed. Final full suite: 1604 passed, one skipped across 119 files (81.15s).
The 66-test focused suite, build and diff check also passed before commit.
