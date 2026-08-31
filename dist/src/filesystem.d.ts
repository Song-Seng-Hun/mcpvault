import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import type { ParsedNote, DirectoryListing, NoteWriteParams, DeleteNoteParams, DeleteResult, MoveNoteParams, MoveFileParams, MoveResult, BatchReadParams, BatchReadResult, UpdateFrontmatterParams, NoteInfo, TagManagementParams, TagManagementResult, PatchNoteParams, PatchNoteResult, VaultStats, NoteHeading, ReadNoteLinesParams, BacklinksResult, OutlinksResult, UnresolvedLinksResult, OrphanNotesResult, DailyNoteResult, ListTasksParams, ListTasksResult, QueryNotesParams, QueryNotesResult } from './types.js';
import { type DailyDateInput } from './daily.js';
/**
 * Map a filesystem write failure to a clear, accurate Error.
 *
 * Classifies by the Node error `code`, NOT by message substring. The old
 * substring matching (`message.includes('space')`) mislabeled any error whose
 * message merely contained "space" as a disk-full error, producing false
 * "No space left on device" reports (#109). Errors we threw ourselves with a
 * meaningful message (no `code`) pass through unchanged.
 */
export declare function classifyWriteError(error: unknown, path: string): Error;
export declare class FileSystemService {
    private vaultPath;
    private frontmatterHandler;
    private pathFilter;
    private mutationTails;
    private revision;
    private withMutationLock;
    constructor(vaultPath: string, pathFilter?: PathFilter, frontmatterHandler?: FrontmatterHandler);
    /**
     * Normalize an incoming path to be vault-relative. Strips leading slashes
     * and the vault path prefix when a caller accidentally passes an absolute path
     * (e.g. "/Users/me/vault/wiki/note.md" instead of "wiki/note.md").
     */
    private normalizePath;
    private resolvePath;
    readNote(path: string): Promise<ParsedNote>;
    noteExists(path: string): Promise<boolean>;
    private assertExpectedRevision;
    writeNote(params: NoteWriteParams): Promise<void>;
    private writeNoteUnlocked;
    patchNote(params: PatchNoteParams): Promise<PatchNoteResult>;
    private patchNoteUnlocked;
    listDirectory(path?: string): Promise<DirectoryListing>;
    exists(path: string): Promise<boolean>;
    isDirectory(path: string): Promise<boolean>;
    deleteNote(params: DeleteNoteParams): Promise<DeleteResult>;
    moveNote(params: MoveNoteParams): Promise<MoveResult>;
    moveFile(params: MoveFileParams): Promise<MoveResult>;
    readMultipleNotes(params: BatchReadParams): Promise<BatchReadResult>;
    updateFrontmatter(params: UpdateFrontmatterParams): Promise<void>;
    private updateFrontmatterUnlocked;
    getNotesInfo(paths: string[]): Promise<NoteInfo[]>;
    manageTags(params: TagManagementParams): Promise<TagManagementResult>;
    getVaultPath(): string;
    /**
     * Resolve an Obsidian wiki link name to its vault-relative paths.
     * Scans the vault for exact filename matches (name + .md).
     *
     * A name containing `/` is path-qualified (Obsidian emits these when a
     * basename is ambiguous, e.g. [[folder/Note]]): it must match the full
     * vault-relative path instead of just the basename.
     *
     * Returns all matches sorted root-first (by path depth ascending), with
     * alphabetical tiebreak at equal depth. Empty array on zero matches.
     * The caller decides how to handle zero/single/multi — this function does
     * not throw on lookup outcomes.
     *
     * Throws only on caller misuse (empty name).
     */
    findPathForWikiLink(wikiLinkName: string, canAccessPath?: (path: string) => boolean): Promise<string[]>;
    getBacklinks(path: string, limit?: number, canAccessPath?: (path: string) => boolean): Promise<BacklinksResult>;
    getOutlinks(path: string, limit?: number): Promise<OutlinksResult>;
    findUnresolvedLinks(limit?: number, canAccessPath?: (path: string) => boolean): Promise<UnresolvedLinksResult>;
    findOrphanNotes(limit?: number, canAccessPath?: (path: string) => boolean): Promise<OrphanNotesResult>;
    private isNotePath;
    getDailyNote(dateInput?: DailyDateInput, folder?: string): Promise<DailyNoteResult>;
    writeDailyNote(params: {
        action: 'create' | 'append';
        date?: DailyDateInput;
        folder?: string;
        content?: string;
        frontmatter?: Record<string, any>;
    }): Promise<DailyNoteResult>;
    private collectVaultFiles;
    getNoteOutline(path: string): Promise<NoteHeading[]>;
    readNoteLines(params: ReadNoteLinesParams): Promise<string>;
    getVaultStats(recentCount?: number, canAccessPath?: (path: string) => boolean): Promise<VaultStats>;
    listAllTags(canAccessPath?: (path: string) => boolean): Promise<Array<{
        tag: string;
        count: number;
    }>>;
    private resolvePathPrefix;
    listTasks(params?: ListTasksParams, canAccessPath?: (path: string) => boolean): Promise<ListTasksResult>;
    queryNotes(params?: QueryNotesParams, canAccessPath?: (path: string) => boolean): Promise<QueryNotesResult>;
}
//# sourceMappingURL=filesystem.d.ts.map