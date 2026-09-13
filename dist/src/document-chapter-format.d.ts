import { type DocumentStructure } from './document-structure.js';
export interface ManagedChapterMetadata {
    documentId: string;
    chapterId: string;
    bundleId: string;
    title: string;
    description: string;
    kind: 'knowledge' | 'manual' | 'tool';
    domain: string;
    useWhen: string;
    avoidWhen: string;
    stage: string;
    project?: string;
    aliases: string[];
    parent: string;
    previous?: string;
    next?: string;
    position: number;
    total: number;
    prerequisites: string[];
    tools: string[];
    counterexamples: string[];
    sourceFamily: string;
    sourceRevision: string;
    ruleVersion: string;
    sourceRanges: {
        startOffset: number;
        endOffset: number;
    }[];
}
/** Physical lines, including metadata and blank lines; a final EOL terminates
 * the last line rather than manufacturing another empty line. */
export declare function chapterFileMetrics(content: string): {
    lines: number;
    chars: number;
    longestLine: number;
};
/** Pure candidate rendering only. The owner adapter must separately verify
 * authorization, immutable backup, meaning, links and staged-bundle visibility.
 * The staged property below is NOT a security or search-exclusion mechanism. */
export declare function renderManagedChapter(source: DocumentStructure, input: ManagedChapterMetadata, body: string): {
    content: string;
    metrics: {
        lines: number;
        chars: number;
        longestLine: number;
    };
    semantic: 'not_assessed';
    authorizesCutover: false;
};
//# sourceMappingURL=document-chapter-format.d.ts.map