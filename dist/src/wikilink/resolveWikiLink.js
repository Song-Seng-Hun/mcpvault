import { extractFragment } from './extractFragment.js';
/**
 * Parse an Obsidian wiki link string into its components.
 *
 * Handles all wiki link forms:
 * - `[[Document Name]]`
 * - `[[Document Name#Heading]]`
 * - `[[Document Name#^block-id]]`
 * - `[[Document Name|Display Text]]`
 * - `[[Document Name#Heading|Display Text]]`
 * - `[[Document Name\|Display]]` — table-authored escape; `\|` unescapes to `|`
 * - Bare names without brackets (backslashes preserved as-is)
 *
 * Throws on malformed input: if the parsed `document` or `fragment` still
 * contains a literal `\` after processing, the input is rejected rather than
 * heuristically interpreted.
 *
 * @param wikiLinkText - The raw wiki link string, with or without brackets
 * @returns The parsed basename and optional fragment
 * @throws Error when parsed components contain an unexpected backslash
 *
 * @see {@link ParsedWikiLink}
 */
export const parseWikiLink = (wikiLinkText) => {
    let text = wikiLinkText.trim();
    const wasBracketed = text.startsWith('[[');
    if (wasBracketed) {
        text = text.slice(2);
    }
    if (text.endsWith(']]')) {
        text = text.slice(0, -2);
    }
    // Inside [[ ]] only: unescape Obsidian's table-authoring artifact `\|` → `|`.
    // Pipe is a reserved grammar character, so `\|` is unambiguous there.
    if (wasBracketed) {
        text = text.replace(/\\\|/g, '|');
    }
    // Strip |display text if present
    const pipeIndex = text.indexOf('|');
    if (pipeIndex !== -1) {
        text = text.slice(0, pipeIndex);
    }
    let document;
    let fragment;
    const hashIndex = text.indexOf('#');
    if (hashIndex !== -1) {
        document = text.slice(0, hashIndex).trim();
        fragment = text.slice(hashIndex + 1).trim() || undefined;
    }
    else {
        document = text.trim();
        fragment = undefined;
    }
    if (document.includes('\\') || (fragment !== undefined && fragment.includes('\\'))) {
        throw new Error(`Invalid wiki-link syntax: unexpected backslash in [[${wikiLinkText}]]. Only \\| inside [[ ]] is a recognized escape.`);
    }
    return { document, fragment };
};
/**
 * Resolve a wiki link against already-loaded markdown content.
 *
 * This is the core resolution function — pure string processing,
 * no filesystem I/O, no runtime dependencies. The caller is responsible
 * for loading the document content (via whatever filesystem is available).
 *
 * When no fragment is specified, returns the full content.
 * When a fragment is specified, delegates to extractFragment.
 *
 * @param markdownContent - The full document content (without frontmatter)
 * @param fragment - The fragment to extract, or undefined for full content
 * @returns The resolution result — full content or fragment extraction
 *
 * @see {@link WikiLinkResolution}
 * @see {@link extractFragment}
 */
export const resolveWikiLink = (markdownContent, fragment) => {
    if (!fragment) {
        return {
            type: 'full',
            content: markdownContent,
        };
    }
    return {
        type: 'fragment',
        extraction: extractFragment(markdownContent, fragment),
    };
};
