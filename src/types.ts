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
  patches?: Array<{ oldString: string; newString: string; replaceAll?: boolean; startLine?: number; endLine?: number }>;
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
  patches?: Array<{ matchCount: number; startLine?: number; endLine?: number }>;
  preview?: { before: { startLine: number; endLine: number; text: string }; after: { startLine: number; endLine: number; text: string } };
}

export interface NoteChangeSetItem {
  path: string;
  /** Every target must already exist and match this SHA-256 revision. */
  expectedRevision: string;
  /** Ordered exact hunks applied to the complete Markdown file before frontmatter changes. */
  patches?: Array<{ oldString: string; newString: string; replaceAll?: boolean; startLine?: number; endLine?: number }>;
  /** Top-level Obsidian Properties to set or remove after body patches. */
  frontmatter?: {
    set?: Record<string, any>;
    remove?: string[];
  };
}

export interface PatchMultipleNotesParams {
  changes: NoteChangeSetItem[];
  /** Defaults to true. Applying requires the exact fingerprint returned by a dry run. */
  dryRun?: boolean;
  confirmPlanFingerprint?: string;
  previewMaxChars?: number;
  maxChars?: number;
  /** Include requested JSON indentation in response admission before writes. */
  prettyPrint?: boolean;
}

export interface NoteChangeSetResultItem {
  path: string;
  previousRevision: string;
  revision: string;
  wouldChange: boolean;
  patchCount: number;
  matchCount: number;
  frontmatterSet: string[];
  frontmatterRemoved: string[];
  preview?: { before: { startLine: number; endLine: number; text: string }; after: { startLine: number; endLine: number; text: string } };
}

export interface PatchMultipleNotesResult {
  success: boolean;
  dryRun: boolean;
  applied: boolean;
  planFingerprint: string;
  changeCount: number;
  changedCount: number;
  changes: NoteChangeSetResultItem[];
  message: string;
  truncated?: boolean;
}

export interface DeleteNoteParams {
  path: string;
  confirmPath: string;
  trashMode?: 'none' | 'local' | 'system';
  /** Explicitly allow references to become dangling after a reviewed preview. */
  allowDanglingReferences?: boolean;
  /** Current source revision, required when allowing dangling references. */
  expectedRevision?: string;
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

// Search types
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
  /** Expand through explicit same/close/broader/related authority fields. */
  expandAuthority?: boolean;
  /** Optional client-computed embedding for semantic search; avoids server model loading. */
  queryVector?: number[];
}

export interface DeleteNotePreviewParams {
  path: string;
  limit?: number;
}

export interface DeleteNotePreviewResult {
  path: string;
  exists: boolean;
  affectedLinks: BacklinkMatch[];
  affectedProperties: Array<{
    sourcePath: string;
    propertyPath: string;
    value: string;
  }>;
  ambiguousReferences: Array<{
    sourcePath: string;
    value: string;
    candidates: string[];
    line?: number;
    propertyPath?: string;
  }>;
  total: number;
  ambiguousTotal: number;
  /** True when deletion would break an inaccessible scope; no hidden path is disclosed. */
  hiddenReferencesPresent: boolean;
  truncated: boolean;
  message: string;
}

export interface SearchResult {
  p: string;        // path
  t: string;        // title
  ex: string;       // excerpt
  mc: number;       // matchCount
  ln?: number;      // one-based raw Markdown line; 0 means no exact textual anchor
  uri?: string;     // obsidianUri
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
  /** Strongest explicit authority relation declared by the source note. */
  au?: {
    relation: 'authority_id' | 'same_as' | 'close_match' | 'broader' | 'related';
    confidence: 'exact' | 'high' | 'medium' | 'low';
    matched: string;
  };
}

export interface RankCandidate {
  documentId: number;
  title: string;
  firstIndex: number;
  firstTermIndex: number;
  filenameMatch: boolean;
  authorityTermMatch: boolean;
  authorityIdMatch: boolean;
  sameAsMatch: boolean;
  closeMatch: boolean;
  broaderTermMatch: boolean;
  relatedTermMatch: boolean;
  authorityExpansion?: SearchResult['au'];
  retrievalCueMatch: boolean;
  termFreqs: Map<string, number>;
  docLength: number;
  wiki: boolean;
}

// Move types
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
    direction?: 'inbound' | 'outgoing' | 'self';
    replacement?: string;
  }>;
  affectedProperties: Array<{
    sourcePath: string;
    propertyPath: string;
    value: string;
    replacement: string;
    direction: 'inbound' | 'outgoing' | 'self';
  }>;
  ambiguousReferences: Array<{
    sourcePath: string;
    value: string;
    candidates: string[];
    line?: number;
    propertyPath?: string;
  }>;
  ambiguousTotal: number;
  /** True when applying the move would affect an inaccessible scope; no hidden path is disclosed. */
  hiddenReferencesPresent: boolean;
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

// Batch read types
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

// Update frontmatter types
export interface UpdateFrontmatterParams {
  path: string;
  frontmatter: Record<string, any>;
  merge?: boolean;
  expectedRevision?: string;
}

// Note info types
export interface NoteInfo {
  path: string;
  size: number;
  modified: number; // timestamp
  hasFrontmatter: boolean;
  obsidianUri?: string;
}

// Tag management types
export interface TagManagementParams {
  path: string;
  operation: 'add' | 'remove' | 'list';
  tags?: string[];
  expectedRevision?: string;
}

export interface TagManagementResult {
  path: string;
  operation: string;
  tags: string[];
  success: boolean;
  message?: string;
  revision?: string;
  previousRevision?: string;
}

// Outline types
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

// Backlink types
export interface BacklinkMatch {
  path: string;
  /** Opt-in raw-file revision captured when this context was parsed. */
  sourceRevision?: string;
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
  /** Structured claim id that authored a claim-level relation. */
  sourceClaimId?: string;
  /** Exact frontmatter locator when the edge comes from a path-like Property. */
  propertyPath?: string;
}

export interface BacklinksResult {
  target: string;
  /** Opt-in revision of the target used by the link resolver. */
  targetRevision?: string;
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
  /** Structured claim id that authored a claim-level relation. */
  sourceClaimId?: string;
  /** Exact frontmatter locator when the edge comes from a path-like Property. */
  propertyPath?: string;
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

// Task types
export type TaskStatus = 'open' | 'completed' | 'all';

export interface TaskItem {
  path: string;
  /** Exact source revision attached by listTasks; standalone parsing has none. */
  revision?: string;
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
  offset?: number;
  expectedSnapshot?: string;
}

export interface ListTasksResult {
  tasks: TaskItem[];
  total: number;
  truncated: boolean;
  offset: number;
  snapshotFingerprint: string;
}

// Structured frontmatter query types
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

export interface AuthorityShelfEntry {
  path: string;
  frontmatter: Record<string, any>;
  revision: string;
  authorityScheme: string;
  authorityId: string | undefined;
}

export interface AuthorityShelfResult {
  entries: AuthorityShelfEntry[];
  totalVisible: number;
  truncated: boolean;
  anchor: {
    requested?: string;
    matched: boolean;
    insertionIndex: number;
  };
  collisions: Array<{
    authorityId: string;
    paths: string[];
  }>;
}

// Git-backed revision history types
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

// Vault statistics types
export interface VaultStats {
  totalNotes: number;
  totalFolders: number;
  totalSize: number;  // bytes
  recentlyModified: Array<{
    path: string;
    modified: number;  // timestamp
  }>;
}
