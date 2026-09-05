type NavigationKey = 'backlinks' | 'outlinks' | 'unresolved' | 'orphans';
type NavigationPage = {
    offset: number;
    limit: number;
    maxChars: number;
};
export declare const NAVIGATION_READ_GUIDANCE = " Paths and locators remain exact; only context/title previews may shrink (fieldsTruncated). Follow nextAction; reuseOriginalArguments means merge its overrides into this request, keeping authentication local. Offsets are advisory across edits, not snapshot-pinned. paginationLimited marks the offset ceiling; verify the source revision before editing.";
/** Exact locators are never prose. Budget the final public JSON before return. */
export declare function packNavigationPage(key: NavigationKey, endpointId: string, result: Record<string, any>, page: NavigationPage, args: Record<string, any>, toPublicPath?: (path: string) => string): string;
export {};
//# sourceMappingURL=navigation-page.d.ts.map