export type FictionDomainSelection = 'exclude' | 'only';
export type FictionDomainOptions = {
    fictionDomain: FictionDomainSelection;
};
/** Fiction is a content-routing marker, never an authorization grant. */
export declare function isFictionDomain(frontmatter: Record<string, unknown>, path?: string): boolean;
/** Index preparation uses the same data-only Markdown parser as current reads,
 * including BOM and JSON Properties. Classification is never an ACL. */
export declare function isFictionMarkdown(raw: string, path: string): boolean;
/** Roleplay services must opt in explicitly and still enforce normal access. */
export declare function roleplayOnly(): FictionDomainOptions;
//# sourceMappingURL=fiction-domain.d.ts.map