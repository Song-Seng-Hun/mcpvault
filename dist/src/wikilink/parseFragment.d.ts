import type { ParsedFragmentResult } from './types.js';
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
export declare const parseFragment: (markdownText: string) => ParsedFragmentResult;
//# sourceMappingURL=parseFragment.d.ts.map