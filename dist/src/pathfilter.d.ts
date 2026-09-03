import type { PathFilterConfig } from "./types.js";
export declare class PathFilter {
    private static readonly RESTRICTED_SEGMENTS;
    private ignoredPatterns;
    private allowedExtensions;
    constructor(config?: Partial<PathFilterConfig>);
    private simpleGlobMatch;
    /**
     * Canonicalize a path for restricted-directory matching. On Windows the
     * filesystem strips trailing dots and spaces from each path segment, so
     * ".git." and ".git " both resolve to ".git". Fold those away (and collapse
     * "./" / duplicate separators) before matching the deny-list, otherwise the
     * restriction can be bypassed with an equivalent name.
     */
    private canonicalizeForMatch;
    isAllowed(path: string): boolean;
    isAllowedForListing(path: string): boolean;
    /**
     * Windows treats trailing dots/spaces as equivalent to their trimmed name
     * and treats a colon as an alternate data stream separator.  Reject those
     * spellings before path resolution so a note API cannot address an
     * executable, secret, or arbitrary stream through a note-looking path.
     */
    private hasUnsafePlatformPathSyntax;
    private isIgnoredPath;
    private isFile;
    filterPaths(paths: string[]): string[];
}
//# sourceMappingURL=pathfilter.d.ts.map