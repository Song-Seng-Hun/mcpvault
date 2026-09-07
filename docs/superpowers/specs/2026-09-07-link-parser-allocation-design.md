# Link parser allocation and bounded candidate work

User delegates design approval and fork/main publication. No live Vault/config,
server restart, extra client setup, worker pool or GPU runtime change.

## Evidence and approach

`extractLinkOccurrences` materializes `content.split('\n')`; applyLineMask
splits every line into individual UTF-16 code units and joins them even if none
are masked. With a finite output limit the parser still materializes every
valid wikilink/Markdown candidate on the current line before sorting/slicing.
MOC outline/reading-path callers use finite limits, so this is actual bounded
navigation work, not just a hypothetical endpoint.

Keep current grammar, regexes, full literal mask and parsed target helpers.
Replacing the entire parser changes Markdown semantics; worker offload still
copies state. Instead scan line offsets lazily with indexOf, return unmasked
lines directly, and reconstruct masked spans with slices/spaces, not one array
entry per character. A subarray-scoped mask search must stop at the current line
to avoid repeatedly scanning the rest of the document.

For K remaining outputs, keep the first K valid candidates from each of the two
ordered syntaxes (at most 2K) and merge via the existing stable offset sort. No
later candidate of either syntax can enter the first K of their union. Continue
past invalid/anchor-only/external candidates because they do not consume K.
Default infinite extraction still returns all links. Zero/nonpositive/NaN limits
keep the prior empty result; positive fractional limits preserve ceil behavior.

## Invariants

CRLF, UTF-16 offsets (including emoji/lone surrogates), 1-based line numbers,
original raw context clipping, heading carry, aliases, anchors, relative paths,
Markdown decoding and syntax ordering remain unchanged. Full literal masking is
still necessary for multiline code spans, even if output limit is one. Source
text and the mask remain O(input); this is not streaming file I/O or a total
memory ceiling. No authorization or write path changes.

## Verification

RED probes: plain/masked large lines must not split into character arrays;
many-line limited extraction must not split the complete input; candidate row
sort size is <=2K for a mixed dense line (formerly all matches). Verify result
values before operation assertions. Keep fixtures synthetic and modest.

Cover finite limit vs unbounded prefix, both syntaxes, rejected candidates,
multiple lines/headings, CRLF, matching/mismatched fences, multiline code,
escaped openers, Unicode, empty inputs and repeated calls. An isolated script
loads the trusted unchanged baseline parser from commit
84de8c78aba7fc6663f51192815b5c063ce06746 and compares all extractor outputs over
deterministic fixtures against rebuilt dist; no notes or external data execute.
Run focused tests, build, compatibility script, independent review and full
single-worker suite sequentially. Commit generated dist and verify fork push.
