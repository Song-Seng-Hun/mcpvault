# Authority Shelf Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scope-safe authority-scheme shelf browsing and reciprocal `close_match` discovery to the existing dynamic Wiki API without adding fixed MCP tools or a second source of truth.

**Architecture:** Extend the central organization contract so graph, backlink, planner, lint, and manifest code consume one relation definition. Add normalized scheme/ID lookup to the existing disposable `VaultMetadataIndex`, expose it through `FileSystemService`, and project it through the existing `wiki.authority_map` endpoint. Extend the incremental lexical search index and binary snapshot with explicit authority match classes; Markdown and Properties remain authoritative and visibility filtering occurs before collision or neighborhood calculations.

**Tech Stack:** TypeScript, Node.js, MCP SDK, Vitest, Obsidian Markdown/YAML Properties, existing binary derived indexes, npm build pipeline.

---

## File structure and responsibilities

- `src/organization.ts`: central typed-relation and Property contract.
- `src/types.ts`: authority shelf and compact search match types.
- `src/vault-index.ts`: incremental normalized authority scheme/ID lookup.
- `src/filesystem.ts`: thin adapter over `VaultMetadataIndex`.
- `src/llm-wiki.ts`: authority projection, cross-note lint, and manifest v6.
- `src/llm-wiki-tools.ts`: dynamic endpoint schema and description.
- `src/createServer.ts`: dispatch new arguments and document search behavior.
- `src/search.ts`: authority expansion and binary snapshot v6.
- `src/endpoint-registry.ts`: capability discovery terms.
- `src/wiki-policy.ts`: bounded retrieval and authoring guidance.
- `src/*.test.ts`: contract, index, endpoint, security, and bounds coverage.
- `_wiki/SCHEMA.md`, `README.md`, `plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md`: progressive documentation.
- `dist/`: generated output committed with source.

### Task 1: Define `close_match` once in the organization contract

**Files:**
- Modify: `src/organization.ts:79-102`
- Modify: `src/organization.test.ts`
- Modify: `src/llm-wiki-tools.test.ts:140-157`

- [ ] **Step 1: Write failing relation-contract tests**

Add assertions that the relation is accepted, reciprocal, and distinct:

```ts
expect(RELATION_FIELDS).toContain('close_match');
expect(RECIPROCAL_RELATIONS).toContain('close_match');
expect(getOrganizationRelationContract()).toEqual(expect.arrayContaining([
  expect.objectContaining({
    field: 'close_match',
    direction: 'mutual',
    reciprocal: true,
    target: expect.stringContaining('near-equivalent'),
  }),
]));
expect(getOrganizationRelationContract().find(item => item.field === 'same_as')?.target)
  .not.toBe(getOrganizationRelationContract().find(item => item.field === 'close_match')?.target);
```

Extend the tool-contract test so `close_match` is excluded from the directional relation-set enum and accepted by the reciprocal planner enum derived from `RECIPROCAL_RELATIONS`.

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
npm test -- src/organization.test.ts src/llm-wiki-tools.test.ts
```

Expected: FAIL because the central contracts do not contain `close_match`.

- [ ] **Step 3: Add the minimal central definition**

Update `src/organization.ts`:

```ts
export const RELATION_FIELDS = [
  'supports', 'contradicts', 'supersedes', 'derived_from', 'depends_on',
  'implements', 'blocked_by', 'answers_questions', 'tests', 'related',
  'same_as', 'close_match', 'version_of', 'refines',
] as const;

