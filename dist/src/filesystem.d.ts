import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import type { ParsedNote, DirectoryListing, NoteWriteParams, DeleteNoteParams, DeleteResult, DeleteNotePreviewParams, DeleteNotePreviewResult, MoveNoteParams, MoveNotePreviewParams, MoveNotePreviewResult, MoveFileParams, MoveResult, BatchReadParams, BatchReadResult, UpdateFrontmatterParams, NoteInfo, TagManagementParams, TagManagementResult, PatchNoteParams, PatchNoteResult, PatchMultipleNotesParams, PatchMultipleNotesResult, VaultStats, NoteHeading, ReadNoteLinesParams, BacklinksResult, OutlinksResult, UnresolvedLinksResult, OrphanNotesResult, DailyNoteResult, ListTasksParams, ListTasksResult, UpdateTaskParams, UpdateTaskResult, QueryNotesParams, QueryNotesResult, QueryNote, AuthorityShelfResult } from './types.js';
import { type DailyDateInput } from './daily.js';
import type { VaultMetadataIndex } from './vault-index.js';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultIoCoordinator } from './vault-io.js';
import { type PackedQueryPage } from './query-page.js';
/** Hard per-note write limit so stdio callers cannot exhaust the vault disk. */
export declare const MAX_NOTE_CONTENT_BYTES: number;
/** Health scans never load arbitrarily large derived views into memory. */
export declare const MAX_DERIVED_VIEW_READ_BYTES: number;
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
    private onNoteChanged?;
    private readonly metadataIndex?;
    private readonly graphIndex?;
    private readonly vaultIo;
    private frontmatterHandler;
    private pathFilter;
    private mutationTails;
    private notifyNoteChanged;
    private revision;
    private withMutationLock;
    /** Lock identity only; never use this folded key for access checks or IO. */
    private mutationLockKey;
    private withMutationLockKey;
    /** Acquire several note locks in one stable order so reciprocal edits cannot deadlock. */
    private withMutationLocks;
    constructor(vaultPath: string, pathFilter?: PathFilter, frontmatterHandler?: FrontmatterHandler, onNoteChanged?: ((path: string, kind: 'upsert' | 'delete') => void | Promise<void>) | undefined, metadataIndex?: VaultMetadataIndex | undefined, graphIndex?: VaultGraphIndex | undefined, vaultIo?: VaultIoCoordinator);
    /**
     * Normalize an incoming path to be vault-relative. Strips leading slashes
     * and the vault path prefix when a caller accidentally passes an absolute path
     * (e.g. "/Users/me/vault/wiki/note.md" instead of "wiki/note.md").
     */
    private normalizePath;
    private resolvePath;
    /**
     * Mutation-only symlink defense. Reads may follow an in-vault symlink for
     * Obsidian compatibility, but writes, deletes, and moves must never use a
     * symlinked target or parent. This closes the practical symlink escape case
     * where a validated path is used as a mutation target.
     */
    private resolveWritablePath;
    readNote(path: string): Promise<ParsedNote>;
    noteExists(path: string): Promise<boolean>;
    private assertExpectedRevision;
    writeNote(params: NoteWriteParams): Promise<void>;
    /**
     * Write one note while holding revision locks for related notes whose state
     * is an invariant of the write. Guards are assertions only: they are never
     * rewritten, but a stale guard aborts before the target changes.
     */
    writeNoteWithRevisionGuards(params: NoteWriteParams, guards: Array<{
        path: string;
        expectedRevision: string;
    }>): Promise<void>;
    private writeDerivedViewFile;
    /**
     * Write an Obsidian Bases definition as a derived, revision-checked view.
     * Derived views are limited to one file directly under a scope-local Views/
     * directory so this cannot become a general-purpose write primitive.
     */
    writeBaseFile(params: {
        path: string;
        content: string;
        expectedRevision: string;
    }): Promise<{
        path: string;
        previousRevision: string;
        revision: string;
    }>;
    /** Write a validated JSON Canvas 1.0 projection as a disposable view. */
    writeCanvasFile(params: {
        path: string;
        content: string;
        expectedRevision: string;
    }): Promise<{
        path: string;
        previousRevision: string;
        revision: string;
    }>;
    /** Read one scope-local Canvas for bounded derived-view maintenance. */
    readCanvasFile(pathInput: string, maxBytes?: number): Promise<{
        path: string;
        revision: string;
        document: unknown;
    }>;
    private writeNoteUnlocked;
    patchNote(params: PatchNoteParams): Promise<PatchNoteResult>;
    private patchNoteUnlocked;
    /** Compute exact hunks without writing so single-note and change-set edits share semantics. */
    private planImprovedPatch;
    /** Apply line-scoped or multi-hunk patches as one all-or-nothing operation. */
    private patchNoteImproved;
    private planFrontmatterMutation;
    /**
     * Preflight and apply a small revision-checked, rollback-backed multi-note
     * transaction. Filesystem writes are not globally atomic, so a failed write
     * is restored from the in-memory originals and reported explicitly.
     */
    patchMultipleNotes(params: PatchMultipleNotesParams, projectPath?: (path: string) => string): Promise<PatchMultipleNotesResult>;
    listDirectory(path?: string): Promise<DirectoryListing>;
    exists(path: string): Promise<boolean>;
    isDirectory(path: string): Promise<boolean>;
    /**
     * Build one visibility-safe move plan. Resolution uses every physical note
     * so an inaccessible same-name target cannot be mistaken for a unique one.
     * Details from inaccessible scopes are collapsed to one boolean barrier.
     */
    private collectMoveReferencePlans;
    previewDeleteNote(params: DeleteNotePreviewParams, canAccessPath?: (path: string) => boolean): Promise<DeleteNotePreviewResult>;
    private moveNoteToVaultTrash;
    deleteNote(params: DeleteNoteParams, canAccessPath?: (path: string) => boolean): Promise<DeleteResult>;
    private deleteNoteUnlocked;
    moveNote(params: MoveNoteParams, canAccessPath?: (path: string) => boolean): Promise<MoveResult>;
    private moveNoteUnlocked;
    moveFile(params: MoveFileParams): Promise<MoveResult>;
    readMultipleNotes(params: BatchReadParams): Promise<BatchReadResult>;
    updateFrontmatter(params: UpdateFrontmatterParams): Promise<void>;
    /**
     * Preview a note move without changing files. Markdown, Properties, and
     * Obsidian links remain authoritative, so this resolves one bounded,
     * explainable rewrite plan. Applying that plan remains explicit and
     * revision-checked through moveNote(updateLinks=true).
     */
    previewMoveNote(params: MoveNotePreviewParams, canAccessPath?: (path: string) => boolean): Promise<MoveNotePreviewResult>;
    private updateFrontmatterUnlocked;
    getNotesInfo(paths: string[]): Promise<NoteInfo[]>;
    manageTags(params: TagManagementParams): Promise<TagManagementResult>;
    private manageTagsUnlocked;
    getVaultPath(): string;
    /**
     * Resolve an Obsidian wiki link name to its vault-relative paths.
     * Recognizes exact paths, filenames, titles, aliases, preferred terms, and
     * stable IDs from notes already visible to the caller.
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
    getBacklinks(path: string, limit?: number, canAccessPath?: (path: string) => boolean, offset?: number, options?: {
        includeSourceRevision?: boolean;
    }): Promise<BacklinksResult>;
    private withGraphRead;
    getOutlinks(path: string, limit?: number, canAccessPath?: (path: string) => boolean, offset?: number): Promise<OutlinksResult>;
    findUnresolvedLinks(limit?: number, canAccessPath?: (path: string) => boolean, offset?: number): Promise<UnresolvedLinksResult>;
    findOrphanNotes(limit?: number, canAccessPath?: (path: string) => boolean, offset?: number): Promise<OrphanNotesResult>;
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
    readNoteLineWindow(params: ReadNoteLinesParams): Promise<{
        content: string;
        startLine: number;
        endLine: number;
        totalLines: number;
    }>;
    readNoteLines(params: ReadNoteLinesParams): Promise<string>;
    getVaultStats(recentCount?: number, canAccessPath?: (path: string) => boolean): Promise<VaultStats>;
    listAllTags(canAccessPath?: (path: string) => boolean): Promise<Array<{
        tag: string;
        count: number;
    }>>;
    private resolvePathPrefix;
    listTasks(params?: ListTasksParams, canAccessPath?: (path: string) => boolean): Promise<ListTasksResult>;
    updateTask(params: UpdateTaskParams): Promise<UpdateTaskResult>;
    private hydrateQueryNote;
    queryNotesBounded(params: QueryNotesParams, maxChars: number, canAccessPath: (path: string) => boolean, canReadNote: (note: QueryNote) => boolean, prettyPrint?: boolean): Promise<PackedQueryPage>;
    queryNotes(params?: QueryNotesParams, canAccessPath?: (path: string) => boolean, canReadNote?: (note: QueryNote) => boolean): Promise<QueryNotesResult>;
    queryAuthorityShelf(params: {
        scheme: string;
        aroundAuthorityId?: string;
        includeUnclassified?: boolean;
        limit?: number;
    }, canAccessPath?: (path: string) => boolean): Promise<AuthorityShelfResult>;
    /** Fresh bypasses indexes; strict preserves storage failures instead of treating them as missing notes. */
    readNoteMetadata(paths: readonly string[], canAccessPath?: (path: string) => boolean, options?: {
        fresh?: boolean;
        strict?: boolean;
    }): Promise<QueryNote[]>;
    /** Count metadata rows without reading note bodies; used by bounded windows. */
    countNotes(params?: QueryNotesParams, canAccessPath?: (path: string) => boolean, predicate?: (note: QueryNote) => boolean): Promise<number>;
}
//# sourceMappingURL=filesystem.d.ts.map