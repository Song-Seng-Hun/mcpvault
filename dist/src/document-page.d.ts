import { type Properties, type WorkPage } from './work-model.js';
export declare function boundedHeadingLabel(parts: readonly string[], max?: number): string;
/** Only lightweight rows are collected by callers; descriptors are produced for
 * the requested page. Cursor binding is a source-generation fingerprint. */
export declare function documentPage<T>(rows: readonly T[], project: (row: T) => Properties, context: Properties, signature: string, params: {
    limit?: number;
    maxChars?: number;
    cursor?: string;
}, kind: string): WorkPage;
//# sourceMappingURL=document-page.d.ts.map