export const RECIPROCAL_RELATIONS = ['related', 'same_as', 'close_match'] as const;
```

Insert after `same_as`:

```ts
{
  field: 'close_match',
  direction: 'mutual',
  target: 'A near-equivalent concept useful for discovery but not safe to merge or treat as exact identity.',
  reciprocal: true,
},
```

Do not add a second hard-coded relation list: schemas, graph parsing, backlinks, reciprocal planning, read-only classification, and manifests already derive from these constants.

- [ ] **Step 4: Re-run the tests**

```bash
npm test -- src/organization.test.ts src/llm-wiki-tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/organization.ts src/organization.test.ts src/llm-wiki-tools.test.ts
git commit -m "feat: add close-match relation contract"
```

### Task 2: Add normalized incremental authority shelf lookup

**Files:**
- Modify: `src/types.ts:493-530`
- Modify: `src/vault-index.ts:15-35,186-260,690-780`
- Modify: `src/filesystem.ts:2975-3170`
- Modify: `src/filesystem.test.ts:1000-1060,2840-2895`

- [ ] **Step 1: Write failing shelf and invalidation tests**

Create metadata fixtures with `AI.2`, `AI.10`, and `AI.3` in the same scheme. Assert a new filesystem adapter returns `AI.2`, `AI.3`, `AI.10`, centers a two-row window around `AI.3`, and reports a deterministic insertion point for absent `AI.4`.

Update `AI.3` to `AI.11`, invoke normal invalidation, and assert the old ID disappears. Move the `AI.10` note, then delete it through existing notification paths; assert the moved path appears once and the deleted path leaves no authority entry. Hide one path with `canAccessPath` and assert it cannot affect entries, anchor index, or collision counts.

- [ ] **Step 2: Run the focused test**

```bash
npm test -- src/filesystem.test.ts -t "authority shelf"
```

Expected: FAIL because `queryAuthorityShelf` is absent.

- [ ] **Step 3: Add shared result types**

Add to `src/types.ts`:

```ts
export interface AuthorityShelfEntry {
  path: string;
  frontmatter: Record<string, any>;
  revision: string;
  authorityScheme: string;
  authorityId?: string;
}

export interface AuthorityShelfResult {
  entries: AuthorityShelfEntry[];
  totalVisible: number;
  truncated: boolean;
  anchor: {
    requested?: string;
    matched: boolean;
    insertionIndex: number;
  };
  collisions: Array<{ authorityId: string; paths: string[] }>;
}
```

- [ ] **Step 4: Extend `VaultMetadataIndex`**

Add:

```ts
private readonly authoritySchemeIndex = new Map<string, Set<string>>();
private readonly authorityPairIndex = new Map<string, Set<string>>();
```

Use common helpers:

```ts
function normalizeAuthorityComponent(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().normalize('NFKC').toLocaleLowerCase('en-US')
    : '';
}

function authorityPairKey(scheme: unknown, id: unknown): string {
  const s = normalizeAuthorityComponent(scheme);
  const i = normalizeAuthorityComponent(id);
  return s && i ? `${s}\u0000${i}` : '';
}

function naturalAuthorityCompare(left: string, right: string): number {
  return left.localeCompare(right, 'en-US', { numeric: true, sensitivity: 'base' });
}
```

Add/remove entries from both maps beside the existing filter/path indexes,
clear them in `close()`, and rebuild them after full refresh or snapshot load.
Empty values are not indexed. Use `authorityPairIndex` for exact visible pair
collision candidates rather than rescanning unrelated schemes.

Add:

```ts
async queryAuthorityShelf(params: {
  scheme: string;
  aroundAuthorityId?: string;
  includeUnclassified?: boolean;
  limit: number;
  canAccessPath?: (path: string) => boolean;
}): Promise<AuthorityShelfResult>
```

The implementation starts from `authoritySchemeIndex`, applies `canAccessPath` before sorting and counting, sorts IDs naturally with path as the stable tie-breaker, appends requested unclassified scheme rows after classified rows, computes collision groups from visible rows only, and then selects the anchor window. It must not cache principal-specific results.

- [ ] **Step 5: Add the filesystem adapter**

Add to `FileSystemService`:

```ts
async queryAuthorityShelf(
  params: {
    scheme: string;
    aroundAuthorityId?: string;
    includeUnclassified?: boolean;
    limit: number;
  },
  canAccessPath: (path: string) => boolean = () => true,
): Promise<AuthorityShelfResult> {
  if (!this.metadataIndex) {
    throw new Error('Authority shelf index is unavailable; retry after metadata initialization.');
  }
  return this.metadataIndex.queryAuthorityShelf({ ...params, canAccessPath });
}
```

- [ ] **Step 6: Run shelf and snapshot tests**

```bash
npm test -- src/filesystem.test.ts -t "authority shelf|metadata index"
```

Expected: PASS, including CRUD invalidation and corrupt-snapshot recovery.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/vault-index.ts src/filesystem.ts src/filesystem.test.ts
git commit -m "feat: index authority shelves incrementally"
```

### Task 3: Extend `wiki.authority_map`

