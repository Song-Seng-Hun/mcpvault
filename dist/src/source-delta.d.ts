export type SourceDeltaGranularity = 'line_hunks' | 'enclosing_range';
export interface SourceDeltaSide {
    startLine: number;
    endLine: number;
    text: string;
    truncated: boolean;
}
export interface SourceDeltaHunk {
    old: SourceDeltaSide;
    new: SourceDeltaSide;
}
export interface SourceDelta {
    changed: boolean;
    granularity: SourceDeltaGranularity;
    truncated: boolean;
    hunks: SourceDeltaHunk[];
}
interface Options {
    maxChars?: number;
    maxHunks?: number;
}
export declare function compareSourceBodies(before: string, after: string, options?: Options): SourceDelta;
export {};
//# sourceMappingURL=source-delta.d.ts.map