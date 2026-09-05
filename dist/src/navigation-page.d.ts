type NavigationKey = 'backlinks' | 'outlinks' | 'unresolved' | 'orphans';
type NavigationPage = {
    offset: number;
    limit: number;
    maxChars: number;
};
export declare const NAVIGATION_READ_GUIDANCE = " Paths and locators remain exact; only context/title previews may shrink (fieldsTruncated). Follow nextAction with expectedSnapshot; changed views reject continuation: restart at offset 0 without that field. reuseOriginalArguments means merge its overrides into this request, keeping authentication local. Fingerprints guard observed results, not atomic Vault snapshots; legacy unguarded offsets remain advisory. paginationLimited marks the offset ceiling; verify source revisions before editing.";
/** Exact locators are never prose. Budget the final public JSON before return. */
export declare function packNavigationPage(key: NavigationKey, endpointId: string, result: Record<string, any>, page: NavigationPage, args: Record<string, any>, toPublicPath?: (path: string) => string): string;
export {};
//# sourceMappingURL=navigation-page.d.ts.map