**Files:**
- Modify: `src/llm-wiki.ts:11206-11295`
- Modify: `src/llm-wiki-tools.ts:311-323`
- Modify: `src/createServer.ts:1444-1446`
- Modify: `src/endpoint-registry.ts:343`
- Modify: `src/llm-wiki.test.ts:3108-3160`
- Modify: `src/llm-wiki-tools.test.ts:120-160`

- [ ] **Step 1: Write failing endpoint tests**

Through `call_endpoint`, request:

```ts
const shelf = await callJson(client, 'call_endpoint', {
  endpointId: 'wiki.authority_map',
  arguments: {
    scheme: 'local-topics',
    aroundAuthorityId: 'AI.3',
    limit: 3,
    maxChars: 2400,
    accessToken,
  },
});
expect(shelf.value).toMatchObject({
  scheme: 'local-topics',
  order: 'natural_authority_id',
  anchor: { requested: 'AI.3', matched: true },
});
expect(shelf.value.entries.map((entry: any) => entry.authorityId))
  .toEqual(['AI.2', 'AI.3', 'AI.10']);
expect(JSON.stringify(shelf.value).length).toBeLessThanOrEqual(2400);
```

Also test absent anchors, same-scheme visible collisions, legal cross-scheme ID reuse, unclassified inclusion, and rejection of `aroundAuthorityId` without `scheme`. Add a private duplicate and prove it cannot change the public collision or anchor result. Preserve the old no-scheme alias test.

Start a read-only server and assert the same authority projection succeeds while
the existing reciprocal mutation remains rejected; no new mutation name or
read-only exception is introduced.

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/llm-wiki.test.ts -t "authority.*shelf|authority, maintenance"
```

Expected: FAIL because the schema and service do not accept shelf arguments.

- [ ] **Step 3: Extend the dynamic endpoint schema**

Add to `get_wiki_authority_map`:

```ts
scheme: {
  type: 'string',
  maxLength: 120,
  description: 'Optional authority scheme. When set, browse one naturally ordered scheme shelf.',
},
aroundAuthorityId: {
  type: 'string',
  maxLength: 200,
  description: 'Bound the shelf around this authority ID; requires scheme.',
},
includeUnclassified: {
  type: 'boolean',
  default: false,
  description: 'Append visible notes in the selected scheme that have no authority_id.',
},
```

Update schema tests for lengths and default.

- [ ] **Step 4: Route an options object**

In `src/createServer.ts`:

```ts
return jsonResult(await llmWiki.authorityMap(principal, {
  query: trimmedArgs.query,
  scheme: trimmedArgs.scheme,
  aroundAuthorityId: trimmedArgs.aroundAuthorityId,
  includeUnclassified: trimmedArgs.includeUnclassified === true,
  limit: trimmedArgs.limit,
  maxChars: trimmedArgs.maxChars,
}), trimmedArgs.prettyPrint);
```

- [ ] **Step 5: Implement the projection**

Use this signature:

```ts
async authorityMap(principal?: ScopePrincipal, options: {
  query?: unknown;
  scheme?: unknown;
  aroundAuthorityId?: unknown;
  includeUnclassified?: boolean;
  limit?: unknown;
  maxChars?: unknown;
} = {})
```

Reject the invalid combination with:

```ts
throw new Error('aroundAuthorityId requires scheme so the authority ID has an unambiguous classification context');
```

With `scheme`, call `fileSystem.queryAuthorityShelf` using the caller predicate and project compact entries:

```ts
{
  path: this.access.toPublicPath(entry.path),
  title,
  authorityId,
  preferredTerm,
  revision: entry.revision,
  ...(aliases.length && { aliases: aliases.slice(0, 8) }),
  ...(closeMatches.length && { closeMatches: closeMatches.slice(0, 8) }),
}
```

Filter `query` only within the authorized shelf population. Report visible collision issues with at most eight visible paths. Trim final entries/issues until the serialized result fits `maxChars`, while preserving scheme, order, anchor, total, and truncation metadata.

Without `scheme`, preserve the existing term/alias response.

- [ ] **Step 6: Extend capability discovery**

Add `scheme`, `shelf`, `call number`, `authority id`, and `close match` to the existing endpoint keywords.

- [ ] **Step 7: Run endpoint and schema tests**

```bash
npm test -- src/llm-wiki.test.ts src/llm-wiki-tools.test.ts -t "authority|tool schemas"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/llm-wiki.ts src/llm-wiki-tools.ts src/createServer.ts src/endpoint-registry.ts src/llm-wiki.test.ts src/llm-wiki-tools.test.ts
git commit -m "feat: add bounded authority shelf browsing"
```

### Task 4: Add explicit authority relation classes to search

**Files:**
- Modify: `src/types.ts:182-225`
- Modify: `src/search.ts:15-90,330-500,523-610,1000-1040,1170-1215,1435-1460,1587-1695`
- Modify: `src/search.test.ts:40-140`
- Modify: `src/createServer.ts:546-562`
- Modify: `src/createServer.test.ts`

- [ ] **Step 1: Write failing search tests**

Create separate notes that match only `authority_id`, `same_as`, `close_match`, `broader_terms`, or `related_terms`. Verify relation-only matches require `expandAuthority: true` and have distinct reasons:

```ts
expect(byPath.get('same.md')).toMatchObject({
  why: expect.arrayContaining(['same_as_match']),
  au: expect.objectContaining({ relation: 'same_as', confidence: 'exact' }),
});
expect(byPath.get('close.md')).toMatchObject({
  why: expect.arrayContaining(['close_match']),
  au: expect.objectContaining({ relation: 'close_match', confidence: 'high' }),
});
expect(byPath.get('broader.md')!.au!.confidence).toBe('medium');
expect(byPath.get('related.md')!.au!.confidence).toBe('low');
```

Verify rank order is same-as, close-match, broader, related when other text is equal. Verify `limit` and `maxChars`, update/delete invalidation, and restart from a binary snapshot.

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/search.test.ts -t "authority|snapshot|invalidates"
```

