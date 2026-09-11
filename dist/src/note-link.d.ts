import type { FileSystemService } from './filesystem.js';
export interface NoteLinkParams {
    document: string;
    path?: string;
    sourcePath?: string;
    expectedRevision?: string;
    maxChars?: number;
    prettyPrint?: boolean;
}
/** Read-only navigation. Metadata discovers; fresh source guards authorize the
 * bounded candidate list and exact body-relative locator, never a first guess.
 */
export declare class NoteLinkService {
    private readonly fs;
    private readonly admitted;
    private readonly publicPath;
    constructor(fs: FileSystemService, admitted?: (path: string) => boolean, publicPath?: (path: string) => string);
    resolve(params: NoteLinkParams): Promise<Record<string, any>>;
    legacy(params: NoteLinkParams): Promise<Record<string, any>>;
    private read;
}
//# sourceMappingURL=note-link.d.ts.map