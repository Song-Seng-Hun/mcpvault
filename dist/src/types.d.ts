export interface ParsedNoteContent {
    frontmatter: Record<string, any>;
    content: string;
    originalContent: string;
    matter?: string;
}
export interface ParsedNote extends ParsedNoteContent {
    /** SHA-256 of originalContent, used to reject stale concurrent edits. */
    revision: string;
}
export interface NoteWriteParams {
    path: string;
    content: string;
    frontmatter?: Record<string, any>;
    mode?: 'overwrite' | 'append' | 'prepend';
    /** Expected SHA-256 revision, or "missing" to require a new note. */
    expectedRevision?: string;
}
export interface PatchNoteParams {
    path: string;
    /** One hunk. Omit when patches contains one or more hunks. */
    oldString?: string;
    newString?: string;
    replaceAll?: boolean;
    /** Restrict the hunk match to this inclusive 1-indexed line range. */
    startLine?: number;
    endLine?: number;
    /** Apply several exact hunks sequentially as one locked operation. */
    patches?: Array<{
        oldString: string;
        newString: string;
        replaceAll?: boolean;
        startLine?: number;
        endLine?: number;
    }>;
    /** Inspect the proposed result without writing it. */
    dryRun?: boolean;
    previewMaxChars?: number;
    expectedRevision?: string;
}
export interface PatchNoteResult {
    success: boolean;
    path: string;
    message: string;
    matchCount?: number;
    revision?: string;
    previousRevision?: string;
    dryRun?: boolean;
    wouldChange?: boolean;
    patches?: Array<{
        matchCount: number;
        startLine?: number;
        endLine?: number;
    }>;
    preview?: {
        before: {
            startLine: number;
            endLine: number;
            text: string;
        };
        after: {
            startLine: number;
            endLine: number;
            text: string;
        };
    };
}
export interface DeleteNoteParams {
    path: string;
    confirmPath: string;
    trashMode?: 'none' | 'local' | 'system';
}
export interface DeleteResult {
    success: boolean;
    path: string;
    message: string;
}
export interface DirectoryListing {
    files: string[];
    directories: string[];
}
export interface FrontmatterValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}
export interface PathFilterConfig {
    ignoredPatterns: string[];
    allowedExtensions: string[];
}
export interface SearchParams {
    query: string;
    limit?: number;
    /** Maximum compact JSON characters returned by the search payload. */
    maxChars?: number;
    searchContent?: boolean;
    searchFrontmatter?: boolean;
    caseSensitive?: boolean;
    /** Restrict the search to a vault subtree (directory prefix, e.g. "Projects/2026"). */
    pathPrefix?: string;
    /** Skip files under any of these subtrees (directory prefixes). */
    excludePaths?: string[];
    /** Add bounded semantic/vector matches to the lexical search results. */
    semantic?: boolean;
    /** Include the source revision so a later bounded read can validate freshness. */
    includeRevisions?: boolean;
    /** Expand exact terms through bounded broader/related authority fields. */
    expandAuthority?: boolean;
    /** Optional client-computed embedding for semantic search; avoids server model loading. */
    queryVector?: number[];
}
export interface SearchResult {
    p: string;
    t: string;
    ex: string;
    mc: number;
    ln?: number;
    uri?: string;
    /** Present only for LLM Wiki notes so clients can explain the priority. */
    wk?: true;
    /** Present when this result was found or reinforced by the semantic index. */
    vs?: true;
    /** Compact explanation of why the result was returned. */
    why?: string[];
    /** Bounded retrieval cues when the query matched a note's use situation. */
    rc?: string[];
    /** Compact use condition when the query matched a retrieval cue. */
    uw?: string;
    /** Freshness of the derived result relative to the Markdown source. */
    fresh?: 'current' | 'verified';
    /** Bounded, agent-facing next step for opening or validating the result. */
    next?: 'read_projection' | 'read_section' | 'verify_evidence' | 'inspect_neighbors';
    /** SHA-256 of the source note, included only when requested by the client. */
    rv?: string;
}
export interface RankCandidate {
    documentId: number;
    title: string;
    firstIndex: number;
    firstTermIndex: number;
    filenameMatch: boolean;
    authorityMatch: boolean;
    broaderTermMatch: boolean;
    relatedTermMatch: boolean;
    retrievalCueMatch: boolean;
    termFreqs: Map<string, number>;
    docLength: number;
    wiki: boolean;
}
export interface MoveNoteParams {
    oldPath: string;
    newPath: string;
    overwrite?: boolean;
    /** Rewrite visible inbound Obsidian/Markdown links after previewing the impact. */
    updateLinks?: boolean;
    /** Required with updateLinks so the source cannot move after it changed. */
    expectedRevision?: string;
}
export interface MoveNotePreviewParams {
    oldPath: string;
    newPath: string;
    limit?: number;
}
export interface MoveNotePreviewResult {
    oldPath: string;
    newPath: string;
    targetExists: boolean;
    collision: boolean;
    affectedLinks: Array<{
        sourcePath: string;
        line: number;
        link: string;
        context: string;
        heading?: string;
        targetHeading?: string;
        targetBlockId?: string;
    }>;
    total: number;
    truncated: boolean;
    message: string;
}
export interface MoveFileParams {
    oldPath: string;
    newPath: string;
    confirmOldPath: string;
    confirmNewPath: string;
    overwrite?: boolean;
}
export interface MoveResult {
    success: boolean;
    oldPath: string;
    newPath: string;
    message: string;
}
export interface BatchReadParams {
    paths: string[];
    includeContent?: boolean;
    includeFrontmatter?: boolean;
    /** Previously returned revisions keyed by the same paths; unchanged notes are not reopened. */
    knownRevisions?: Record<string, string>;
}
export interface BatchReadResult {
    successful: Array<{
        path: string;
        frontmatter?: Record<string, any>;
        content?: string;
        obsidianUri?: string;
        revision?: string;
        unchanged?: boolean;
    }>;
    failed: Array<{
        path: string;
        error: string;
    }>;
}
export interface UpdateFrontmatterParams {
    path: string;
    frontmatter: Record<string, any>;
    merge?: boolean;
    expectedRevision?: string;
}
export interface NoteInfo {
    path: string;
    size: number;
    modified: number;
    hasFrontmatter: boolean;
    obsidianUri?: string;
}
export interface TagManagementParams {
    path: string;
    operation: 'add' | 'remove' | 'list';
    tags?: string[];
}
export interface TagManagementResult {
    path: string;
    operation: string;
    tags: string[];
    success: boolean;
    message?: string;
}
export interface NoteHeading {
    level: number;
    text: string;
    line: number;
}
export interface ReadNoteLinesParams {
    path: string;
    startLine: number;
    endLine: number;
}
export interface BacklinkMatch {
    path: string;
    line: number;
    link: string;
    context: string;
    /** Nearest preceding Markdown heading, when the link is inside a section. */
    heading?: string;
    /** Explicit heading targeted by an Obsidian/Markdown link, without '#'. */
    targetHeading?: string;
    /** Explicit block ID targeted by an Obsidian link, without '^'. */
    targetBlockId?: string;
    /** Typed frontmatter relation such as supports or contradicts. */
    relation?: string;
}
export interface BacklinksResult {
    target: string;
    backlinks: BacklinkMatch[];
    total: number;
    truncated: boolean;
}
export interface OutlinkMatch {
    target: string;
    line: number;
    link: string;
    context: string;
    /** Nearest preceding Markdown heading, when the link is inside a section. */
    heading?: string;
    /** Explicit heading targeted by an Obsidian/Markdown link, without '#'. */
    targetHeading?: string;
    /** Explicit block ID targeted by an Obsidian link, without '^'. */
    targetBlockId?: string;
    /** Typed frontmatter relation such as supports or contradicts. */
    relation?: string;
}
export interface OutlinksResult {
    source: string;
    outlinks: OutlinkMatch[];
    total: number;
    truncated: boolean;
}
export interface UnresolvedLinkMatch extends OutlinkMatch {
    path: string;
}
export interface UnresolvedLinksResult {
    unresolved: UnresolvedLinkMatch[];
    total: number;
    truncated: boolean;
}
export interface OrphanNote {
    path: string;
    incomingLinks: number;
}
export interface OrphanNotesResult {
    orphans: OrphanNote[];
    total: number;
    truncated: boolean;
}
export interface DailyNoteResult {
    success: boolean;
    action: 'get' | 'create' | 'append';
    date: string;
    path: string;
    created?: boolean;
    frontmatter?: Record<string, any>;
    content?: string;
    message?: string;
}
export type TaskStatus = 'open' | 'completed' | 'all';
export interface TaskItem {
    path: string;
    line: number;
    text: string;
    status: 'open' | 'completed';
    /** Content-derived identity; remains usable when surrounding lines move. */
    taskId: string;
}
export interface UpdateTaskParams {
    path: string;
    /** Preferred identity from list_tasks. */
    taskId?: string;
    /** Backward-compatible fallback locator. */
    line?: number;
    status: 'open' | 'completed';
    expectedRevision: string;
}
export interface UpdateTaskResult {
    success: boolean;
    path: string;
    line: number;
    status: 'open' | 'completed';
    taskId?: string;
    previousStatus?: 'open' | 'completed';
    previousRevision?: string;
    revision?: string;
    message: string;
}
export interface ListTasksParams {
    status?: TaskStatus;
    pathPrefix?: string;
    limit?: number;
}
export interface ListTasksResult {
    tasks: TaskItem[];
    total: number;
    truncated: boolean;
}
export interface QueryNotesParams {
    filters?: Record<string, unknown>;
    pathPrefix?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    /** Internal pagination offset; MCP callers should prefer bounded cursors. */
    offset?: number;
    /** Internal keyset cursor. Use the last returned sort value and path. */
    after?: QueryNotesCursor;
    includeContent?: boolean;
    /** Skip the exact total count when only page data is needed. */
    includeTotal?: boolean;
}
export interface QueryNotesCursor {
    path: string;
    value?: string | number | boolean | null;
    missing?: boolean;
}
export interface QueryNote {
    path: string;
    frontmatter: Record<string, any>;
    /** Current content revision when the metadata source can provide it. */
    revision?: string;
    content?: string;
}
export interface QueryNotesResult {
    notes: QueryNote[];
    total: number;
    truncated: boolean;
    nextCursor?: QueryNotesCursor;
    /** False only when includeTotal=false; total is then -1. */
    totalKnown?: boolean;
}
export interface RevisionChange {
    status: string;
    path: string;
    previousPath?: string;
}
export interface RevisionStatus {
    enabled: boolean;
    repoRoot?: string;
    branch?: string;
    head?: string;
    pending: RevisionChange[];
    message?: string;
}
export interface RevisionEntry {
    revision: string;
    authorName: string;
    authorEmail: string;
    timestamp: string;
    reason: string;
}
export interface CommitChangesResult {
    success: boolean;
    committed: boolean;
    revision?: string;
    paths: string[];
    message: string;
}
export interface InitializeRevisionResult {
    success: boolean;
    initialized: boolean;
    message: string;
}
export interface RevisionDiffResult {
    path: string;
    fromRevision: string;
    toRevision: string;
    diff: string;
    truncated: boolean;
}
export interface VaultStats {
    totalNotes: number;
    totalFolders: number;
    totalSize: number;
    recentlyModified: Array<{
        path: string;
        modified: number;
    }>;
}
//# sourceMappingURL=types.d.ts.map