Expected: FAIL because the index lacks same/close fields and `au`.

- [ ] **Step 3: Extend compact types**

Add to `SearchResult`:

```ts
au?: {
  relation: 'authority_id' | 'same_as' | 'close_match' | 'broader' | 'related';
  confidence: 'exact' | 'high' | 'medium' | 'low';
  matched: string;
};
```

Rename the existing `RankCandidate.authorityMatch` boolean to
`authorityTermMatch`, then add:

```ts
authorityIdMatch: boolean;
sameAsMatch: boolean;
closeMatch: boolean;
authorityExpansion?: SearchResult['au'];
```

Keep broader/related booleans for compatibility.

- [ ] **Step 4: Extend indexed and snapshot records**

Add to `IndexedDocument` and `SearchSnapshotDocument`:

```ts
authorityIds: string[];
sameAsTerms: string[];
closeMatchTerms: string[];
```

Increment `SEARCH_SNAPSHOT_VERSION` from 5 to 6 and encode/decode these bounded arrays beside existing authority arrays. Old/corrupt snapshots return `undefined` and rebuild through the existing path.

Extend `authorityMetadataFromFrontmatter`:

```ts
return {
  authorityTerms: [...title, ...aliases.slice(0, 32).map(alias => alias.trim())],
  authorityIds: typeof frontmatter.authority_id === 'string' && frontmatter.authority_id.trim()
    ? [frontmatter.authority_id.trim()]
    : [],
  sameAsTerms: list('same_as', 20),
  closeMatchTerms: list('close_match', 20),
  broaderTerms: list('broader_terms', 20),
  relatedTerms: list('related_terms', 20),
};
```

- [ ] **Step 5: Rank and explain**

Choose one strongest explicit match:

```ts
const authorityExpansion = authorityIdValue
  ? { relation: 'authority_id', confidence: 'exact', matched: authorityIdValue } as const
  : sameAsValue
    ? { relation: 'same_as', confidence: 'exact', matched: sameAsValue } as const
    : closeMatchValue
      ? { relation: 'close_match', confidence: 'high', matched: closeMatchValue } as const
      : broaderValue
        ? { relation: 'broader', confidence: 'medium', matched: broaderValue } as const
        : relatedValue
          ? { relation: 'related', confidence: 'low', matched: relatedValue } as const
          : undefined;
```

Evaluate same/close/broader/related only when `expandAuthority` is true. Add deterministic boosts in `rerank`:

```ts
score += c.authorityExpansion?.relation === 'authority_id' ? 2.0
  : c.authorityExpansion?.relation === 'same_as' ? 1.6
  : c.authorityExpansion?.relation === 'close_match' ? 1.2
  : c.authorityExpansion?.relation === 'broader' ? 0.8
  : c.authorityExpansion?.relation === 'related' ? 0.4
  : 0;
```

