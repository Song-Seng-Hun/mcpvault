export interface ContextPassage {
    text: string;
    startLine: number;
    endLine: number;
    headingPath: string[];
    truncated: boolean;
}
export interface ContextPassageSelection {
    passages: ContextPassage[];
    truncated: boolean;
}
export interface SelectContextPassagesParams {
    content: string;
    query: string;
    maxChars: number;
    maxPassages?: number;
    startLine?: number;
    preferredLine?: number;
}
/**
 * Selects exact, independently readable Markdown source units for a caller's
 * bounded context packet. It never reads files or changes source text.
 */
export declare function selectContextPassages(params: SelectContextPassagesParams): ContextPassageSelection;
//# sourceMappingURL=context-passages.d.ts.map