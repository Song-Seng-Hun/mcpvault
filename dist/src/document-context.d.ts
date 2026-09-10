import type { SelectContextPassagesParams, ContextPassageSelection } from './context-passages.js';
export interface ContextSourceRange {
    role: string;
    startLine: number;
    endLine: number;
    /** Offsets relative to the provided content; never mislabeled as full-note offsets. */
    contentStartOffset: number;
    contentEndOffset: number;
    textStartOffset: number;
    textEndOffset: number;
}
/** Common AST + range resolver for optional context projections. Exact source
 * spans map disjoint text without repeating its body in metadata. */
export declare function selectStructuredContextPassages(params: SelectContextPassagesParams): ContextPassageSelection;
//# sourceMappingURL=document-context.d.ts.map