Materialize `authorityExpansion` as `au` and one reason:
`authority_id_match`, `same_as_match`, `close_match`, `broader_term_match`, or
`related_term_match`. Continue using `authorityTermMatch` for preferred-term and
alias behavior. Keep `boundSearchResults` as the final limiter.

- [ ] **Step 6: Update search tool guidance**

Describe the explicit confidence order and state that embeddings never fabricate authority relations.

- [ ] **Step 7: Run tests**

```bash
npm test -- src/search.test.ts src/createServer.test.ts -t "authority|search"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/search.ts src/search.test.ts src/createServer.ts src/createServer.test.ts
git commit -m "feat: rank explicit authority relations in search"
```

### Task 5: Add integrity and reciprocal health checks

**Files:**
- Modify: `src/organization.ts:1320-1380`
- Modify: `src/llm-wiki.ts:8270-8340,9230-9260,13270-13670`
- Modify: `src/llm-wiki.test.ts:1503-1555,3307-3350`

- [ ] **Step 1: Write failing lint, graph, and planner tests**

Add a missing reverse `close_match` edge and assert graph health returns:

```ts
expect(graph.value.typedRelations.reciprocityMissing.items).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      path: 'Knowledge/Left.md',
      target: 'Knowledge/Right.md',
      relation: 'close_match',
      repair: {
        endpointId: 'wiki.reciprocal_link',
        arguments: {
          leftPath: 'Knowledge/Left.md',
          rightPath: 'Knowledge/Right.md',
          relation: 'close_match',
        },
      },
    }),
  ]),
);
```

Apply the planner's revision-checked change set and verify the issue disappears. Reuse the stale-revision path to prove concurrent edits reject it.

Add lint fixtures for empty/scalar authority fields, ID without scheme, visible duplicate pairs, legal cross-scheme reuse, unresolved close match, and a hidden duplicate. Assert only visible bounded issues appear.

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/llm-wiki.test.ts -t "reciprocal-link|authority integrity|relation health"
```

Expected: FAIL on new codes and relation behavior.

- [ ] **Step 3: Add single-note diagnostics**

In `organizationLintIssues`:

```ts
if (frontmatter.authority_scheme !== undefined
  && (typeof frontmatter.authority_scheme !== 'string' || !frontmatter.authority_scheme.trim())) {
  issues.push({ code: 'invalid_authority_scheme', detail: 'authority_scheme must be a non-empty string.' });
}
if (frontmatter.authority_id !== undefined
  && (typeof frontmatter.authority_id !== 'string' || !frontmatter.authority_id.trim())) {
  issues.push({ code: 'invalid_authority_id', detail: 'authority_id must be a non-empty string.' });
}
if (typeof frontmatter.authority_id === 'string' && frontmatter.authority_id.trim()
  && !(typeof frontmatter.authority_scheme === 'string' && frontmatter.authority_scheme.trim())) {
  issues.push({ code: 'authority_id_without_scheme', detail: 'authority_id requires authority_scheme because IDs are scheme-local.' });
}
```

- [ ] **Step 4: Add visible-only pair collision lint**

Inside the existing authorized lint scan:

```ts
const authorityOwners = new Map<string, {
  path: string;
  scheme: string;
  id: string;
}>();
```

Normalize scheme and ID with the metadata-index rules. On the second visible owner, emit `duplicate_authority_id` with only the first visible public path. Populate this map only after access and moderation filtering. Add the codes to the maintenance/review issue catalog.

The existing central relation loops must handle `close_match`; add regression tests, not duplicate implementation branches.

- [ ] **Step 5: Run tests**

```bash
npm test -- src/llm-wiki.test.ts -t "reciprocal-link|authority integrity|relation health|organization"
```

Expected: PASS with no hidden path or cardinality leak.

- [ ] **Step 6: Commit**

```bash
git add src/organization.ts src/llm-wiki.ts src/llm-wiki.test.ts
git commit -m "feat: validate authority identities and close matches"
```

### Task 6: Publish manifest v6 and progressive guidance

**Files:**
- Modify: `src/llm-wiki.ts:800-880,4310-4560`
- Modify: `src/llm-wiki.test.ts:3450-3580`
- Modify: `src/wiki-policy.ts:1-225`
- Modify: `src/wiki-policy.test.ts`
- Modify: `_wiki/SCHEMA.md:70-100,395-465,525-545,595-615`
- Modify: `README.md:250-275,375-405,590-610,715-735,950-980`
- Modify: `plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md:85-110`

- [ ] **Step 1: Write failing manifest and policy tests**

Expect version 6 and this comparable contract:

```ts
authority: {
  identity: ['authority_scheme', 'authority_id'],
  identityScope: 'scheme_local',
  shelfOrder: 'natural_authority_id',
  relationStrength: ['same_as', 'close_match', 'broader', 'related'],
}
```

Verify version-5 comparison warns about reviewed migration. Verify a version-6 counterpart with conflicting authority order or relation reciprocity is blocking. Verify readiness includes `close_match` only for Global-visible content.

Assert the retrieval policy mentions `aroundAuthorityId`, the knowledge policy distinguishes the three relation strengths, and requested `maxChars` remains enforced.

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/llm-wiki.test.ts src/wiki-policy.test.ts -t "manifest|policy"
```

