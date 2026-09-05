import type { NoteHeading, ReadNoteLinesParams } from './types.js';
/** Pure projection of one already-authorized raw Markdown snapshot. */
export declare function projectNoteOutline(raw: string): NoteHeading[];
/** Raw physical-line window; response serialization applies its character budget. */
export declare function projectNoteLineWindow(raw: string, params: Pick<ReadNoteLinesParams, 'startLine' | 'endLine'>): {
    content: string;
    startLine: number;
    endLine: number;
    totalLines: number;
};
//# sourceMappingURL=note-projections.d.ts.map