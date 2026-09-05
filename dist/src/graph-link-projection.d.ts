import type { OutlinkMatch } from './types.js';
type SourceEntry = {
    path: string;
    links: readonly OutlinkMatch[];
};
/** One resolver/permission view only. Neither shared graph entries nor caller data are mutated. */
export declare function createGraphLinkProjector(invisible: (target: string, source: string, link: string) => boolean): <T extends {
    context: string;
    link: string;
    line: number;
    heading?: string;
}>(entry: SourceEntry, link: T) => T;
export {};
//# sourceMappingURL=graph-link-projection.d.ts.map