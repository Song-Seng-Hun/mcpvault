import type { ExtractionSuccess } from './types.js';

/**
 * Living examples documenting wiki_link resolution behavior across every
 * Obsidian block type.
 *
 * These fixtures are the canonical, in-code companion to the vault reference
 * document `ObsidianMCPAL Obsidian Wiki_Link Notation Supported And Behavior`
 * (path under the user's vault:
 * `5-Agentic-Assisted-Contexts/Shared-Contexts-Home-Work/At-Home/Obsidian-MCP-Access-Layer/`).
 * Keep these examples in lockstep with that document — when behavior shifts in
 * one place, update the other in the same change.
 *
 * Each `EXAMPLE_*` constant is a self-contained record:
 * - `markdown` — raw markdown body (no YAML frontmatter; lines are
 *   1-indexed and content-relative, matching the tool's line-number contract).
 * - `wikilink` — the wiki-link query as it would appear in source markdown.
 * - `expected` — the spec-intent {@link ExtractionSuccess} shape that
 *   `extractFragment` should return once all in-scope fixes land. Examples
 *   marked TODO document spec-intent for cases the current implementation
 *   does NOT yet satisfy.
 * - `note` — short scenario description with a pointer to the matching
 *   reference-document anchor when applicable.
 *
 * Cross-references:
 * - Reference doc: `## Per-Block-Type Expected Behavior` and
 *   `### Scenario Examples` define the canonical scenarios.
 * - Reference doc: `### Behavior Notes` / `#### Deferred Behaviors` lists
 *   cases intentionally excluded from immediate fix scope.
 * - Reference doc: `#### Line-Number Contract` — `startLine` / `endLine` are
 *   1-indexed and counted after frontmatter is stripped.
 * - Ticket: MCPVAULT-101 — `T1`+`T2` track the heading-attached block-id fix
 *   (Examples #9–#11). `T5` adds heading-attached test coverage; `T11`
 *   resolves the test fixture location decision (this file is the chosen
 *   home).
 *
 * Test consumption:
 * Vitest `*.test.ts` suites alongside this file should import the
 * `EXAMPLE_*` constants, feed `markdown` + the parsed fragment to
 * `extractFragment`, and assert the result matches `expected` field-by-field.
 *
 * Build exclusion:
 * The `.examples.ts` suffix mirrors the `.test.ts` co-location convention so
 * test/spec material lives next to the implementation. As of writing,
 * `tsconfig.build.json` excludes `*.test.ts` but does NOT exclude
 * `*.examples.ts`. Adding that exclusion is a follow-up — out of scope
 * for the file-creation step that introduced this module.
 *
 * @see {@link ExtractionSuccess}
 */

/**
 * Heading-text reference. The straightforward, currently-working case:
 * `[[Doc#Heading]]` returns the section under that ATX heading, terminated
 * by the next same-or-higher heading.
 *
 * Reference doc: `### Per-Block-Type Expected Behavior` row "Heading-as-section".
 */
