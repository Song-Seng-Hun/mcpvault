export interface NoteReferenceDescriptor {
    path: string;
    /** Additional public or virtual path spellings that should return path. */
    qualifiedPaths?: unknown;
    title?: unknown;
    aliases?: unknown;
    preferredTerm?: unknown;
    stableId?: unknown;
}
export interface NoteReferenceIndex {
    paths: string[];
    qualified: Map<string, Set<string>>;
    terms: Map<string, Set<string>>;
}
export interface ResolveNoteReferenceOptions {
    sourcePath?: string;
    syntax?: 'markdown';
    preferRelative?: boolean;
    canReference?: (sourcePath: string, targetPath: string) => boolean;
}
/** A local Markdown destination names a path, never an alias or basename. */
export declare function markdownNotePath(target: string, sourcePath: string): string | undefined;
export declare function normalizeNoteReferencePath(value: string): string;
export declare function normalizeNoteReferenceTerm(value: unknown): string;
export declare function noteReferenceDocument(value: string): string;
export declare function noteReferenceTermKeys(value: unknown): string[];
/** Build a request-local identity resolver from notes already filtered for visibility. */
export declare function buildNoteReferenceIndex(notes: Iterable<NoteReferenceDescriptor>): NoteReferenceIndex;
/**
 * Resolve one visible Obsidian-style document reference. Exact paths win over
 * identity terms; ambiguous terms stay ambiguous. The index must contain only
 * notes visible to the caller, and an optional edge predicate can narrow it
 * further without ever broadening visibility.
 */
export declare function resolveNoteReference(document: string, index: NoteReferenceIndex, options?: ResolveNoteReferenceOptions): string[];
//# sourceMappingURL=note-reference.d.ts.map