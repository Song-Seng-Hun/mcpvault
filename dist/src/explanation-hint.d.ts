import type { FileSystemService } from './filesystem.js';
/** Keep the original response and guards intact; an optional link is the first
 * thing omitted at the response ceiling. No draft text is ever requested. */
export declare function attachExplanationHint(params: {
    result: Record<string, any>;
    target: {
        path: string;
        revision: string;
    };
    guards: Array<{
        path: string;
        revision: string;
    }>;
    fs: FileSystemService;
    admitted: (path: string) => boolean;
    maxChars: number;
    prettyPrint?: boolean;
    approvedAction: () => Promise<unknown>;
}): Promise<Record<string, any>>;
//# sourceMappingURL=explanation-hint.d.ts.map