export const EXAMPLE_HEADING_TEXT_REFERENCE = {
  markdown: `# Doc Title

## Summary

Summary body line.

## Other

Other body.
`,
  wikilink: '[[Doc#Summary]]',
  expected: {
    found: true,
    content: '## Summary\n\nSummary body line.\n',
    heading: 'Summary',
    level: 2,
    startLine: 3,
    endLine: 6,
  },
  note: 'Heading-text resolution; section terminated by next ## sibling.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Paragraph block-id. Anchor on its own line at the end of a multi-line
 * paragraph; backward walk stops at the previous blank line.
 *
 * Reference doc: `### Per-Block-Type Expected Behavior` row "Paragraph".
 */
export const EXAMPLE_PARAGRAPH_BLOCK_ID = {
  markdown:
    `Intro line, separate paragraph.

This paragraph spans
multiple lines and ends with an anchor.
^para-id
`,
  wikilink: '[[Doc#^para-id]]',
  expected: {
    found: true,
    content:
      'This paragraph spans\nmultiple lines and ends with an anchor.\n^para-id',
    startLine: 3,
    endLine: 5,
  },
  note: 'Backward walk from anchor to previous blank line; whole paragraph returned.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Plain blockquote block-id. Anchor on the last `>` line; backward walk
 * stops at the first non-`>` line above. Mirrors reference-doc fixture
 * `^ticket-mcpvault-101-example-when-blockquote-plain`.
 *
 * Reference doc: `##### Example When Block-quote Plain`.
 */
export const EXAMPLE_BLOCKQUOTE_PLAIN_BLOCK_ID = {
  markdown:
    `Lead-in paragraph.

> **Example**
>
> Lorem ipsum dolor sit amet, consectetur adipiscing elit.
> ^ticket-mcpvault-101-example-when-blockquote-plain

After.
`,
  wikilink: '[[Doc#^ticket-mcpvault-101-example-when-blockquote-plain]]',
  expected: {
    found: true,
    content:
      '> **Example**\n>\n> Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n> ^ticket-mcpvault-101-example-when-blockquote-plain',
    startLine: 3,
    endLine: 6,
  },
  note: 'Backward walk through consecutive `>` lines until first non-`>` line above.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Callout block-id (`> [!type]`). Same backward semantics as plain
 * blockquote — the callout marker `[!info]` does not alter walk rules.
 * Mirrors reference-doc fixture
 * `^ticket-mcpvault-101-example-when-blockquote-callout`.
 *
 * Reference doc: `##### Example When Block-quote Callout`.
 */
export const EXAMPLE_CALLOUT_BLOCK_ID = {
  markdown:
    `Lead-in paragraph.

> [!info] **Example Callout**
> Lorem ipsum dolor sit amet, consectetur adipiscing elit.
> Vestibulum sed massa id dolor.
> ^ticket-mcpvault-101-example-when-blockquote-callout

After.
`,
  wikilink: '[[Doc#^ticket-mcpvault-101-example-when-blockquote-callout]]',
  expected: {
    found: true,
    content:
      '> [!info] **Example Callout**\n> Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n> Vestibulum sed massa id dolor.\n> ^ticket-mcpvault-101-example-when-blockquote-callout',
    startLine: 3,
    endLine: 6,
  },
  note: 'Same backward semantics as plain blockquote; callout marker is content, not a special boundary.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Fenced code block-id, anchor immediately after closing fence (separated
 * by a blank line — the reference-doc canonical layout). Spec calls for a
 * backward walk to the matching opening fence; the returned block is the
 * fence itself (opening fence through closing fence). The anchor line is a
 * post-block marker, not part of the returned content. Mirrors
 * reference-doc fixture `^ticket-mcpvault-101-example-when-code-fence`.
 *
 * Reference doc: `#### Example When Code Fence And Just Under` and
 * `### Per-Block-Type Expected Behavior` row "Fenced code".
 */
export const EXAMPLE_FENCED_CODE_BLOCK_ID = {
  markdown:
    `Lead-in paragraph.

\`\`\`diff
-this.showLocation(foo, data.geo_id);
+this.showLocation(foo, data.title);
\`\`\`

^ticket-mcpvault-101-example-when-code-fence
`,
  wikilink: '[[Doc#^ticket-mcpvault-101-example-when-code-fence]]',
  expected: {
    found: true,
    content:
      '```diff\n-this.showLocation(foo, data.geo_id);\n+this.showLocation(foo, data.title);\n```',
    startLine: 3,
    endLine: 6,
  },
  note: 'Backward walk to matching opening fence; anchor sits on a separate line after the fence as a marker.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Table block-id, anchor on a line after a markdown table. Spec calls for
 * a backward walk to the first non-`|` line above; the returned block is
 * the table itself.
 *
 * NOTE: This case is NOT in scope for the immediate MCPVAULT-101 fix.
 * Per the reference doc's `### Behavior Notes` section, table-anchor
 * resolution is deferred. This example is included for forward-compat;
 * its `expected` value documents the spec-intent post-fix shape. The
 * reference doc does not currently carry a Scenario-Examples anchor for
 * this case — only the row in `### Per-Block-Type Expected Behavior`.
 *
 * TODO: deferred to a WIKI-POST-FENCE-ANCHOR-equivalent follow-up;
 * expected behavior documented for forward-compat.
 */
export const EXAMPLE_TABLE_BLOCK_ID = {
  markdown:
    `Lead-in paragraph.

| Col A | Col B |
|-------|-------|
| a1    | b1    |
| a2    | b2    |

^table-anchor
`,
  wikilink: '[[Doc#^table-anchor]]',
  expected: {
    found: true,
    content:
      '| Col A | Col B |\n|-------|-------|\n| a1    | b1    |\n| a2    | b2    |',
    startLine: 3,
    endLine: 6,
  },
  note: 'Spec-intent: backward walk to first non-`|` line above. Currently deferred — see reference doc Behavior Notes.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Single-bullet list item with anchor inline at end. The block is just
 * that bullet. Mirrors reference-doc fixture
 * `^ticket-mcpvault-101-example-when-list-bullet-dash`.
 *
 * Reference doc: `##### Example When List Bullet`.
 */
export const EXAMPLE_LIST_BULLET_BLOCK_ID = {
  markdown:
    `Lead-in paragraph.

- Bullet 1
- Bullet 2
  - Bullet 2.1 with anchor ^ticket-mcpvault-101-example-when-list-bullet-dash
`,
  wikilink: '[[Doc#^ticket-mcpvault-101-example-when-list-bullet-dash]]',
  expected: {
    found: true,
    content:
      '  - Bullet 2.1 with anchor ^ticket-mcpvault-101-example-when-list-bullet-dash',
    startLine: 5,
    endLine: 5,
  },
  note: 'Single bullet line; the block is the one item carrying the anchor.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Multi-paragraph bullet item with embedded fenced code, anchor at end of
 * the LAST continuation line. The block is the entire bullet — its
 * marker line, blank-separated continuation paragraphs (indented to the
 * content column), and the embedded fence.
 *
 * Currently `findListStart` (in `scanBlockIds.ts`) over-reaches on
 * continuous lists (returning the whole list) and under-reaches when
 * blank-separated continuation paragraphs interrupt the backward walk
 * (returning only the last paragraph of the bullet). Either way, the
 * spec-intent is the bounded single-bullet block.
 *
 * Mirrors reference-doc fixture
 * `^ticket-mcpvault-101-example-when-bullet-item-multiline`.
 *
 * TODO: WIKI-LIST-SCOPE deferred follow-up.
 */
export const EXAMPLE_LIST_MULTILINE_CONTINUATION_BLOCK_ID = {
  markdown:
    `Lead-in paragraph.

- Bullet A
- Bullet B
  * Bullet B.1 with anchor ^ticket-mcpvault-101-example-when-list-bullet-dash
  * Bullet B.2 multi-paragraph item
    Continuation line aligned to the content column.

    \`\`\`sh
    ps aux # embedded fence inside bullet
    \`\`\`

    Another continuation paragraph.
    Final line of bullet B.2. ^ticket-mcpvault-101-example-when-bullet-item-multiline
`,
  wikilink: '[[Doc#^ticket-mcpvault-101-example-when-bullet-item-multiline]]',
  expected: {
    found: true,
    content:
      '  * Bullet B.2 multi-paragraph item\n    Continuation line aligned to the content column.\n\n    ```sh\n    ps aux # embedded fence inside bullet\n    ```\n\n    Another continuation paragraph.\n    Final line of bullet B.2. ^ticket-mcpvault-101-example-when-bullet-item-multiline',
    startLine: 6,
    endLine: 14,
  },
  note: 'Spec-intent: the one bullet block including continuation lines and embedded fence. Currently deferred — see WIKI-LIST-SCOPE.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Heading-attached block-id — THE MCPVAULT-101 PRIMARY EXAMPLE.
 *
 * `^id` is placed on the same line as a `### Heading text` ATX heading.
 * Spec-intent (post T1+T2): the anchor identifies the *section* under that
 * heading, not just the heading line. The walk is FORWARD until the next
 * same-or-higher heading (or end of document). The output mirrors the
 * heading-text branch's success shape, including the `heading` and
 * `level` fields.
 *
 * Currently FAILS — the existing implementation in `scanBlockIds.ts`
 * treats the heading line as a paragraph and returns just that single
 * line.
 *
 * Note on `expected.heading`: this fixture asserts `'Subsection'` (the
 * heading text WITHOUT the trailing `^heading-attached-id`). Today
 * `scanHeadings` would return the literal heading line and set
 * `text = 'Subsection ^heading-attached-id'` because the trailing-anchor
 * stripping is part of the T1+T2 fix. Implementers should strip the
 * `^id` token from the heading text when scanning, so this fixture's
 * expected value matches Obsidian's own rendered title.
 *
 * MCPVAULT-101 in-scope: T1+T2 fix this case.
 */
export const EXAMPLE_HEADING_ATTACHED_BLOCK_ID = {
  markdown:
    `# Doc Title

## Section One

Some intro.

### Subsection ^heading-attached-id

Subsection body line one.
Subsection body line two.

## Section Two

Section two body.
`,
  wikilink: '[[Doc#^heading-attached-id]]',
  expected: {
    found: true,
    content:
      '### Subsection ^heading-attached-id\n\nSubsection body line one.\nSubsection body line two.\n',
    heading: 'Subsection',
    level: 3,
    startLine: 7,
    endLine: 11,
  },
  note: 'Forward walk under the heading; section terminated by next same-or-higher heading. Output shape mirrors heading-text branch.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Heading-attached block-id — termination by sibling same-level heading.
 * Verifies the forward-walk stops exactly at the next `###` (same level)
 * heading.
 *
 * MCPVAULT-101 in-scope: T1+T2 fix this case.
 */
export const EXAMPLE_HEADING_ATTACHED_BLOCK_ID_TERMINATED_BY_SAME_LEVEL = {
  markdown:
    `# Doc

### First ^attached-same-level

First body.

### Second

Second body.
`,
  wikilink: '[[Doc#^attached-same-level]]',
  expected: {
    found: true,
    content: '### First ^attached-same-level\n\nFirst body.\n',
    heading: 'First',
    level: 3,
    startLine: 3,
    endLine: 6,
  },
  note: 'Forward walk terminated by a sibling same-level heading.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};

/**
 * Heading-attached block-id — termination by parent (higher-level)
 * heading. Verifies the forward-walk stops at any heading whose level is
 * less than or equal to the anchor heading's level.
 *
 * MCPVAULT-101 in-scope: T1+T2 fix this case.
 */
export const EXAMPLE_HEADING_ATTACHED_BLOCK_ID_TERMINATED_BY_HIGHER_LEVEL = {
  markdown:
    `# Doc

### Child ^attached-higher-level

Child body.

## Parent Sibling

Parent body.
`,
  wikilink: '[[Doc#^attached-higher-level]]',
  expected: {
    found: true,
    content: '### Child ^attached-higher-level\n\nChild body.\n',
    heading: 'Child',
    level: 3,
    startLine: 3,
    endLine: 6,
  },
  note: 'Forward walk terminated by a higher-level (parent) heading.',
} as const satisfies {
  markdown: string;
  wikilink: string;
  expected: ExtractionSuccess;
  note: string;
};
