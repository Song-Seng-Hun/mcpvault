/** Display only. The caller supplies currently accessible, verified dictionary rows.
 * This helper neither searches private names nor grants access or evidence weight. */
export interface ScopedName {
    entityId: string;
    project: string;
    version: string;
    language: string;
    original: string;
    english?: string;
    englishVerified: boolean;
}
export interface NameBasis {
    entityId: string;
    project: string;
    version: string;
    language: string;
}
type NameResult = {
    status: 'resolved';
    text: string;
} | {
    status: 'ambiguous' | 'unavailable';
    text?: never;
};
export declare function displayScopedName(names: readonly ScopedName[], basis: NameBasis, mode?: 'en' | 'ko-ui'): NameResult;
export {};
//# sourceMappingURL=expression-names.d.ts.map