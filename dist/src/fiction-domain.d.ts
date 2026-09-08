export type FictionDomainSelection = 'exclude' | 'only';
export type FictionDomainOptions = {
    fictionDomain: FictionDomainSelection;
};
/** Fiction is a content-routing marker, never an authorization grant. */
export declare function isFictionDomain(frontmatter: Record<string, unknown>): boolean;
/** Roleplay services must opt in explicitly and still enforce normal access. */
export declare function roleplayOnly(): FictionDomainOptions;
//# sourceMappingURL=fiction-domain.d.ts.map