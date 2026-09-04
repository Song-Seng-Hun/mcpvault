# Obsidian Literal Link Parity Design

## Problem

MCPVault's shared link extractor already ignores matching backtick and tilde
fences, but it still treats link-looking text inside inline code as a Wiki
edge. Escaped link syntax is also matched. Those false edges propagate into
backlinks, unresolved-link lint, graph health, MOC navigation, impact review,
and derived Canvas projections. The repository's Antigravity report about
code-literal false positives therefore remains only partially resolved.

## Decision

Add one dependency-free literal-range scanner beside the shared link
extractor. It will preserve every source character offset while masking:

- matching inline backtick spans, including spans delimited by runs longer
  than one backtick and spans crossing a line break;
- escaped Markdown link openers and escaped wikilink openers;
- the fenced blocks already handled by the extractor.

The link regular expressions will run against the equal-length masked line,
then slice link text and context from the original line. Real links adjacent
to a code span remain visible and retain their exact line, heading, anchor,
and block locator.

Do not add a general Markdown parser dependency. Top-level indented code is
not included in this batch because distinguishing it from valid nested-list
content without a complete block parser would trade false positives for false
negatives. The tool descriptions and issue resolution must state the exact
supported literal boundaries rather than claiming complete Markdown parsing.

## Error and safety behavior

An unmatched backtick run remains ordinary text, matching Markdown rendering;
it must not hide the rest of the note. Matching delimiters mask only their
closed span and do not cross a detected paragraph-interrupting block boundary.
The scanner is linear in note length and uses one byte per UTF-16 code unit for
the mask plus linear delimiter metadata, all bounded by the note already held
in memory. It never evaluates code or changes note content.

## Workflow closure

After regression and integration tests pass, update the existing Error Book
record with separate resolution and retrospective states. Record that fenced,
inline, and escaped examples are now excluded, while a missing welcome note is
handled intentionally by the constant-cost onboarding-policy fallback. Update
the originating legacy discussion's decision log and status without deleting
or migrating its historical arguments.

## Verification

- A real wikilink and Markdown link next to inline code are still extracted.
- Single-, multi-backtick, and multiline closed code spans are ignored.
- Unmatched backticks do not suppress later real links.
- Escaped wikilink and Markdown-link openers are ignored.
- Backlinks and unresolved-link projections inherit the same behavior.
- Fenced-code behavior and exact line/heading/anchor locators do not regress.
- Documentation describes the supported parity precisely.
- Targeted tests, build, full tests, and diff hygiene pass before delivery.
