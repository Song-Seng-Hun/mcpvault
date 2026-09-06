import type { NoteHeading, ReadNoteLinesParams } from './types.js';
/** Same matching-fence state used by physical outlines and paragraph reads. */
export declare function hasUnclosedNoteFence(raw: string): boolean;
/** Authoring-structure evidence outside Properties, fenced examples and comments. */
export declare function noteSectionHasContent(raw: string, names: readonly string[]): boolean;
/** Pure projection of one already-authorized raw Markdown snapshot. */
export declare function projectNoteOutline(raw: string): NoteHeading[];
/** Count every visible heading, retaining only the requested leading locators. */
export declare function projectNoteHeadingSummary(raw: string, limit?: number): {
    headings: NoteHeading[];
    headingCount: number;
    headingChars: number;
};
/** Prose paragraphs with physical locators; never join across headings or fences. */
export declare function projectNoteParagraphs(raw: string): Generator<{
    text: string;
    startLine: number;
    endLine: number;
}>;
/** Retain only requested normalized names/paths, not a complete outline. */
export declare function projectNoteHeadingPresence(raw: string, requested: ReadonlySet<string>): Set<string>;
/** Exact terminal block anchors, not ID prefixes, mentions or code examples. */
export declare function projectNoteBlockPresence(raw: string, requested: ReadonlySet<string>): Set<string>;
/** Exact terminal block anchors, not ID prefixes, mentions or code examples. */
export declare function projectNoteBlockLines(raw: string, blockId: string): number[];
/** Prefer an exact heading; a partial match is useful only when unambiguous. */
export declare function selectNoteHeading(headings: NoteHeading[], requested: string): NoteHeading;
/** Raw physical-line window; response serialization applies its character budget. */
export declare function projectNoteLineWindow(raw: string, params: Pick<ReadNoteLinesParams, 'startLine' | 'endLine'>): {
    content: string;
    startLine: number;
    endLine: number;
    totalLines: number;
};
//# sourceMappingURL=note-projections.d.ts.map