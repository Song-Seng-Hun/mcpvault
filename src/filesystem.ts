import { join, resolve, relative, dirname } from 'path';
import { homedir } from 'os';
import { readdir, stat, readFile, writeFile, unlink, mkdir, access, rename, copyFile } from 'node:fs/promises';
import { constants, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import trash from 'trash';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { generateObsidianUri } from './uri.js';
import type { ParsedNote, DirectoryListing, NoteWriteParams, DeleteNoteParams, DeleteResult, MoveNoteParams, MoveFileParams, MoveResult, BatchReadParams, BatchReadResult, UpdateFrontmatterParams, NoteInfo, TagManagementParams, TagManagementResult, PatchNoteParams, PatchNoteResult, VaultStats, NoteHeading, ReadNoteLinesParams, BacklinksResult, OutlinksResult, UnresolvedLinksResult, OrphanNotesResult, DailyNoteResult, ListTasksParams, ListTasksResult, TaskItem, QueryNotesParams, QueryNotesResult, QueryNote, QueryNotesCursor } from './types.js';
import { extractWikiLinkOccurrences, findBacklinkMatches, findUnresolvedLinkMatches, resolveWikiLinkTargets } from './backlinks.js';
import { buildDailyNotePath, resolveDailyDate, type DailyDateInput } from './daily.js';
import type { VaultMetadataIndex } from './vault-index.js';
import type { VaultGraphIndex } from './vault-graph.js';
import { VaultIoCoordinator } from './vault-io.js';

/** Hard per-note write limit so stdio callers cannot exhaust the vault disk. */
export const MAX_NOTE_CONTENT_BYTES = 8 * 1024 * 1024;

function assertNoteContentSize(content: string, path: string): void {
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_NOTE_CONTENT_BYTES) {
    throw new Error(`Note exceeds ${MAX_NOTE_CONTENT_BYTES} bytes: ${path}`);
  }
}

function getFrontmatterValue(frontmatter: Record<string, any>, key: string): { found: boolean; value?: unknown } {
  let current: unknown = frontmatter;
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function frontmatterValuesEqual(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return expected.every(expectedValue => actual.some(actualValue => frontmatterValuesEqual(actualValue, expectedValue)));
  }
  if (Array.isArray(actual)) {
    return actual.some(value => frontmatterValuesEqual(value, expected));
  }
  if (Array.isArray(expected)) {
    return false;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return actual === expected;
}

function compareQueryValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

const TOP_K_MAX = 1_024;

function compareQueryNotes(a: QueryNote, b: QueryNote, sortBy: string, sortOrder: 'asc' | 'desc'): number {
  const aValue = sortBy === 'path' ? a.path : getFrontmatterValue(a.frontmatter, sortBy).value;
  const bValue = sortBy === 'path' ? b.path : getFrontmatterValue(b.frontmatter, sortBy).value;
  const aMissing = aValue === undefined;
  const bMissing = bValue === undefined;
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  const comparison = compareQueryValues(aValue, bValue);
  if (comparison !== 0) return sortOrder === 'asc' ? comparison : -comparison;
  return a.path.localeCompare(b.path);
}

function selectSortedNotes(notes: QueryNote[], sortBy: string, sortOrder: 'asc' | 'desc', offset: number, limit: number): QueryNote[] {
  const needed = offset + limit;
  const compare = (a: QueryNote, b: QueryNote) => compareQueryNotes(a, b, sortBy, sortOrder);
  if (needed > TOP_K_MAX || needed >= notes.length) return notes.sort(compare).slice(offset, needed);

  // Keep the worst selected item at the heap root. This reduces sorting from
  // O(N log N) to O(N log K) when callers ask for a small first page.
  const heap: QueryNote[] = [];
  const siftUp = (index: number) => {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(heap[parent]!, heap[index]!) >= 0) break;
      [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
      index = parent;
    }
  };
  const siftDown = (index: number) => {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let worst = index;
      if (left < heap.length && compare(heap[left]!, heap[worst]!) > 0) worst = left;
      if (right < heap.length && compare(heap[right]!, heap[worst]!) > 0) worst = right;
      if (worst === index) break;
      [heap[index], heap[worst]] = [heap[worst]!, heap[index]!];
      index = worst;
    }
  };

  for (const note of notes) {
    if (heap.length < needed) {
      heap.push(note);
      siftUp(heap.length - 1);
    } else if (compare(note, heap[0]!) < 0) {
      heap[0] = note;
      siftDown(0);
    }
  }
  return heap.sort(compare).slice(offset, needed);
}

function queryCursorValue(note: QueryNote, sortBy: string): unknown {
  if (sortBy === 'path') return note.path;
  return getFrontmatterValue(note.frontmatter, sortBy).value;
}

function compareQueryNoteToCursor(note: QueryNote, cursor: QueryNotesCursor, sortBy: string, sortOrder: 'asc' | 'desc'): number {
  const noteValue = queryCursorValue(note, sortBy);
  const noteMissing = noteValue === undefined;
  const cursorMissing = cursor.missing === true;
  if (noteMissing !== cursorMissing) return noteMissing ? 1 : -1;
  const comparison = compareQueryValues(noteValue, cursor.value);
  if (comparison !== 0) return sortOrder === 'asc' ? comparison : -comparison;
  return note.path.localeCompare(cursor.path);
}

function cursorForQueryNote(note: QueryNote, sortBy: string): QueryNotesCursor {
  const value = queryCursorValue(note, sortBy);
  if (value === undefined) return { path: note.path, missing: true };
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { path: note.path, value };
  }
  return { path: note.path, value: String(value) };
}

function findCursorStart(notes: Array<Pick<QueryNote, 'path' | 'frontmatter'>>, cursor: QueryNotesCursor, sortBy: string, sortOrder: 'asc' | 'desc'): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareQueryNoteToCursor(notes[middle]!, cursor, sortBy, sortOrder) > 0) high = middle;
    else low = middle + 1;
  }
  return low;
}

function lineStarts(content: string): number[] {
  const starts = [0];
  const newline = /\r\n|\n|\r/g;
  let match: RegExpExecArray | null;
  while ((match = newline.exec(content))) starts.push(match.index + match[0].length);
  return starts;
}

function boundedPreview(content: string, offset: number, contextLines: number, maxChars: number) {
  const starts = lineStarts(content);
  let line = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index]! > offset) break;
    line = index;
  }
  const lines = content.split(/\r\n|\n|\r/);
  const first = Math.max(0, line - contextLines);
  const last = Math.min(lines.length, line + contextLines + 1);
  return { startLine: first + 1, endLine: last, text: lines.slice(first, last).join('\n').slice(0, maxChars) };
}

/**
 * Map a filesystem write failure to a clear, accurate Error.
 *
 * Classifies by the Node error `code`, NOT by message substring. The old
 * substring matching (`message.includes('space')`) mislabeled any error whose
 * message merely contained "space" as a disk-full error, producing false
 * "No space left on device" reports (#109). Errors we threw ourselves with a
 * meaningful message (no `code`) pass through unchanged.
 */
