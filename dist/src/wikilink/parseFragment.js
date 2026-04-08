/**
 * Parse the fragment portion of an Obsidian wiki link into its typed form.
 *
 * Accepts with or without leading `#`.
 * Detects `^block-id` pattern for block references,
 * otherwise treats the fragment as a heading reference.
 *
 * @param markdownText - The fragment string from a wiki link (e.g., `'#Summary'`, `'^blockId'`, `'Heading Text'`)
 * @returns The parsed fragment with its type discriminant and target identifier
 *
 * @see {@link ParsedFragmentResult}
 *
 * @example
 * parseFragment('#Summary')        // { type: 'heading', target: 'Summary' }
 * parseFragment('Summary')         // { type: 'heading', target: 'Summary' }
 * parseFragment('#^infoBlock')     // { type: 'blockId', target: 'infoBlock' }
 * parseFragment('^infoBlock')      // { type: 'blockId', target: 'infoBlock' }
 */
export const parseFragment = (markdownText) => {
    const trimmed = markdownText.trim();
    const stripped = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (stripped.startsWith('^')) {
        return {
            type: 'blockId',
            target: stripped.slice(1),
        };
    }
    return {
        type: 'heading',
        target: stripped,
    };
};
