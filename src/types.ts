export interface ParsedNote {
  frontmatter: Record<string, any>;
  content: string;
  originalContent: string;
  matter?: string;
}

export interface NoteWriteParams {
  path: string;
  content: string;
  frontmatter?: Record<string, any>;
  mode?: 'overwrite' | 'append' | 'prepend';
}

export interface PatchNoteParams {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface PatchNoteResult {
  success: boolean;
  path: string;
  message: string;
  matchCount?: number;
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

// Search types
export interface SearchParams {
  query: string;
  limit?: number;
  searchContent?: boolean;
  searchFrontmatter?: boolean;
  caseSensitive?: boolean;
  /** Restrict the search to a vault subtree (directory prefix, e.g. "Projects/2026"). */
  pathPrefix?: string;
  /** Skip files under any of these subtrees (directory prefixes). */
  excludePaths?: string[];
}

export interface SearchResult {
  p: string;        // path
  t: string;        // title
  ex: string;       // excerpt
  mc: number;       // matchCount
  ln?: number;      // lineNumber
  uri?: string;     // obsidianUri
}

export interface RankCandidate {
  result: SearchResult;
  termFreqs: Map<string, number>;
  docLength: number;
}

// Move types
export interface MoveNoteParams {
  oldPath: string;
  newPath: string;
  overwrite?: boolean;
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
}

export interface BatchReadResult {
  successful: Array<{
    path: string;
    frontmatter?: Record<string, any>;
    content?: string;
    obsidianUri?: string;
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
}

export interface TagManagementResult {
  path: string;
  operation: string;
  tags: string[];
  success: boolean;
  message?: string;
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
  line: number;
  link: string;
  context: string;
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
  line: number;
  text: string;
  status: 'open' | 'completed';
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

// Structured frontmatter query types
export interface QueryNotesParams {
  filters?: Record<string, unknown>;
  pathPrefix?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  includeContent?: boolean;
}

export interface QueryNote {
  path: string;
  frontmatter: Record<string, any>;
  content?: string;
}

export interface QueryNotesResult {
  notes: QueryNote[];
  total: number;
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
