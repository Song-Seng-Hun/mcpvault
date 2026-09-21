export declare function noteReadMaxChars(requestedMaxChars: unknown): number;
/** Page only the requested string, never a body/summary fallback. */
export declare function boundedPropertyReadResult(path: string, property: string, value: string, revision: string, offset: number, maxChars: number, prettyPrint: boolean): {
    content: {
        type: 'text';
        text: string;
    }[];
} | {
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
};
export declare function boundedNoteReadResult(path: string, note: {
    frontmatter: Record<string, unknown>;
    content: string;
    originalContent: string;
    revision: string;
}, requestedMaxChars: unknown, prettyPrint?: boolean): {
    content: {
        type: 'text';
        text: string;
    }[];
} | {
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
};
export declare function navigationPageArgs(args: Record<string, any>): {
    offset: number;
    limit: number;
    maxChars: number;
};
export declare function boundedNavigationResult(key: 'backlinks' | 'outlinks' | 'unresolved' | 'orphans', endpointId: string, result: Record<string, any>, page: {
    offset: number;
    limit: number;
    maxChars: number;
}, args: Record<string, any>, toPublicPath: (path: string) => string): {
    content: {
        type: 'text';
        text: string;
    }[];
};
export declare function boundedDirectoryResult(path: string, directories: string[], files: string[], args: Record<string, any>): {
    content: {
        type: 'text';
        text: string;
    }[];
};
/** Presentation-only fallback: retain the checked source identity and a usable
 * raw-range recovery rather than letting generic compaction erase provenance. */
export declare function boundedWikiProjectionResult(value: Record<string, any>, args: Record<string, any>): {
    content: {
        type: 'text';
        text: string;
    }[];
} | {
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
};
export declare function noteReadBudgetError(requiredMaxChars: number, revision?: string): {
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
};
export declare function noteContinuationConflict(path: string, revision: string, args: Record<string, any>, property?: string): {
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
} | undefined;
export declare function boundedOutlineResult(path: string, revision: string, headings: Array<{
    level: number;
    text: string;
    line: number;
}>, args: Record<string, any>): {
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
} | {
    content: {
        type: 'text';
        text: string;
    }[];
};
export declare function boundedLineWindowResult(path: string, revision: string, window: {
    content: string;
    startLine: number;
    endLine: number;
    totalLines: number;
}, args: Record<string, any>): {
    isError: boolean;
    content: {
        type: 'text';
        text: string;
    }[];
} | {
    content: {
        type: 'text';
        text: string;
    }[];
};
//# sourceMappingURL=mcp-note-response.d.ts.map