export function classifyWriteError(error: unknown, path: string): Error {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  switch (code) {
    case 'ENOSPC':
      return new Error(`No space left on device: ${path}`);
    case 'EACCES':
    case 'EPERM':
      return new Error(`Permission denied: ${path}`);
    case 'EROFS':
      return new Error(`Read-only filesystem: ${path}`);
  }
  // No filesystem code: an error we raised with a clear message (path
  // traversal, validation, etc.). Preserve it as-is.
  if (error instanceof Error && !code) {
    return error;
  }
  return new Error(`Failed to write file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
}

/**
 * Strip an ATX heading's optional closing sequence of #s per CommonMark: it
 * must be preceded by a space (or the text is nothing but #s, i.e. an empty
 * heading with a closer and no content) and followed only by trailing spaces
 * (already removed by the caller's trim). A closer with no preceding space
 * (e.g. "Heading###") is not a valid closer and stays as literal text.
 */
function stripAtxClosingSequence(text: string): string {
  const withPrecedingSpace = /^(.*[ \t])#+$/.exec(text);
  if (withPrecedingSpace) {
    return withPrecedingSpace[1]!.replace(/[ \t]+$/, '');
  }
  if (/^#+$/.test(text)) {
    return '';
  }
  return text;
}

export class FileSystemService {
  private frontmatterHandler: FrontmatterHandler;
  private pathFilter: PathFilter;
  private mutationTails = new Map<string, Promise<void>>();

  private notifyNoteChanged(path: string, kind: 'upsert' | 'delete'): void {
    const callback = this.onNoteChanged;
    if (!callback || !/\.(?:md|markdown|txt)$/i.test(path)) return;
    try {
      void Promise.resolve(callback(path, kind)).catch(() => {
        // Index maintenance is deliberately best-effort and must never change
        // the outcome of the user's note mutation.
      });
    } catch {
      // A synchronous callback failure is isolated for the same reason.
    }
  }

  private revision(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private async withMutationLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(path) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolveLock => { release = resolveLock; });
    this.mutationTails.set(path, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationTails.get(path) === current) this.mutationTails.delete(path);
    }
  }

  constructor(
    private vaultPath: string,
    pathFilter?: PathFilter,
    frontmatterHandler?: FrontmatterHandler,
    private onNoteChanged?: (path: string, kind: 'upsert' | 'delete') => void | Promise<void>,
    private readonly metadataIndex?: VaultMetadataIndex,
    private readonly graphIndex?: VaultGraphIndex,
    private readonly vaultIo = new VaultIoCoordinator(),
  ) {
    const resolved = resolve(vaultPath);
    try {
      this.vaultPath = realpathSync(resolved);
    } catch {
      // Vault path doesn't exist yet or is inaccessible; fall back to lexical resolution
      this.vaultPath = resolved;
    }
    this.pathFilter = pathFilter || new PathFilter();
    this.frontmatterHandler = frontmatterHandler || new FrontmatterHandler();
  }

  /**
   * Normalize an incoming path to be vault-relative. Strips leading slashes
   * and the vault path prefix when a caller accidentally passes an absolute path
   * (e.g. "/Users/me/vault/wiki/note.md" instead of "wiki/note.md").
   */
  private normalizePath(inputPath: string): string {
    if (!inputPath) return '';
    let p = inputPath.trim();
    // Expand ~ to home directory so "~/vault/note.md" can be matched
    if (p.startsWith('~/') || p === '~') {
      p = p.replace('~', homedir());
    }
    // Normalize path separators for cross-platform comparison (Windows backslashes)
    const normalized = p.replace(/\\/g, '/');
    const vaultPrefix = this.vaultPath.replace(/\\/g, '/');
    // Strip vault path prefix before stripping leading slash, so absolute paths
    // like "/Users/me/vault/wiki/note.md" are handled correctly.
    if (normalized.startsWith(vaultPrefix + '/')) {
      p = normalized.slice(vaultPrefix.length + 1);
    } else if (normalized === vaultPrefix) {
      p = '';
    } else if (p.startsWith('/')) {
      p = p.slice(1);
    }
    return p;
  }

  private resolvePath(relativePath: string): string {
    const normalizedPath = this.normalizePath(relativePath);

    const fullPath = resolve(join(this.vaultPath, normalizedPath));

    // Security check: ensure path is within vault (lexical)
    const relativeToVault = relative(this.vaultPath, fullPath);
    if (relativeToVault.startsWith('..')) {
      throw new Error(`Path traversal not allowed: ${relativePath}. Paths must be within the vault directory.`);
    }

    // Security check: ensure symlinks don't escape vault boundary
    try {
      const realPath = realpathSync(fullPath);
      const realRelative = relative(this.vaultPath, realPath);
      if (realRelative.startsWith('..')) {
        throw new Error(`Symlink target is outside vault: ${relativePath}. Symbolic links must resolve to a path within the vault directory.`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          // File doesn't exist yet (e.g. writing a new note). Verify the parent directory resolves inside vault.
          try {
            const parentReal = realpathSync(dirname(fullPath));
            const parentRelative = relative(this.vaultPath, parentReal);
            if (parentRelative.startsWith('..')) {
              throw new Error(`Symlink target is outside vault: ${relativePath}. Symbolic links must resolve to a path within the vault directory.`);
            }
          } catch (parentErr: unknown) {
            // Parent doesn't exist either (will be created by mkdir). Lexical check above is sufficient.
            if (parentErr instanceof Error && parentErr.message.includes('outside vault')) {
              throw parentErr;
            }
          }
        } else if (code === 'ELOOP') {
          throw new Error(`Circular symlink detected: ${relativePath}. The symbolic link chain forms a loop.`);
        } else if (code === 'EACCES') {
          throw new Error(`Permission denied resolving symlink: ${relativePath}. Cannot verify the symbolic link target is within the vault.`);
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    return fullPath;
  }

  /**
   * Mutation-only symlink defense. Reads may follow an in-vault symlink for
   * Obsidian compatibility, but writes, deletes, and moves must never use a
   * symlinked target or parent. This closes the practical symlink escape case
   * where a validated path is used as a mutation target.
   */
  private resolveWritablePath(relativePath: string): string {
    const fullPath = this.resolvePath(relativePath);
    const relativePathToVault = relative(this.vaultPath, fullPath);
    let current = this.vaultPath;
    for (const component of relativePathToVault.split(/[\\/]+/).filter(Boolean)) {
      current = join(current, component);
      try {
        if (lstatSync(current).isSymbolicLink()) {
          throw new Error(`Symbolic links are not allowed for mutations: ${relativePath}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Symbolic links are not allowed')) throw error;
        if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
    return fullPath;
  }

  async readNote(path: string): Promise<ParsedNote> {
    path = this.normalizePath(path);
    const fullPath = this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }

    // Check if the path is a directory first
    const isDir = await this.isDirectory(path);
    if (isDir) {
      throw new Error(`Cannot read directory as file: ${path}. Use list_directory tool instead.`);
    }

    try {
      const content = await this.vaultIo.readUtf8(fullPath);
      return { ...this.frontmatterHandler.parse(content), revision: this.revision(content) };
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          throw new Error(`File not found: ${path}. Use list_directory to see available files, or check the path spelling.`);
        }
        if (error.code === 'EACCES') {
          throw new Error(`Permission denied: ${path}. The file exists but cannot be read due to filesystem permissions.`);
        }
        if (error.code === 'EISDIR') {
          throw new Error(`Cannot read directory as file: ${path}. Use list_directory tool instead.`);
        }
      }
      throw new Error(`Failed to read file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async noteExists(path: string): Promise<boolean> {
    path = this.normalizePath(path);
    if (!this.pathFilter.isAllowed(path)) return false;
    try {
      return (await stat(this.resolvePath(path))).isFile();
    } catch {
      return false;
    }
  }

  private async assertExpectedRevision(path: string, expectedRevision?: string): Promise<void> {
    if (!expectedRevision) return;
    const exists = await this.noteExists(path);
    if (expectedRevision === 'missing') {
      if (exists) throw new Error(`Revision conflict for ${path}: expected a new note, but it already exists`);
      return;
    }
    if (!exists) throw new Error(`Revision conflict for ${path}: expected ${expectedRevision}, but the note is missing`);
    const current = (await this.readNote(path)).revision;
    if (current !== expectedRevision) {
      throw new Error(`Revision conflict for ${path}: expected ${expectedRevision}, current ${current}. Read the note again before changing it.`);
    }
  }

  async writeNote(params: NoteWriteParams): Promise<void> {
    const path = this.normalizePath(params.path);
    return this.withMutationLock(path, () => this.writeNoteUnlocked({ ...params, path }));
  }

  private async writeNoteUnlocked(params: NoteWriteParams): Promise<void> {
    const { content, frontmatter, mode = 'overwrite', expectedRevision } = params;
    const path = this.normalizePath(params.path);
    const fullPath = this.resolveWritablePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }

    await this.assertExpectedRevision(path, expectedRevision);

    // Validate content is a defined string to prevent writing literal "undefined"
    if (content === undefined || content === null) {
      throw new Error(`Content is required for writing a note: ${path}. The content parameter must be a string.`);
    }

    // Validate frontmatter if provided
    if (frontmatter) {
      const validation = this.frontmatterHandler.validate(frontmatter);
      if (!validation.isValid) {
        throw new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`);
      }
    }

    try {
      let finalContent: string;

      if (mode === 'overwrite') {
        // Original behavior - replace entire content
        finalContent = frontmatter
          ? this.frontmatterHandler.stringify(frontmatter, content)
          : content;
      } else {
        // For append/prepend, we need to read existing content
        let existingNote: ParsedNote;
        try {
          existingNote = await this.readNote(path);
        } catch (error) {
          // File doesn't exist, treat as overwrite
          finalContent = frontmatter
            ? this.frontmatterHandler.stringify(frontmatter, content)
            : content;
        }

        if (existingNote!) {
          // Merge frontmatter if provided
          const mergedFrontmatter = frontmatter
            ? { ...existingNote.frontmatter, ...frontmatter }
            : existingNote.frontmatter;

          const mergedContent = mode === 'append'
            ? existingNote.content + content
            : content + existingNote.content;

          if (existingNote.matter && existingNote.matter.trim() !== '') {
            // Preserve raw formatting for unmodified fields by only applying explicit updates
            finalContent = this.frontmatterHandler.preserveStringify(
              existingNote.matter,
              frontmatter || {},
              mergedContent
            );
          } else {
            finalContent = this.frontmatterHandler.stringify(
              mergedFrontmatter,
              mergedContent
            );
          }
        }
      }

      assertNoteContentSize(finalContent!, path);
      // Create directories if they don't exist
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, finalContent!, 'utf-8');
      this.notifyNoteChanged(path, 'upsert');
    } catch (error) {
      throw classifyWriteError(error, path);
    }
  }

  async patchNote(params: PatchNoteParams): Promise<PatchNoteResult> {
    const path = this.normalizePath(params.path);
    const advanced = params.dryRun === true || params.patches !== undefined || params.startLine !== undefined || params.endLine !== undefined;
    return this.withMutationLock(path, () => advanced
      ? this.patchNoteImproved({ ...params, path })
      : this.patchNoteUnlocked({ ...params, path } as PatchNoteParams & { oldString: string; newString: string }));
  }

  private async patchNoteUnlocked(params: PatchNoteParams & { oldString: string; newString: string }): Promise<PatchNoteResult> {
    const { oldString, newString, replaceAll = false, expectedRevision } = params;
    const path = this.normalizePath(params.path);

    if (!this.pathFilter.isAllowed(path)) {
      return {
        success: false,
        path,
        message: `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    // Validate that strings are not empty
    if (!oldString || oldString.trim() === '') {
      return {
        success: false,
        path,
        message: 'oldString cannot be empty'
      };
    }

    if (newString === undefined || newString === null) {
      return {
        success: false,
        path,
        message: 'newString is required'
      };
    }

    // Validate that oldString and newString are different
    if (oldString === newString) {
      return {
        success: false,
        path,
        message: 'oldString and newString must be different'
      };
    }

    try {
      await this.assertExpectedRevision(path, expectedRevision);
      // Read the existing note
      const note = await this.readNote(path);

      // Get the full content with frontmatter
      const fullContent = note.originalContent;

      // Count occurrences of oldString
      const occurrences = fullContent.split(oldString).length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          path,
          message: `String not found in note: "${oldString.substring(0, 50)}${oldString.length > 50 ? '...' : ''}"`,
          matchCount: 0
        };
      }

      // If not replaceAll and multiple occurrences exist, fail
      if (!replaceAll && occurrences > 1) {
        return {
          success: false,
          path,
          message: `Found ${occurrences} occurrences of the string. Use replaceAll=true to replace all occurrences, or provide a more specific string to match exactly one occurrence.`,
          matchCount: occurrences
        };
      }

      // Perform the replacement
      // Use a replacer function so newString is inserted literally,
      // without $ replacement pattern expansion ($$, $&, $`, $')
      const updatedContent = replaceAll
        ? fullContent.split(oldString).join(newString)
        : fullContent.replace(oldString, () => newString);
      assertNoteContentSize(updatedContent, path);

      // Write the updated content
      const fullPath = this.resolveWritablePath(path);
      await writeFile(fullPath, updatedContent, 'utf-8');
      this.notifyNoteChanged(path, 'upsert');

      return {
        success: true,
        path,
        message: `Successfully replaced ${replaceAll ? occurrences : 1} occurrence${occurrences > 1 ? 's' : ''}`,
        matchCount: occurrences,
        previousRevision: note.revision,
        revision: createHash('sha256').update(updatedContent, 'utf8').digest('hex'),
        dryRun: false,
        wouldChange: updatedContent !== fullContent,
        preview: {
          before: boundedPreview(fullContent, fullContent.indexOf(oldString), 2, Math.min(Math.max(Number(params.previewMaxChars ?? 1200), 200), 5000)),
          after: boundedPreview(updatedContent, updatedContent.indexOf(newString), 2, Math.min(Math.max(Number(params.previewMaxChars ?? 1200), 200), 5000)),
        },
      };

    } catch (error) {
      return {
        success: false,
        path,
        message: `Failed to patch note: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /** Apply line-scoped or multi-hunk patches as one all-or-nothing operation. */
  private async patchNoteImproved(params: PatchNoteParams): Promise<PatchNoteResult> {
    const path = this.normalizePath(params.path);
    if (!this.pathFilter.isAllowed(path)) return { success: false, path, message: `Access denied: ${path}` };
    try {
      await this.assertExpectedRevision(path, params.expectedRevision);
      const note = await this.readNote(path);
      const hunks = params.patches || [{
        oldString: params.oldString || '',
        newString: params.newString ?? '',
        replaceAll: params.replaceAll,
        startLine: params.startLine,
        endLine: params.endLine,
      }];
      if (!hunks.length) throw new Error('patches must contain at least one hunk');
      if (hunks.length > 50) throw new Error('A single patch request may contain at most 50 hunks');
      let content = note.originalContent;
      let totalMatches = 0;
      let firstOffset = 0;
      const patchResults: Array<{ matchCount: number; startLine?: number; endLine?: number }> = [];

      for (const hunk of hunks) {
        const oldString = String(hunk.oldString ?? '');
        const newString = String(hunk.newString ?? '');
        if (!oldString || oldString.trim() === '') throw new Error('oldString cannot be empty');
        if (oldString === newString) throw new Error('oldString and newString must be different');
        const starts = lineStarts(content);
        const lineCount = content.split(/\r\n|\n|\r/).length;
        const hasRange = hunk.startLine !== undefined || hunk.endLine !== undefined;
        if (hasRange && (hunk.startLine === undefined || hunk.endLine === undefined)) throw new Error('startLine and endLine must be supplied together');
        let regionStart = 0;
        let regionEnd = content.length;
        if (hasRange) {
          const startLine = Number(hunk.startLine);
          const endLine = Number(hunk.endLine);
          if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lineCount) throw new Error(`line range must be between 1 and ${lineCount}, with startLine <= endLine`);
          regionStart = starts[startLine - 1]!;
          regionEnd = endLine < lineCount ? starts[endLine]! : content.length;
        }
        const region = content.slice(regionStart, regionEnd);
        const matchCount = region.split(oldString).length - 1;
        if (!matchCount) throw new Error(`String not found${hasRange ? ` within lines ${hunk.startLine}-${hunk.endLine}` : ''}: "${oldString.slice(0, 50)}${oldString.length > 50 ? '...' : ''}"`);
        if (!hunk.replaceAll && matchCount > 1) throw new Error(`Found ${matchCount} occurrences; use replaceAll=true or a more specific hunk`);
        const matchOffset = region.indexOf(oldString);
        const replaced = hunk.replaceAll ? region.split(oldString).join(newString) : region.replace(oldString, () => newString);
        content = content.slice(0, regionStart) + replaced + content.slice(regionEnd);
        totalMatches += matchCount;
        patchResults.push({ matchCount, ...(hasRange && { startLine: Number(hunk.startLine), endLine: Number(hunk.endLine) }) });
        if (patchResults.length === 1) {
          firstOffset = regionStart + matchOffset;
        }
      }
      const previewMaxChars = Math.min(Math.max(Number(params.previewMaxChars ?? 1200), 200), 5000);
      assertNoteContentSize(content, path);
      const revision = createHash('sha256').update(content, 'utf8').digest('hex');
      const result: PatchNoteResult = {
        success: true,
        path,
        message: params.dryRun ? `Patch preview: ${totalMatches} occurrence${totalMatches === 1 ? '' : 's'} would be replaced` : `Successfully replaced ${totalMatches} occurrence${totalMatches === 1 ? '' : 's'}`,
        matchCount: totalMatches,
        previousRevision: note.revision,
        revision,
        dryRun: params.dryRun === true,
        wouldChange: content !== note.originalContent,
        patches: patchResults,
        preview: {
          before: boundedPreview(note.originalContent, firstOffset, 2, previewMaxChars),
          after: boundedPreview(content, firstOffset, 2, previewMaxChars),
        },
      };
      if (params.dryRun || content === note.originalContent) return result;
      await writeFile(this.resolveWritablePath(path), content, 'utf-8');
      this.notifyNoteChanged(path, 'upsert');
      return result;
    } catch (error) {
      return { success: false, path, message: `Failed to patch note: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  async listDirectory(path: string = ''): Promise<DirectoryListing> {
    // Normalize path: treat '.' as root directory, strip vault prefix
    const normalizedPath = path === '.' ? '' : this.normalizePath(path);
    const fullPath = this.resolvePath(normalizedPath);

    try {
      const entries = await readdir(fullPath, { withFileTypes: true });
      const files: string[] = [];
      const directories: string[] = [];

      for (const entry of entries) {
        const entryPath = normalizedPath ? `${normalizedPath}/${entry.name}` : entry.name;

        if (!this.pathFilter.isAllowedForListing(entryPath)) {
          continue;
        }

        if (entry.isSymbolicLink()) {
          // Follow symlinks that resolve inside the vault
          try {
            const entryFullPath = join(fullPath, entry.name);
            const realPath = realpathSync(entryFullPath);
            const realRelative = relative(this.vaultPath, realPath);
            if (realRelative.startsWith('..')) {
              continue; // Symlink target outside vault, skip silently
            }
            const targetStat = await stat(entryFullPath);
            if (targetStat.isDirectory()) {
              directories.push(entry.name);
            } else if (targetStat.isFile()) {
              files.push(entry.name);
            }
          } catch {
            continue; // Broken/circular/inaccessible symlink, skip silently
          }
        } else if (entry.isDirectory()) {
          directories.push(entry.name);
        } else if (entry.isFile()) {
          files.push(entry.name);
        }
      }

      return {
        files: files.sort(),
        directories: directories.sort()
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('ENOENT')) {
          throw new Error(`Directory not found: ${path}. Use list_directory with no path or '/' to see root folders.`);
        }
        if (error.message.includes('permission') || error.message.includes('access')) {
          throw new Error(`Permission denied: ${path}. The directory exists but cannot be read due to filesystem permissions.`);
        }
        if (error.message.includes('not a directory') || error.message.includes('ENOTDIR')) {
          throw new Error(`Not a directory: ${path}. This path points to a file, not a folder. Use read_note to read files.`);
        }
      }
      throw new Error(`Failed to list directory: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    path = this.normalizePath(path);
    const fullPath = this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return false;
    }

    try {
      await access(fullPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    path = this.normalizePath(path);
    const fullPath = this.resolvePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return false;
    }

    try {
      const stats = await stat(fullPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  private async moveNoteToVaultTrash(path: string, fullPath: string): Promise<void> {
    const trashDir = join(this.vaultPath, '.trash');
    const trashPath = join(trashDir, path);

    await mkdir(dirname(trashPath), { recursive: true });

    let finalTrashPath = trashPath;
    try {
      await access(finalTrashPath, constants.F_OK);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = path.endsWith('.md') ? '.md' : '';
      const base = ext ? path.slice(0, -ext.length) : path;
      finalTrashPath = join(trashDir, `${base}-${timestamp}${ext}`);
    } catch {
      // File does not exist in trash, no collision.
    }

    await rename(fullPath, finalTrashPath);
  }

  async deleteNote(params: DeleteNoteParams): Promise<DeleteResult> {
    const { trashMode = 'none' } = params;
    const path = this.normalizePath(params.path);
    const confirmPath = this.normalizePath(params.confirmPath);

    // Confirmation check - paths must match exactly
    if (path !== confirmPath) {
      return {
        success: false,
        path: path,
        message: "Deletion cancelled: confirmation path does not match. For safety, both 'path' and 'confirmPath' must be identical."
      };
    }

    const fullPath = this.resolveWritablePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return {
        success: false,
        path: path,
        message: `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    try {
      // Check if it's a directory first (can't delete directories with this method)
      const isDir = await this.isDirectory(path);
      if (isDir) {
        return {
          success: false,
          path: path,
          message: `Cannot delete: ${path} is not a file`
        };
      }

      if (trashMode === 'local') {
        await this.moveNoteToVaultTrash(path, fullPath);

        this.notifyNoteChanged(path, 'delete');

        return {
          success: true,
          path: path,
          message: `Successfully moved note to vault trash: ${path}`
        };
      }

      if (trashMode === 'system') {
        try {
          await trash(fullPath);
          this.notifyNoteChanged(path, 'delete');
          return {
            success: true,
            path: path,
            message: `Successfully moved note to system trash: ${path}`
          };
        } catch (systemTrashError) {
          // Some locked-down Windows environments cannot launch the bundled
          // recycle-bin helper. Preserve recoverability by falling back to
          // the vault trash, but never claim that the system trash succeeded.
          if (!(await this.exists(path))) throw systemTrashError;
          await this.moveNoteToVaultTrash(path, fullPath);
          this.notifyNoteChanged(path, 'delete');
          return {
            success: true,
            path: path,
            message: `System trash unavailable; moved note to vault trash instead: ${path}`
          };
        }
      }

      // Perform the deletion using Node.js native API
      await unlink(fullPath);

      this.notifyNoteChanged(path, 'delete');

      return {
        success: true,
        path: path,
        message: `Successfully deleted note: ${path}. This action cannot be undone.`
      };

    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          return {
            success: false,
            path: path,
            message: `File not found: ${path}. Use list_directory to see available files.`
          };
        }
        if (error.code === 'EACCES') {
          return {
            success: false,
            path: path,
            message: `Permission denied: ${path}. The file exists but cannot be deleted due to filesystem permissions.`
          };
        }
      }
      return {
        success: false,
        path: path,
        message: `Failed to delete file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async moveNote(params: MoveNoteParams): Promise<MoveResult> {
    const { overwrite = false } = params;
    const oldPath = this.normalizePath(params.oldPath);
    const newPath = this.normalizePath(params.newPath);

    if (!this.pathFilter.isAllowed(oldPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${oldPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    if (!this.pathFilter.isAllowed(newPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${newPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    const oldFullPath = this.resolveWritablePath(oldPath);
    const newFullPath = this.resolveWritablePath(newPath);

    try {
      // Read source content (will throw ENOENT if not found)
      let content: string;
      try {
        content = await readFile(oldFullPath, 'utf-8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return {
            success: false,
            oldPath,
            newPath,
            message: `Source file not found: ${oldPath}. Use list_directory to see available files.`
          };
        }
        throw error;
      }

      // Create directories if needed
      await mkdir(dirname(newFullPath), { recursive: true });

      // Write to new location, checking for existing file atomically if !overwrite
      try {
        if (overwrite) {
          await writeFile(newFullPath, content, 'utf-8');
        } else {
          // wx flag: write exclusive - fails if file exists
          await writeFile(newFullPath, content, { encoding: 'utf-8', flag: 'wx' });
        }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
          return {
            success: false,
            oldPath,
            newPath,
            message: `Target file already exists: ${newPath}. Use overwrite=true to replace it.`
          };
        }
        throw error;
      }

      // Delete the source file
      await unlink(oldFullPath);

      this.notifyNoteChanged(oldPath, 'delete');
      this.notifyNoteChanged(newPath, 'upsert');

      return {
        success: true,
        oldPath,
        newPath,
        message: `Successfully moved note from ${oldPath} to ${newPath}`
      };

    } catch (error) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Failed to move note: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async moveFile(params: MoveFileParams): Promise<MoveResult> {
    const { overwrite = false } = params;
    const oldPath = this.normalizePath(params.oldPath);
    const newPath = this.normalizePath(params.newPath);
    const confirmOldPath = this.normalizePath(params.confirmOldPath);
    const confirmNewPath = this.normalizePath(params.confirmNewPath);

    if (oldPath !== confirmOldPath || newPath !== confirmNewPath) {
      return {
        success: false,
        oldPath,
        newPath,
        message: "Move cancelled: confirmation paths do not match. For safety, oldPath must equal confirmOldPath and newPath must equal confirmNewPath."
      };
    }

    if (!this.pathFilter.isAllowedForListing(oldPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${oldPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    if (!this.pathFilter.isAllowedForListing(newPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Access denied: ${newPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    const oldFullPath = this.resolveWritablePath(oldPath);
    const newFullPath = this.resolveWritablePath(newPath);

    try {
      const sourceStat = await stat(oldFullPath);
      if (sourceStat.isDirectory()) {
        return {
          success: false,
          oldPath,
          newPath,
          message: `Source path is a directory: ${oldPath}. move_file currently supports files only.`
        };
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return {
          success: false,
          oldPath,
          newPath,
          message: `Source file not found: ${oldPath}. Use list_directory to see available files.`
        };
      }
      return {
        success: false,
        oldPath,
        newPath,
        message: `Failed to inspect source file: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }

    try {
      if (!overwrite) {
        try {
          await access(newFullPath, constants.F_OK);
          return {
            success: false,
            oldPath,
            newPath,
            message: `Target file already exists: ${newPath}. Use overwrite=true to replace it.`
          };
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      await mkdir(dirname(newFullPath), { recursive: true });

      if (overwrite) {
        try {
          const targetStat = await stat(newFullPath);
          if (targetStat.isDirectory()) {
            return {
              success: false,
              oldPath,
              newPath,
              message: `Target path is a directory: ${newPath}. Please provide a file path.`
            };
          }
          await unlink(newFullPath);
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      try {
        await rename(oldFullPath, newFullPath);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EXDEV') {
          await copyFile(oldFullPath, newFullPath);
          await unlink(oldFullPath);
        } else {
          throw error;
        }
      }

      this.notifyNoteChanged(oldPath, 'delete');
      this.notifyNoteChanged(newPath, 'upsert');

      return {
        success: true,
        oldPath,
        newPath,
        message: `Successfully moved file from ${oldPath} to ${newPath}`
      };
    } catch (error) {
      return {
        success: false,
        oldPath,
        newPath,
        message: `Failed to move file: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async readMultipleNotes(params: BatchReadParams): Promise<BatchReadResult> {
    const { paths, includeContent = true, includeFrontmatter = true, knownRevisions } = params;

    if (paths.length > 10) {
      throw new Error('Maximum 10 files per batch read request');
    }

    const results = await Promise.allSettled(
      paths.map(async (rawPath) => {
        const path = this.normalizePath(rawPath);
        if (!this.pathFilter.isAllowed(path)) {
          throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
        }

        const knownRevision = knownRevisions?.[rawPath] || knownRevisions?.[path];
        if (knownRevision && this.metadataIndex && await this.metadataIndex.matchesRevision(path, knownRevision)) {
          return {
            path,
            obsidianUri: generateObsidianUri(this.vaultPath, path),
            revision: knownRevision,
            unchanged: true,
          };
        }

        const note = await this.readNote(path);
        const result: any = {
          path,
          obsidianUri: generateObsidianUri(this.vaultPath, path),
          ...(knownRevisions !== undefined && { revision: note.revision }),
        };

        if (includeFrontmatter) {
          result.frontmatter = note.frontmatter;
        }

        if (includeContent) {
          result.content = note.content;
        }

        return result;
      })
    );

    const successful: Array<{ path: string; frontmatter?: Record<string, any>; content?: string; }> = [];
    const failed: Array<{ path: string; error: string; }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        failed.push({
          path: paths[index] || '',
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
        });
      }
    });

    return { successful, failed };
  }

  async updateFrontmatter(params: UpdateFrontmatterParams): Promise<void> {
    const path = this.normalizePath(params.path);
    return this.withMutationLock(path, () => this.updateFrontmatterUnlocked({ ...params, path }));
  }

  private async updateFrontmatterUnlocked(params: UpdateFrontmatterParams): Promise<void> {
    const { frontmatter, merge = true, expectedRevision } = params;
    const path = this.normalizePath(params.path);

    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }

    await this.assertExpectedRevision(path, expectedRevision);

    // Read the existing note
    const note = await this.readNote(path);

    // Prepare new frontmatter
    const newFrontmatter = merge
      ? { ...note.frontmatter, ...frontmatter }
      : frontmatter;

    // Validate the new frontmatter
    const validation = this.frontmatterHandler.validate(newFrontmatter);
    if (!validation.isValid) {
      throw new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`);
    }

    const fullPath = this.resolveWritablePath(path);

    if (merge && note.matter && note.matter.trim() !== '') {
      // Preserve raw formatting for unmodified fields
      const updatedContent = this.frontmatterHandler.preserveStringify(note.matter, frontmatter, note.content);
      assertNoteContentSize(updatedContent, path);
      await writeFile(fullPath, updatedContent, 'utf-8');
    } else {
      // Replace frontmatter entirely (or no existing matter to preserve)
      await this.writeNoteUnlocked({
        path,
        content: note.content,
        frontmatter: newFrontmatter
      });
    }
  }

  async getNotesInfo(paths: string[]): Promise<NoteInfo[]> {
    const results = await Promise.allSettled(
      paths.map(async (rawPath): Promise<NoteInfo> => {
        const path = this.normalizePath(rawPath);
        if (!this.pathFilter.isAllowed(path)) {
          throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
        }

        const fullPath = this.resolvePath(path);

        let stats;
        try {
          stats = await stat(fullPath);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            throw new Error(`File not found: ${path}`);
          }
          throw error;
        }

        const size = stats.size;
        const lastModified = stats.mtime.getTime();

        // Quick check for frontmatter without reading full content
        const file = await readFile(fullPath, 'utf-8');
        const firstChunk = file.slice(0, 100);
        const hasFrontmatter = firstChunk.startsWith('---\n');

        return {
          path,
          size,
          modified: lastModified,
          hasFrontmatter,
          obsidianUri: generateObsidianUri(this.vaultPath, path)
        };
      })
    );

    // Return only successful results, filter out failed ones
    return results
      .filter((result): result is PromiseFulfilledResult<NoteInfo> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  async manageTags(params: TagManagementParams): Promise<TagManagementResult> {
    const { operation, tags = [] } = params;
    const path = this.normalizePath(params.path);

    if (!this.pathFilter.isAllowed(path)) {
      return {
        path,
        operation,
        tags: [],
        success: false,
        message: `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
      };
    }

    try {
      const note = await this.readNote(path);
      let currentTags: string[] = [];

      // Extract tags from frontmatter
      if (note.frontmatter.tags) {
        if (Array.isArray(note.frontmatter.tags)) {
          currentTags = note.frontmatter.tags;
        } else if (typeof note.frontmatter.tags === 'string') {
          currentTags = [note.frontmatter.tags];
        }
      }

      // Also extract inline tags from content
      const inlineTagMatches = note.content.match(/#[a-zA-Z0-9_-]+/g) || [];
      const inlineTags = inlineTagMatches.map(tag => tag.slice(1)); // Remove #
      currentTags = [...new Set([...currentTags, ...inlineTags])]; // Deduplicate

      if (operation === 'list') {
        return {
          path,
          operation,
          tags: currentTags,
          success: true
        };
      }

      let newTags = [...currentTags];

      if (operation === 'add') {
        for (const tag of tags) {
          if (!newTags.includes(tag)) {
            newTags.push(tag);
          }
        }
      } else if (operation === 'remove') {
        newTags = newTags.filter(tag => !tags.includes(tag));
      }

      // Build tag updates for preserveStringify
      const tagUpdates: Record<string, any> = {};
      if (newTags.length > 0) {
        tagUpdates.tags = newTags;
      } else {
        tagUpdates.tags = undefined;
      }

      // Write back the note with updated frontmatter, preserving raw formatting for unmodified fields
      let updatedContent: string;
      if (note.matter && note.matter.trim() !== '') {
        updatedContent = this.frontmatterHandler.preserveStringify(
          note.matter,
          tagUpdates,
          note.content
        );
      } else {
        const updatedFrontmatter = { ...note.frontmatter };
        if (newTags.length > 0) {
          updatedFrontmatter.tags = newTags;
        } else {
          delete updatedFrontmatter.tags;
        }
        updatedContent = this.frontmatterHandler.stringify(
          updatedFrontmatter,
          note.content
        );
      }
      assertNoteContentSize(updatedContent, path);
      const fullPath = this.resolveWritablePath(path);
      await writeFile(fullPath, updatedContent, 'utf-8');

      return {
        path,
        operation,
        tags: newTags,
        success: true,
        message: `Successfully ${operation === 'add' ? 'added' : 'removed'} tags`
      };

    } catch (error) {
      return {
        path,
        operation,
        tags: [],
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  getVaultPath(): string {
    return this.vaultPath;
  }

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
  async findPathForWikiLink(wikiLinkName: string, canAccessPath: (path: string) => boolean = () => true): Promise<string[]> {
    if (!wikiLinkName.trim()) {
      throw new Error('Empty wiki link — provide a document name inside [[ ]].');
    }
    const normalizedName = `${wikiLinkName}.md`;
    const isPathQualified = wikiLinkName.includes('/');
    const matches: string[] = [];

    const scan = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelativePath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;

        if (!this.pathFilter.isAllowed(entryRelativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          if (!this.pathFilter.isAllowed(`${entryRelativePath}/test.md`)) {
            continue;
          }
          await scan(join(dirPath, entry.name), entryRelativePath);
        } else if (
          entry.isFile() &&
          (isPathQualified
            ? entryRelativePath === normalizedName
            : entry.name === normalizedName)
        ) {
          if (canAccessPath(entryRelativePath)) matches.push(entryRelativePath);
        }
      }
    };

    await scan(this.vaultPath);

    // Depth-ascending (root-first), alphabetical tiebreak at equal depth.
    // No current-folder context exists for a standalone MCP tool.
    matches.sort((a, b) => {
      const da = a.split('/').length;
      const db = b.split('/').length;
      return da !== db ? da - db : a.localeCompare(b);
    });

    return matches;
  }

  async getBacklinks(path: string, limit: number = 100, canAccessPath: (path: string) => boolean = () => true): Promise<BacklinksResult> {
    const target = this.normalizePath(path);
    if (!this.pathFilter.isAllowed(target)) {
      throw new Error(`Access denied: ${target}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }

    if (this.graphIndex) {
      if (!canAccessPath(target)) throw new Error(`Access denied: ${target}`);
      await this.readNote(target);
      return this.graphIndex.getBacklinks(target, limit, canAccessPath);
    }

    // Validate that the requested target is an existing readable note before
    // scanning the vault. This also applies the same symlink boundary checks
    // as read_note.
    await this.readNote(target);

    const backlinks: BacklinksResult['backlinks'] = [];
    let total = 0;

    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (this.pathFilter.isAllowedForListing(entryRelativePath)) {
            await scanDirectory(fullEntryPath, entryRelativePath);
          }
          continue;
        }

        if (!entry.isFile() || entryRelativePath === target || !this.pathFilter.isAllowed(entryRelativePath) || !canAccessPath(entryRelativePath)) {
          continue;
        }

        try {
          const content = await readFile(fullEntryPath, 'utf-8');
          const found = findBacklinkMatches(content, target);
          for (const backlink of found) {
            total += 1;
            if (backlinks.length < limit) {
              backlinks.push({ ...backlink, path: entryRelativePath });
            }
          }
        } catch {
          // A single unreadable or concurrently removed note should not make
          // a vault-wide read operation fail.
        }
      }
    };

    await scanDirectory(this.vaultPath);
    backlinks.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

    return {
      target,
      backlinks,
      total,
      truncated: total > backlinks.length,
    };
  }

  async getOutlinks(path: string, limit: number = 100, canAccessPath: (path: string) => boolean = () => true): Promise<OutlinksResult> {
    const source = this.normalizePath(path);
    if (!this.pathFilter.isAllowed(source)) {
      throw new Error(`Access denied: ${source}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }
    if (!canAccessPath(source)) throw new Error(`Access denied: ${source}`);

    if (this.graphIndex) return this.graphIndex.getOutlinks(source, limit, canAccessPath);

    const note = await this.readNote(source);
    const allOutlinks = extractWikiLinkOccurrences(note.originalContent);
    // Outlinks are raw authoring data, but a public note must not disclose
    // the names or paths of private notes it happens to mention. Keep links
    // that are unresolved in the caller's visible view (they are useful
    // authoring diagnostics), while suppressing links that resolve only to
    // inaccessible notes and explicit private scope URIs.
    const allPaths = await this.collectVaultFiles();
    const allVisiblePaths = allPaths.filter(canAccessPath);
    const visibleOutlinks = allOutlinks.filter(link => {
      if (/^scope:\/\/(?:model|agent|user)\//i.test(link.target.trim())) return false;
      const anyMatches = resolveWikiLinkTargets(link.target, allPaths);
      if (anyMatches.length === 0) return true;
      return resolveWikiLinkTargets(link.target, allVisiblePaths).length > 0;
    });
    const outlinks = visibleOutlinks.slice(0, limit);
    const total = visibleOutlinks.length;

    return {
      source,
      outlinks,
      total,
      truncated: total > outlinks.length,
    };
  }

  async findUnresolvedLinks(limit: number = 100, canAccessPath: (path: string) => boolean = () => true): Promise<UnresolvedLinksResult> {
    if (this.graphIndex) return this.graphIndex.findUnresolvedLinks(limit, canAccessPath);
    const vaultFiles = (await this.collectVaultFiles()).filter(canAccessPath);
    const noteFiles = vaultFiles.filter((path) => this.isNotePath(path));
    const unresolved: UnresolvedLinksResult['unresolved'] = [];
    let total = 0;

    for (const source of noteFiles) {

      try {
        const content = await readFile(this.resolvePath(source), 'utf-8');
        const found = findUnresolvedLinkMatches(content, vaultFiles);
        for (const link of found) {
          total += 1;
          if (unresolved.length < limit) {
            unresolved.push({ ...link, path: source });
          }
        }
      } catch {
        // Skip files that are unreadable or disappear during the scan.
      }
    }

    unresolved.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    return {
      unresolved,
      total,
      truncated: total > unresolved.length,
    };
  }

  async findOrphanNotes(limit: number = 100, canAccessPath: (path: string) => boolean = () => true): Promise<OrphanNotesResult> {
    if (this.graphIndex) return this.graphIndex.findOrphanNotes(limit, canAccessPath);
    const vaultFiles = (await this.collectVaultFiles()).filter(canAccessPath);
    const noteFiles = vaultFiles.filter((path) => this.isNotePath(path));
    const incomingCounts = new Map(noteFiles.map((path) => [path.toLowerCase(), 0]));

    for (const source of noteFiles) {
      try {
        const content = await readFile(this.resolvePath(source), 'utf-8');
        for (const { target } of extractWikiLinkOccurrences(content)) {
          for (const destination of resolveWikiLinkTargets(target, noteFiles)) {
            if (destination.toLowerCase() !== source.toLowerCase()) {
              const key = destination.toLowerCase();
              incomingCounts.set(key, (incomingCounts.get(key) || 0) + 1);
            }
          }
        }
      } catch {
        // An unreadable note contributes no observed incoming links.
      }
    }

    const orphans = noteFiles
      .filter((path) => incomingCounts.get(path.toLowerCase()) === 0)
      .map((path) => ({ path, incomingLinks: 0 }));

    return {
      orphans: orphans.slice(0, limit),
      total: orphans.length,
      truncated: orphans.length > Math.min(limit, orphans.length),
    };
  }

  private isNotePath(path: string): boolean {
    return /\.(?:md|markdown|txt)$/i.test(path);
  }

  async getDailyNote(dateInput: DailyDateInput = 'today', folder: string = 'Daily Notes'): Promise<DailyNoteResult> {
    const date = resolveDailyDate(dateInput);
    const path = buildDailyNotePath(folder, date);
    const note = await this.readNote(path);
    return {
      success: true,
      action: 'get',
      date,
      path,
      frontmatter: note.frontmatter,
      content: note.content,
    };
  }

  async writeDailyNote(params: {
    action: 'create' | 'append';
    date?: DailyDateInput;
    folder?: string;
    content?: string;
    frontmatter?: Record<string, any>;
  }): Promise<DailyNoteResult> {
    const date = resolveDailyDate(params.date || 'today');
    const path = buildDailyNotePath(params.folder || 'Daily Notes', date);
    const content = params.content ?? '';
    if (params.action === 'append' && !content.trim()) {
      throw new Error('content is required for the append action');
    }

    const alreadyExists = await this.exists(path);
    if (params.action === 'create' && alreadyExists) {
      return {
        success: true,
        action: 'create',
        date,
        path,
        created: false,
        message: 'Daily note already exists; it was not overwritten.',
      };
    }

    let contentToWrite = content;
    if (params.action === 'append' && alreadyExists) {
      const existing = await this.readNote(path);
      if (existing.originalContent.length > 0 && !existing.originalContent.endsWith('\n')) {
        contentToWrite = `\n${content}`;
      }
    }

    await this.writeNote({
      path,
      content: contentToWrite,
      ...(params.frontmatter !== undefined && { frontmatter: params.frontmatter }),
      mode: params.action === 'append' ? 'append' : 'overwrite',
    });

    return {
      success: true,
      action: params.action,
      date,
      path,
      created: !alreadyExists,
      message: params.action === 'create' ? 'Daily note created.' : 'Content appended to daily note.',
    };
  }

  private async collectVaultFiles(): Promise<string[]> {
    const files: string[] = [];
    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (this.pathFilter.isAllowedForListing(entryRelativePath)) {
            await scanDirectory(fullEntryPath, entryRelativePath);
          }
        } else if (entry.isFile() && this.pathFilter.isAllowedForListing(entryRelativePath)) {
          files.push(entryRelativePath);
        }
      }
    };

    await scanDirectory(this.vaultPath);
    return files;
  }

  async getNoteOutline(path: string): Promise<NoteHeading[]> {
    path = this.normalizePath(path);
    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }
    const fullPath = this.resolvePath(path);
    const raw = await readFile(fullPath, 'utf-8');
    const lines = raw.split('\n');
    const headings: NoteHeading[] = [];
    // Per CommonMark ATX headings: up to 3 leading spaces are allowed before
    // the #s; the heading may have no text at all (bare `#`); and an optional
    // closing sequence of #s (preceded by a space, followed only by trailing
    // spaces) is stripped from the returned text rather than kept literally.
    const headingRegex = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
    // Frontmatter delimiters (---) can themselves look like content but never
    // contain real headings; skip the block so YAML comments (# ...) inside it
    // can't be misdetected as headings. Handles both LF and CRLF line endings,
    // since split('\n') leaves a trailing \r on each line for CRLF files.
    let inFrontmatter = false;
    let frontmatterEnded = false;
    // Fenced code blocks (``` or ~~~) can contain lines that look like
    // headings (e.g. a shell comment or markdown example) but aren't real
    // structure; track fence state and skip everything inside one.
    // Per CommonMark: a fence marker may be indented up to 3 spaces; the
    // opener records both its character and its length, and only a line
    // with the *same* character, at least as many markers, and nothing but
    // trailing whitespace after them closes it (mismatched length, a
    // different character, or trailing content like a language tag on a
    // would-be closer must NOT end the block).
    let inFence = false;
    let fenceChar = '';
    let fenceLength = 0;
    const fenceRegex = /^ {0,3}(`{3,}|~{3,})(.*)$/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.replace(/\r$/, '');

      if (!frontmatterEnded && i === 0 && trimmed === '---') {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (trimmed === '---') {
          inFrontmatter = false;
          frontmatterEnded = true;
        }
        continue;
      }
      frontmatterEnded = true;

      const fenceMatch = fenceRegex.exec(trimmed);
      if (fenceMatch) {
        const markers = fenceMatch[1]!;
        const trailing = fenceMatch[2]!;
        const char = markers.charAt(0);
        if (!inFence) {
          inFence = true;
          fenceChar = char;
          fenceLength = markers.length;
        } else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') {
          inFence = false;
          fenceChar = '';
          fenceLength = 0;
        }
        // Any other fence-like line while inFence (mismatched char, too
        // short, or has trailing content) is just code-block content.
        continue;
      }
      if (inFence) {
        continue;
      }

      const match = headingRegex.exec(trimmed);
      if (match) {
        const rawText = (match[2] ?? '').trim();
        headings.push({ level: match[1]!.length, text: stripAtxClosingSequence(rawText), line: i + 1 });
      }
    }
    return headings;
  }

  async readNoteLines(params: ReadNoteLinesParams): Promise<string> {
    const path = this.normalizePath(params.path);
    if (!this.pathFilter.isAllowed(path)) {
      throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }
    const fullPath = this.resolvePath(path);
    const raw = await readFile(fullPath, 'utf-8');
    const lines = raw.split('\n');
    // Both bounds are clamped into [1, lines.length] rather than trusting
    // caller-supplied indices directly - out-of-range start/end (0, negative,
    // or past EOF) previously either threw or silently wrapped via
    // Array.slice's negative-index behavior instead of clamping like end did.
    const clampedStart = Math.min(Math.max(params.startLine, 1), lines.length);
    const clampedEnd = Math.min(Math.max(params.endLine, clampedStart), lines.length);
    return lines.slice(clampedStart - 1, clampedEnd).join('\n');
  }

  async getVaultStats(recentCount: number = 5, canAccessPath: (path: string) => boolean = () => true): Promise<VaultStats> {
    let totalNotes = 0;
    let totalFolders = 0;
    let totalSize = 0;
    const recentFiles: Array<{ path: string; modified: number }> = [];

    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!this.pathFilter.isAllowedForListing(entryRelativePath)) {
            continue;
          }
          if (canAccessPath(entryRelativePath)) totalFolders++;
          await scanDirectory(fullEntryPath, entryRelativePath);
        } else if (entry.isFile()) {
          if (!this.pathFilter.isAllowed(entryRelativePath) || !canAccessPath(entryRelativePath)) {
            continue;
          }

          totalNotes++;
          const stats = await stat(fullEntryPath);
          totalSize += stats.size;

          // Track recent files
          const fileInfo = { path: entryRelativePath, modified: stats.mtime.getTime() };

          // Insert in sorted order (most recent first)
          const insertIndex = recentFiles.findIndex(f => f.modified < fileInfo.modified);
          if (insertIndex === -1) {
            if (recentFiles.length < recentCount) {
              recentFiles.push(fileInfo);
            }
          } else {
            recentFiles.splice(insertIndex, 0, fileInfo);
            if (recentFiles.length > recentCount) {
              recentFiles.pop();
            }
          }
        }
      }
    };

    await scanDirectory(this.vaultPath);

    return {
      totalNotes,
      totalFolders,
      totalSize,
      recentlyModified: recentFiles
    };
  }

  async listAllTags(canAccessPath: (path: string) => boolean = () => true): Promise<Array<{ tag: string; count: number }>> {
    if (this.graphIndex) return this.graphIndex.listAllTags(canAccessPath);
    const tagCounts = new Map<string, number>();

    const inlineTagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/\-]*)/g;

    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!this.pathFilter.isAllowedForListing(entryRelativePath)) continue;
          await scanDirectory(fullEntryPath, entryRelativePath);
        } else if (entry.isFile() && this.pathFilter.isAllowed(entryRelativePath) && canAccessPath(entryRelativePath)) {
          try {
            const content = await readFile(fullEntryPath, 'utf-8');
            const parsed = this.frontmatterHandler.parse(content);

            // Frontmatter tags
            const fmTags = parsed.frontmatter?.tags;
            if (Array.isArray(fmTags)) {
              for (const tag of fmTags) {
                if (typeof tag === 'string' && tag.trim()) {
                  const normalized = tag.trim().toLowerCase();
                  tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
                }
              }
            }

            // Inline #tags from body content
            let match;
            while ((match = inlineTagRegex.exec(parsed.content)) !== null) {
              const normalized = match[1]!.toLowerCase();
              tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }
    };

    await scanDirectory(this.vaultPath);

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  private resolvePathPrefix(input?: string): string {
    const rawPathPrefix = input ? this.normalizePath(input) : '';
    if (!rawPathPrefix) return '';
    if (!this.pathFilter.isAllowedForListing(rawPathPrefix)) {
      throw new Error(`Access denied: ${rawPathPrefix}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }

    const resolvedPrefix = this.resolvePath(rawPathPrefix);
    const pathPrefix = relative(this.vaultPath, resolvedPrefix).replace(/\\/g, '/');
    if (pathPrefix && !this.pathFilter.isAllowedForListing(pathPrefix)) {
      throw new Error(`Access denied: ${pathPrefix}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
    }
    return pathPrefix;
  }

  async listTasks(params: ListTasksParams = {}, canAccessPath: (path: string) => boolean = () => true): Promise<ListTasksResult> {
    const status = params.status || 'open';
    if (status !== 'open' && status !== 'completed' && status !== 'all') {
      throw new Error('status must be open, completed, or all');
    }
    const requestedLimit = params.limit ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new Error('limit must be a positive integer');
    }
    const limit = Math.min(requestedLimit, 500);
    // Validate the optional scope before scanning. resolvePath performs the
    // lexical and symlink boundary checks; listing validation blocks hidden
    // and system directories such as .obsidian and .git.
    const pathPrefix = this.resolvePathPrefix(params.pathPrefix);

    const tasks: TaskItem[] = [];
    const notePaths = (await this.collectVaultFiles())
      .filter(path => this.pathFilter.isAllowed(path))
      .filter(canAccessPath)
      .filter(path => /\.(?:md|markdown|txt)$/i.test(path))
      .filter(path => !pathPrefix || path === pathPrefix || path.startsWith(`${pathPrefix}/`))
      .sort((a, b) => a.localeCompare(b));

    for (const path of notePaths) {
      let content: string;
      try {
        content = await readFile(this.resolvePath(path), 'utf-8');
      } catch {
        continue;
      }

      let inFrontmatter = false;
      let frontmatterEnded = false;
      let inFence = false;
      let fenceChar = '';
      let fenceLength = 0;
      const fenceRegex = /^ {0,3}(`{3,}|~{3,})(.*)$/;
      const lines = content.split('\n');

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!.replace(/\r$/, '');

        if (!frontmatterEnded && index === 0 && line === '---') {
          inFrontmatter = true;
          continue;
        }
        if (inFrontmatter) {
          if (line === '---') {
            inFrontmatter = false;
            frontmatterEnded = true;
          }
          continue;
        }

        const fenceMatch = fenceRegex.exec(line);
        if (fenceMatch) {
          const markers = fenceMatch[1]!;
          const trailing = fenceMatch[2]!;
          const char = markers.charAt(0);
          if (!inFence) {
            inFence = true;
            fenceChar = char;
            fenceLength = markers.length;
          } else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') {
            inFence = false;
            fenceChar = '';
            fenceLength = 0;
          }
          continue;
        }
        if (inFence) continue;

        const taskMatch = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
        if (!taskMatch) continue;

        const taskStatus: 'open' | 'completed' = taskMatch[2]!.toLowerCase() === 'x' ? 'completed' : 'open';
        if (status !== 'all' && status !== taskStatus) continue;

        tasks.push({
          path,
          line: index + 1,
          text: taskMatch[3]!.trim(),
          status: taskStatus,
        });
      }
    }

    return {
      tasks: tasks.slice(0, limit),
      total: tasks.length,
      truncated: tasks.length > limit,
    };
  }

  async queryNotes(params: QueryNotesParams = {}, canAccessPath: (path: string) => boolean = () => true): Promise<QueryNotesResult> {
    const requestedLimit = params.limit ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new Error('limit must be a positive integer');
    }
    const limit = Math.min(requestedLimit, 500);
    const requestedOffset = params.offset ?? 0;
    if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
      throw new Error('offset must be a non-negative integer');
    }
    const sortOrder = params.sortOrder || 'asc';
    if (sortOrder !== 'asc' && sortOrder !== 'desc') {
      throw new Error('sortOrder must be asc or desc');
    }
    if (params.sortBy !== undefined && !params.sortBy.trim()) {
      throw new Error('sortBy cannot be empty');
    }
    if (params.filters !== undefined && (typeof params.filters !== 'object' || Array.isArray(params.filters) || params.filters === null)) {
      throw new Error('filters must be an object');
    }
    if (params.after !== undefined && (!params.after || typeof params.after !== 'object' || typeof params.after.path !== 'string' || !params.after.path.trim())) {
      throw new Error('after must contain a cursor path');
    }

    const pathPrefix = this.resolvePathPrefix(params.pathPrefix);
    const sortBy = params.sortBy || 'path';
    const notes: QueryNote[] = [];
    const filters = params.filters || {};
    if (this.metadataIndex && params.includeTotal === false) {
      const page = await this.metadataIndex.listSortedPage({
        filters,
        pathPrefix,
        sortBy,
        sortOrder,
        limit,
        offset: requestedOffset,
        ...(params.after && { after: params.after }),
        canAccessPath,
      });
      const selected = page.entries.map(entry => ({ path: entry.path, frontmatter: entry.frontmatter }));
      const nextCursor = page.truncated ? cursorForQueryNote(selected[selected.length - 1]!, sortBy) : undefined;
      if (params.includeContent) {
        const withContent = await Promise.all(selected.map(async note => {
          try {
            const raw = await this.vaultIo.readUtf8(this.resolvePath(note.path));
            return { ...note, content: this.frontmatterHandler.parse(raw).content };
          } catch {
            return undefined;
          }
        }));
        return {
          notes: withContent.filter((note): note is QueryNote & { content: string } => note !== undefined),
          total: -1,
          totalKnown: false,
          truncated: page.truncated,
          ...(nextCursor ? { nextCursor } : {}),
        };
      }
      return {
        notes: selected,
        total: -1,
        totalKnown: false,
        truncated: page.truncated,
        ...(nextCursor ? { nextCursor } : {}),
      };
    }
    const indexedEntries = this.metadataIndex ? await this.metadataIndex.listSorted(filters, pathPrefix, sortBy, sortOrder) : undefined;
    if (indexedEntries && params.includeTotal === false) {
      const start = params.after ? findCursorStart(indexedEntries, params.after, sortBy, sortOrder) : 0;
      const pageCandidates: QueryNote[] = [];
      let skipped = requestedOffset;
      for (let index = start; index < indexedEntries.length; index += 1) {
        const entry = indexedEntries[index]!;
        if (!this.pathFilter.isAllowed(entry.path) || !canAccessPath(entry.path)) continue;
        if (pathPrefix && entry.path !== pathPrefix && !entry.path.startsWith(`${pathPrefix}/`)) continue;
        const matches = Object.entries(filters).every(([key, expected]) => {
          const actual = getFrontmatterValue(entry.frontmatter, key);
          return actual.found && frontmatterValuesEqual(actual.value, expected);
        });
        if (!matches) continue;
        if (skipped > 0) {
          skipped -= 1;
          continue;
        }
        pageCandidates.push({ path: entry.path, frontmatter: entry.frontmatter });
        if (pageCandidates.length > limit) break;
      }
      const truncated = pageCandidates.length > limit;
      const selected = pageCandidates.slice(0, limit);
      const nextCursor = truncated ? cursorForQueryNote(selected[selected.length - 1]!, sortBy) : undefined;
      if (params.includeContent) {
        const withContent = await Promise.all(selected.map(async note => {
          try {
            const raw = await this.vaultIo.readUtf8(this.resolvePath(note.path));
            return { ...note, content: this.frontmatterHandler.parse(raw).content };
          } catch {
            return undefined;
          }
        }));
        return {
          notes: withContent.filter((note): note is QueryNote & { content: string } => note !== undefined),
          total: -1,
          totalKnown: false,
          truncated,
          ...(nextCursor ? { nextCursor } : {}),
        };
      }
      return {
        notes: selected,
        total: -1,
        totalKnown: false,
        truncated,
        ...(nextCursor ? { nextCursor } : {}),
      };
    }
    if (indexedEntries) {
      for (const entry of indexedEntries) {
        if (!this.pathFilter.isAllowed(entry.path) || !canAccessPath(entry.path)) continue;
        if (pathPrefix && entry.path !== pathPrefix && !entry.path.startsWith(`${pathPrefix}/`)) continue;
        const matches = Object.entries(filters).every(([key, expected]) => {
          const actual = getFrontmatterValue(entry.frontmatter, key);
          return actual.found && frontmatterValuesEqual(actual.value, expected);
        });
        if (matches) notes.push({ path: entry.path, frontmatter: entry.frontmatter });
      }
    } else {
      const notePaths = (await this.collectVaultFiles())
        .filter(path => this.pathFilter.isAllowed(path))
        .filter(canAccessPath)
        .filter(path => /\.(?:md|markdown|txt)$/i.test(path))
        .filter(path => !pathPrefix || path === pathPrefix || path.startsWith(`${pathPrefix}/`))
        .sort((a, b) => a.localeCompare(b));

      for (const path of notePaths) {
        let raw: string;
        try {
          raw = await readFile(this.resolvePath(path), 'utf-8');
        } catch {
          continue;
        }

        const parsed = this.frontmatterHandler.parse(raw);
        const matches = Object.entries(filters).every(([key, expected]) => {
          const actual = getFrontmatterValue(parsed.frontmatter, key);
          return actual.found && frontmatterValuesEqual(actual.value, expected);
        });
        if (matches) notes.push({ path, frontmatter: parsed.frontmatter, ...(params.includeContent && { content: parsed.content }) });
      }
    }

    const afterNotes = params.after
      ? notes.filter(note => compareQueryNoteToCursor(note, params.after!, sortBy, sortOrder) > 0)
      : notes;
    const selected = indexedEntries
      ? afterNotes.slice(requestedOffset, requestedOffset + limit)
      : selectSortedNotes(afterNotes, sortBy, sortOrder, requestedOffset, limit);
    const truncated = requestedOffset + limit < afterNotes.length;
    const nextCursor = selected.length > 0 && truncated ? cursorForQueryNote(selected[selected.length - 1]!, sortBy) : undefined;
    if (params.includeContent && indexedEntries) {
      const withContent = await Promise.all(selected.map(async note => {
        try {
            const raw = await this.vaultIo.readUtf8(this.resolvePath(note.path));
          return { ...note, content: this.frontmatterHandler.parse(raw).content };
        } catch {
          return undefined;
        }
      }));
      return {
        notes: withContent.filter((note): note is QueryNote & { content: string } => note !== undefined),
        total: notes.length,
        truncated,
        ...(nextCursor ? { nextCursor } : {}),
      };
    }
    return {
      notes: selected,
      total: notes.length,
      truncated,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  /** Count metadata rows without reading note bodies; used by bounded windows. */
  async countNotes(
    params: QueryNotesParams = {},
    canAccessPath: (path: string) => boolean = () => true,
    predicate: (note: QueryNote) => boolean = () => true,
  ): Promise<number> {
    const pathPrefix = this.resolvePathPrefix(params.pathPrefix);
    if (this.metadataIndex) {
      return this.metadataIndex.count(params.filters || {}, pathPrefix, canAccessPath, entry => predicate({ path: entry.path, frontmatter: entry.frontmatter }));
    }
    const result = await this.queryNotes({ ...params, limit: 1, includeContent: false, includeTotal: true }, canAccessPath);
    return result.total;
  }
}