Expected: FAIL because the manifest is version 5 and guidance is absent.

- [ ] **Step 3: Extend the comparable manifest**

Add optional shape:

```ts
authority?: {
  identity?: unknown;
  identityScope?: unknown;
  shelfOrder?: unknown;
  relationStrength?: unknown;
};
```

Normalize it into bounded values in `comparableOrganizationManifest`, include it in the fingerprint, add the contract above, and set:

```ts
manifestVersion: 6,
```

Emit `authority_contract_conflict` when a version-6 counterpart has different identity scope/order and `missing_authority_contract` for an older counterpart. Never reinterpret missing `close_match` as `same_as`.

- [ ] **Step 4: Update bounded policy**

Increment `WIKI_POLICY_VERSION` from 8 to 9. Add to `retrieval`:

```ts
'Browse one classification with wiki.authority_map scheme plus an optional aroundAuthorityId; shelf order is advisory and every returned revision must be re-read before editing.',
```

Add to `knowledge`:

```ts
'Use same_as only for exact identity, close_match for reciprocal near-equivalence that must not be merged automatically, and related for general association.',
```

Do not expand eager server instructions.

- [ ] **Step 5: Update human and client docs**

Use this ordinary Obsidian example:

```yaml
authority_scheme: llm-wiki-topics
authority_id: AI.12.3
close_match:
  - '[[Knowledge/Near-equivalent concept]]'
```

Explain scheme-local identity, bounded natural shelf browsing, exact/close/general relation strengths, advisory status, and progressive discovery without schema preloading.

- [ ] **Step 6: Run documentation contract tests**

```bash
npm test -- src/llm-wiki.test.ts src/wiki-policy.test.ts src/instruction-budget.test.ts src/llm-wiki-tools.test.ts -t "manifest|policy|instruction|authority"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/llm-wiki.ts src/llm-wiki.test.ts src/wiki-policy.ts src/wiki-policy.test.ts src/instruction-budget.test.ts _wiki/SCHEMA.md README.md plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md
git commit -m "docs: publish authority organization contract v6"
```

### Task 7: Verify generated output and deliver only to the fork

**Files:**
- Modify: `dist/` generated files
- Verify: all changed source, tests, docs, and Git state

- [ ] **Step 1: Run all focused suites**

```bash
npm test -- src/organization.test.ts src/filesystem.test.ts src/search.test.ts src/llm-wiki.test.ts src/llm-wiki-tools.test.ts src/createServer.test.ts src/wiki-policy.test.ts src/instruction-budget.test.ts
```

Expected: zero failed tests.

- [ ] **Step 2: Build committed distribution output**

```bash
npm run build
```

Expected: exit 0 and only expected `dist/` changes.

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: zero failed tests.

- [ ] **Step 4: Check hygiene**

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; `.agents/` and `.mcpvault/` stay untracked and unstaged; no credentials, caches, releases, or unrelated files are included.

- [ ] **Step 5: Commit generated output if changed**

```bash
git add dist
git commit -m "build: refresh authority shelf distribution"
```

If the build produces no `dist/` changes, do not create an empty commit.

- [ ] **Step 6: Verify the destination**

```bash
git remote get-url origin
git branch --show-current
git status --short --branch
```

Expected remote `https://github.com/Song-Seng-Hun/mcpvault.git`, branch `main`.

- [ ] **Step 7: Push only the authorized fork main**

```bash
git push origin main
```

Do not create a pull request, release, package publication, tag, or upstream mutation.

- [ ] **Step 8: Verify remote head**

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: identical hashes.
