import { guidanceError, guidanceText } from './guidance-runtime.js';
import { join, resolve, relative, dirname, posix } from 'path';
import { homedir } from 'os';
import { readdir, stat, readFile, writeFile, unlink, mkdir, access, rename, copyFile, open } from 'node:fs/promises';
import { constants, lstatSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import trash from 'trash';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { assertRoleplayMutationBoundary } from './roleplay-boundary.js';
import { assertSkillEvolutionMutationBoundary } from './skill-evolution-boundary.js';
import { assertStoryMutationBoundary } from './story-boundary.js';
import { assertResourceBundleMutationBoundary } from './resource-bundle.js';
import { assertOriginalMutation, isOriginalPath } from './original-boundary.js';
import { generateObsidianUri } from './uri.js';
import type { ParsedNote, DirectoryListing, NoteWriteParams, DeleteNoteParams, DeleteResult, DeleteNotePreviewParams, DeleteNotePreviewResult, MoveNoteParams, MoveNotePreviewParams, MoveNotePreviewResult, MoveFileParams, MoveResult, BatchReadParams, BatchReadResult, UpdateFrontmatterParams, NoteInfo, TagManagementParams, TagManagementResult, PatchNoteParams, PatchNoteResult, PatchMultipleNotesParams, PatchMultipleNotesResult, NoteChangeSetResultItem, VaultStats, NoteHeading, ReadNoteLinesParams, BacklinksResult, OutlinksResult, UnresolvedLinksResult, OrphanNotesResult, DailyNoteResult, ListTasksParams, ListTasksResult, TaskItem, UpdateTaskParams, UpdateTaskResult, QueryNotesParams, QueryNotesResult, QueryNote, QueryNotesCursor, AuthorityShelfResult } from './types.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { buildDailyNotePath, resolveDailyDate, type DailyDateInput } from './daily.js';
import type { VaultMetadataIndex } from './vault-index.js';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultIoCoordinator } from './vault-io.js';
import { buildNoteReferenceIndex, markdownNotePath, noteReferenceDocument, resolveNoteReference, type NoteReferenceDescriptor, type NoteReferenceIndex, type ResolveNoteReferenceOptions } from './note-reference.js';
import { validateJsonCanvasDocument } from './json-canvas.js';
import { acceptsPlainReference, isReferenceSnapshotPath, propertyPathText } from './property-references.js';
import { assertLegacyDiscussionMutationAllowed, ScopeAccessPolicy } from './scope-access.js';
import { assertEnterpriseStorageAccess, assertEnterpriseStorageFresh, canReadEnterpriseStoragePath, canTraverseEnterpriseStoragePath, prepareDocumentWrite } from './enterprise-storage-context.js';
import { expandScopePath, parseScopePath, scopeRoot } from './scopes.js';
import { extractMarkdownTasks, iterateMarkdownTasks } from './markdown-tasks.js';
import { extractInlineTags } from './markdown-tags.js';
import { isModerationHidden } from './moderation-policy.js';
import { projectNoteOutline, projectNoteLineWindow } from './note-projections.js';
import { isMissingVaultPath, QuerySnapshotChangedError, VaultReadUnavailableError } from './vault-read-errors.js';
import { readBoundedSource, SourceReadLimitError } from './bounded-source-read.js';
import { packQueryPage, type PackedQueryPage } from './query-page.js';
import { assertMemoryContent } from './memory-contract.js';
import { assertContextRulesContent } from './context-rules.js';

/** Hard per-note write limit so stdio callers cannot exhaust the vault disk. */
export const MAX_NOTE_CONTENT_BYTES = 8 * 1024 * 1024;
/** Health scans never load arbitrarily large derived views into memory. */
export const MAX_DERIVED_VIEW_READ_BYTES = 512 * 1024;

function assertNoteContentSize(content: string, path: string): void {
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_NOTE_CONTENT_BYTES) {
    throw guidanceError(new Error(`Note exceeds ${MAX_NOTE_CONTENT_BYTES} bytes: ${path}`), 'guid-345d58e81bbde0e8');
  }
  assertMemoryContent(content, path);
  assertContextRulesContent(content);
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

function normalizeNoteTarget(path: string): string {
  // Callers compare resolved physical paths, not extensionless link names.
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
}

function rewriteLinkText(link: string, sourcePath: string, newPath: string): string {
  if (link.includes('[[')) {
    const prefix = link.startsWith('!') ? '![[' : '[[';
    const inner = link.slice(prefix.length, -2);
    const anchorOrAlias = inner.search(/[|#]/);
    const suffix = anchorOrAlias === -1 ? '' : inner.slice(anchorOrAlias);
    const relativeTarget = posix.relative(posix.dirname(sourcePath), newPath);
    const target = newPath.includes('/') ? newPath
      : /^\.\.?\//.test(relativeTarget) ? relativeTarget : `./${relativeTarget}`;
    return `${prefix}${target}${suffix}]]`;
  }
  const markdown = /^(\[[^\]]*\]\(\s*<?)([^>\s)]+)(.*)$/s.exec(link);
  if (!markdown) return link;
  const relativeDestination = relative(dirname(sourcePath), newPath).replace(/\\/g, '/') || newPath;
  const destination = posix.dirname(sourcePath) !== '.' && relativeDestination.includes('/') && !relativeDestination.startsWith('../')
    ? `./${relativeDestination}` : relativeDestination;
  const rawTarget = markdown[2]!;
  const suffixAt = [rawTarget.indexOf('?'), rawTarget.indexOf('#')].filter(index => index >= 0).sort((a, b) => a - b)[0];
  const suffix = suffixAt === undefined ? '' : rawTarget.slice(suffixAt);
  const wrappedDestination = /<$/.test(markdown[1]!)
    ? `${destination}${suffix}`
    : /\s/.test(destination) ? `<${destination}${suffix}>` : `${destination}${suffix}`;
  return `${markdown[1]}${wrappedDestination}${markdown[3]}`;
}

type MoveDirection = 'inbound' | 'outgoing' | 'self';

interface MoveLinkChange {
  sourcePath: string;
  line: number;
  link: string;
  replacement: string;
  context: string;
  direction: MoveDirection;
  heading?: string;
  targetHeading?: string;
  targetBlockId?: string;
}

interface MovePropertyChange {
  sourcePath: string;
  propertyPath: string;
  value: string;
  replacement: string;
  direction: MoveDirection;
}

interface AmbiguousMoveReference {
  sourcePath: string;
  value: string;
  candidates: string[];
  line?: number;
  propertyPath?: string;
}

interface MoveReferenceRewritePlan {
  content: string;
  linkChanges: MoveLinkChange[];
  propertyChanges: MovePropertyChange[];
  ambiguous: AmbiguousMoveReference[];
}

function frontmatterEndLine(content: string): number {
  const lines = content.split('\n');
  if (lines[0]?.replace(/\r$/, '') !== '---') return 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.replace(/\r$/, '') === '---') return index + 1;
  }
  return 0;
}

function isWikiSyntax(link: string): boolean {
  return link.startsWith('[[') || link.startsWith('![[');
}

function resolveMarkdownLinkTargets(target: string, sourcePath: string, referenceIndex: NoteReferenceIndex): string[] {
  return resolveNoteReference(target, referenceIndex, { sourcePath, syntax: 'markdown' });
}

function resolveOccurrenceTargets(link: string, target: string, sourcePath: string, referenceIndex: NoteReferenceIndex): string[] {
  return isWikiSyntax(link)
    ? resolveNoteReference(target, referenceIndex, { sourcePath })
    : resolveMarkdownLinkTargets(target, sourcePath, referenceIndex);
}

function moveDirection(sourcePath: string, oldPath: string, targetPath: string): MoveDirection {
  const sourceIsMoved = normalizeNoteTarget(sourcePath) === normalizeNoteTarget(oldPath);
  const targetIsMoved = normalizeNoteTarget(targetPath) === normalizeNoteTarget(oldPath);
  return sourceIsMoved && targetIsMoved ? 'self' : sourceIsMoved ? 'outgoing' : 'inbound';
}

function rewriteExplicitLinks(
  content: string,
  sourcePath: string,
  renderedSourcePath: string,
  oldPath: string,
  newPath: string,
  referenceIndex: NoteReferenceIndex,
  lineOffset = 0,
): { content: string; changes: MoveLinkChange[]; ambiguous: AmbiguousMoveReference[] } {
  const lines = content.split('\n');
  const changes: MoveLinkChange[] = [];
  const ambiguous: AmbiguousMoveReference[] = [];
  const occurrences = extractObsidianLinkOccurrences(content).sort((a, b) => a.line - b.line);
  const byLine = new Map<number, typeof occurrences>();
  const replacements = new Map<(typeof occurrences)[number], string>();
  for (const occurrence of occurrences) {
    let targets = resolveOccurrenceTargets(occurrence.link, occurrence.target, sourcePath, referenceIndex);
    const sourceIsMoved = normalizeNoteTarget(sourcePath) === normalizeNoteTarget(oldPath);
    const sourceLocationChanged = sourceIsMoved && posix.dirname(sourcePath) !== posix.dirname(renderedSourcePath);
    const sourceRelative = !isWikiSyntax(occurrence.link) || /^\.\.?\//.test(occurrence.target);
    const includesMovedTarget = targets.some(target => normalizeNoteTarget(target) === normalizeNoteTarget(oldPath));
    if (targets.length > 1 && (includesMovedTarget || (sourceLocationChanged && sourceRelative))) {
      ambiguous.push({ sourcePath, value: occurrence.link, candidates: targets, line: occurrence.line + lineOffset });
      continue;
    }
    if (!targets.length && sourceLocationChanged && sourceRelative) {
      const intendedTarget = markdownNotePath(occurrence.target, sourcePath);
      if (!intendedTarget) throw guidanceError(new Error('Cannot preserve an out-of-vault relative destination during source relocation; repair the link before moving.'), 'guid-fa8f8ccca118be66');
      // Preserve the authored location even before the future note exists.
      // Otherwise a new sibling at the destination could silently take over.
      targets = [intendedTarget];
    }
    if (targets.length !== 1) continue;
    const targetPath = targets[0]!;
    const targetIsMoved = normalizeNoteTarget(targetPath) === normalizeNoteTarget(oldPath);
    if (!targetIsMoved && !(sourceLocationChanged && sourceRelative)) continue;
    const renderedTarget = targetIsMoved ? newPath : targetPath;
    const replacement = rewriteLinkText(occurrence.link, renderedSourcePath, renderedTarget);
    if (replacement === occurrence.link) continue;
    changes.push({
      sourcePath,
      line: occurrence.line + lineOffset,
      link: occurrence.link,
      replacement,
      context: occurrence.context,
      direction: moveDirection(sourcePath, oldPath, targetPath),
      ...(occurrence.heading && { heading: occurrence.heading }),
      ...(occurrence.targetHeading && { targetHeading: occurrence.targetHeading }),
      ...(occurrence.targetBlockId && { targetBlockId: occurrence.targetBlockId }),
    });
    replacements.set(occurrence, replacement);
    byLine.set(occurrence.line, [...(byLine.get(occurrence.line) || []), occurrence]);
  }
  for (const [lineNumber, lineOccurrences] of byLine) {
    let line = lines[lineNumber - 1] || '';
    let cursor = 0;
    for (const occurrence of lineOccurrences) {
      const offset = line.indexOf(occurrence.link, cursor);
      if (offset === -1) continue;
      const replacement = replacements.get(occurrence);
      if (!replacement) continue;
      line = `${line.slice(0, offset)}${replacement}${line.slice(offset + occurrence.link.length)}`;
      cursor = offset + replacement.length;
    }
    lines[lineNumber - 1] = line;
  }
  return { content: lines.join('\n'), changes, ambiguous };
}

function rewritePlainReference(value: string, sourcePath: string, renderedSourcePath: string, oldPath: string, newPath: string, referenceIndex: NoteReferenceIndex, snapshotPath = false): { replacement?: string; candidates?: string[]; targetPath?: string } {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#')) return {};
  const suffixAt = [trimmed.indexOf('?'), trimmed.indexOf('#')].filter(index => index >= 0).sort((a, b) => a - b)[0];
  const authoredDocument = suffixAt === undefined ? trimmed : trimmed.slice(0, suffixAt);
  let scoped: ReturnType<typeof parseScopePath>;
  let document = authoredDocument;
  try {
    scoped = snapshotPath && /^scope:\/\/(?:global|community|model|agent)\//i.test(authoredDocument)
      ? parseScopePath(authoredDocument) : undefined;
    if (scoped) document = expandScopePath(authoredDocument);
  } catch {
    // Scans include inaccessible checkpoints. Never echo their URI or parse error.
    throw guidanceError(new Error('Cannot validate a captured scope reference; repair malformed checkpoint metadata before retrying.'), 'guid-d5fa39f97012ea1b');
  }
  // Only the server's own community spellings are registered in this index.
  // A foreign command-center URI must never bind to a same-path local note.
  if (scoped?.kind === 'community' && !referenceIndex.exact.has(authoredDocument.toLowerCase())) return {};
  if (!scoped && /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return {};
  const suffix = suffixAt === undefined ? '' : trimmed.slice(suffixAt);
  let targets = snapshotPath
    ? normalizeNoteTarget(document) === normalizeNoteTarget(oldPath) ? [oldPath] : []
    : resolveNoteReference(document, referenceIndex, { sourcePath });
  const sourceRelative = !snapshotPath && /^\.\.?\//.test(document);
  const relocatingRelative = sourceRelative && normalizeNoteTarget(sourcePath) === normalizeNoteTarget(oldPath)
    && posix.dirname(sourcePath) !== posix.dirname(renderedSourcePath);
  const includesMovedTarget = targets.some(target => normalizeNoteTarget(target) === normalizeNoteTarget(oldPath));
  if (targets.length > 1 && (includesMovedTarget || relocatingRelative)) return { candidates: targets };
  if (!targets.length && relocatingRelative) {
    const intendedTarget = markdownNotePath(document, sourcePath);
    if (!intendedTarget) throw guidanceError(new Error('Cannot preserve an out-of-vault relative Property destination during source relocation; repair the reference before moving.'), 'guid-7d8acccdd6a70656');
    targets = [intendedTarget];
  }
  if (targets.length !== 1 || (!includesMovedTarget && !relocatingRelative)) return {};
  const targetPath = targets[0]!;
  const renderedTarget = includesMovedTarget ? newPath : targetPath;
  const relativeTarget = posix.relative(posix.dirname(renderedSourcePath), renderedTarget);
  let destination = snapshotPath ? renderedTarget : sourceRelative || !renderedTarget.includes('/')
    ? /^\.\.?\//.test(relativeTarget) ? relativeTarget : `./${relativeTarget}`
    : renderedTarget;
  if (scoped) {
    const root = scopeRoot(scoped.kind, scoped.id);
    if (root ? !renderedTarget.toLowerCase().startsWith(`${root.toLowerCase()}/`) : /^(?:_scopes|_whispers|Community)(?:\/|$)/i.test(renderedTarget)) {
      throw guidanceError(new Error('Move would change a captured reference scope; update the checkpoint explicitly before moving across scopes.'), 'guid-45f31fcbf77694c8');
    }
    const logical = root ? renderedTarget.slice(root.length + 1) : renderedTarget;
    destination = `scope://${scoped.kind}/${scoped.id ? `${scoped.id}/` : ''}${logical}`;
  }
  const keepExtension = /\.(?:md|markdown|txt)$/i.test(document);
  const leading = value.slice(0, value.length - value.trimStart().length);
  const trailing = value.slice(value.trimEnd().length);
  return { replacement: `${leading}${keepExtension ? destination : destination.replace(/\.(?:md|markdown|txt)$/i, '')}${suffix}${trailing}`, targetPath };
}

function rewriteFrontmatterReferences(
  frontmatter: Record<string, any>,
  sourcePath: string,
  renderedSourcePath: string,
  oldPath: string,
  newPath: string,
  referenceIndex: NoteReferenceIndex,
): { updates: Record<string, any>; changes: MovePropertyChange[]; ambiguous: AmbiguousMoveReference[] } {
  const changes: MovePropertyChange[] = [];
  const ambiguous: AmbiguousMoveReference[] = [];

  const visit = (value: unknown, segments: Array<string | number>): unknown => {
    if (typeof value === 'string') {
      const explicit = rewriteExplicitLinks(value, sourcePath, renderedSourcePath, oldPath, newPath, referenceIndex);
      if (explicit.ambiguous.length > 0) {
        ambiguous.push(...explicit.ambiguous.map(({ line: _line, ...item }) => ({ ...item, propertyPath: propertyPathText(segments) })));
      }
      if (explicit.changes.length > 0) {
        changes.push({
          sourcePath,
          propertyPath: propertyPathText(segments),
          value,
          replacement: explicit.content,
          direction: explicit.changes[0]!.direction,
        });
        return explicit.content;
      }
      if (!acceptsPlainReference(segments)) return value;
      const plain = rewritePlainReference(value, sourcePath, renderedSourcePath, oldPath, newPath, referenceIndex, isReferenceSnapshotPath(segments));
      if (plain.candidates) {
        ambiguous.push({ sourcePath, propertyPath: propertyPathText(segments), value, candidates: plain.candidates });
        return value;
      }
      if (!plain.replacement || plain.replacement === value) return value;
      changes.push({ sourcePath, propertyPath: propertyPathText(segments), value, replacement: plain.replacement, direction: moveDirection(sourcePath, oldPath, plain.targetPath!) });
      return plain.replacement;
    }
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item, index) => {
        const rewritten = visit(item, [...segments, index]);
        changed ||= rewritten !== item;
        return rewritten;
      });
      return changed ? next : value;
    }
    if (value && typeof value === 'object') {
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const rewritten = visit(item, [...segments, key]);
        changed ||= rewritten !== item;
        next[key] = rewritten;
      }
      return changed ? next : value;
    }
    return value;
  };

  const updates: Record<string, any> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    const rewritten = visit(value, [key]);
    if (rewritten !== value) updates[key] = rewritten;
  }
  return { updates, changes, ambiguous };
}

function planMoveReferenceRewrite(
  handler: FrontmatterHandler,
  content: string,
  sourcePath: string,
  oldPath: string,
  newPath: string,
  referenceIndex: NoteReferenceIndex,
): MoveReferenceRewritePlan {
  const renderedSourcePath = normalizeNoteTarget(sourcePath) === normalizeNoteTarget(oldPath) ? newPath : sourcePath;
  const matterEnd = frontmatterEndLine(content);
  const body = matterEnd > 0 ? content.split('\n').slice(matterEnd).join('\n') : content;
  const bodyRewrite = rewriteExplicitLinks(body, sourcePath, renderedSourcePath, oldPath, newPath, referenceIndex, matterEnd);
  const parsed = handler.parse(content);
  const properties = rewriteFrontmatterReferences(parsed.frontmatter, sourcePath, renderedSourcePath, oldPath, newPath, referenceIndex);
  let rewritten = bodyRewrite.content;
  if (matterEnd > 0) {
    rewritten = Object.keys(properties.updates).length > 0
      ? handler.preserveStringify(parsed.matter || '', properties.updates, bodyRewrite.content)
      : `${content.split('\n').slice(0, matterEnd).join('\n')}\n${bodyRewrite.content}`;
  } else if (Object.keys(properties.updates).length > 0) {
    rewritten = handler.stringify({ ...parsed.frontmatter, ...properties.updates }, bodyRewrite.content);
  }
  return {
    content: rewritten,
    linkChanges: bodyRewrite.changes,
    propertyChanges: properties.changes,
    ambiguous: [...bodyRewrite.ambiguous, ...properties.ambiguous],
  };
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
      return guidanceError(new Error(`No space left on device: ${path}`), 'guid-2156b01b19e5b50a');
    case 'EACCES':
    case 'EPERM':
      return guidanceError(new Error(`Permission denied: ${path}`), 'guid-4e82fdc66a0fe90a');
    case 'EROFS':
      return guidanceError(new Error(`Read-only filesystem: ${path}`), 'guid-23895fc069348c46');
  }
  // No filesystem code: an error we raised with a clear message (path
  // traversal, validation, etc.). Preserve it as-is.
  if (error instanceof Error && !code) {
    return error;
  }
  return guidanceError(new Error(`Failed to write file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`), 'guid-cac65beae0b9fc04');
}

// Short mutation locks are shared by every service instance for a real Vault.
// This is process-local coordination, not a cross-process transaction promise.
const vaultMutationTails = new Map<string, Promise<void>>();
// Cooperation is opt-in: generic note/Obsidian writers do not participate, so
// this coordinates only callers that wrap their whole workflow with this API.
const skillTransactionTails = new Map<string, Promise<void>>();
const RESERVED_SKILL_LOCK_IDS = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SKILL_LOCK_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

export class FileSystemService {
  private frontmatterHandler: FrontmatterHandler;
  private pathFilter: PathFilter;
  private readonly mutationTails = vaultMutationTails;
  private readonly noteChangeObservers = new Set<(path: string) => void>();

  /** Request-local invalidation observers; call the disposer in finally. */
  observeNoteChanges(observer: (path: string) => void): () => void {
    this.noteChangeObservers.add(observer);
    return () => { this.noteChangeObservers.delete(observer); };
  }

  /** Internal comparison identity shared with mutation locks; never a display path. */
  noteChangeIdentity(path: string): string { return this.mutationLockKey(path); }

  private notifyNoteChanged(path: string, kind: 'upsert' | 'delete'): void {
    for (const observer of this.noteChangeObservers) {
      try { observer(path); } catch { /* An observer cannot change a write's result. */ }
    }
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
    return this.withMutationLockKey(this.mutationLockKey(path), operation);
  }

  /** Lock identity only; never use this folded key for access checks or IO. */
  private mutationLockKey(path: string): string {
    return resolve(this.vaultPath, this.normalizePath(path).replace(/\\/g, '/')).toLowerCase();
  }

  private async withMutationLockKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolveLock => { release = resolveLock; });
    this.mutationTails.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationTails.get(key) === current) this.mutationTails.delete(key);
    }
  }

  /** Acquire several note locks in one stable order so reciprocal edits cannot deadlock. */
  private async withMutationLocks<T>(paths: string[], operation: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(paths.map(path => this.mutationLockKey(path)))].sort();
    const acquire = async (index: number): Promise<T> => index >= ordered.length
      ? operation()
      : this.withMutationLockKey(ordered[index]!, () => acquire(index + 1));
    return acquire(0);
  }

  /**
   * Cooperatively serialize one complete skill-evolution workflow. This is not
   * a transaction over generic note or Obsidian writers that do not use it.
   */
  async withSkillTransaction<T>(skillId: string, operation: () => Promise<T>): Promise<T> {
    if (!SKILL_LOCK_ID.test(skillId) || RESERVED_SKILL_LOCK_IDS.test(skillId)) {
      throw guidanceError(new Error('Invalid skill transaction skill ID.'), 'guid-bad9384933b91750');
    }
    const key = this.skillTransactionKey(skillId);
    const previous = skillTransactionTails.get(key) || Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>(resolveLock => { releaseQueue = resolveLock; });
    skillTransactionTails.set(key, current);
    await previous;
    try {
      return await this.withSkillLockFile(skillId, operation);
    } finally {
      releaseQueue();
      if (skillTransactionTails.get(key) === current) skillTransactionTails.delete(key);
    }
  }

  private skillTransactionKey(skillId: string): string {
    let canonicalVault = this.vaultPath;
    try { canonicalVault = realpathSync(this.vaultPath); } catch { /* Lock acquisition fails closed later. */ }
    if (process.platform === 'win32') canonicalVault = canonicalVault.toLowerCase();
    return `${canonicalVault}\0${skillId}`;
  }

  private assertSkillLockDirectory(vaultRoot: string, path: string): void {
    const entry = lstatSync(path);
    const pathReal = realpathSync(path);
    const pathRelative = relative(vaultRoot, pathReal);
    if (!entry.isDirectory() || entry.isSymbolicLink()
      || pathRelative === '..'
      || pathRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      || resolve(vaultRoot, pathRelative) !== resolve(pathReal)) {
      throw guidanceError(new Error('Skill transaction lock containment could not be verified.'), 'guid-6f18cfc09262bf64');
    }
  }

  private async createOrVerifySkillLockDirectory(vaultRoot: string, path: string): Promise<void> {
    try {
      this.assertSkillLockDirectory(vaultRoot, path);
      return;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
    }
    try {
      await mkdir(path);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST')) throw error;
    }
    this.assertSkillLockDirectory(vaultRoot, path);
  }

  private async withSkillLockFile<T>(skillId: string, operation: () => Promise<T>): Promise<T> {
    const lockDirectoryRelative = '.mcpvault/skill-locks';
    assertEnterpriseStorageAccess(lockDirectoryRelative, true);
    const vaultRoot = realpathSync(this.vaultPath);
    if (resolve(vaultRoot) !== resolve(this.vaultPath) || lstatSync(this.vaultPath).isSymbolicLink()) {
      throw guidanceError(new Error('Skill transaction vault containment could not be verified.'), 'guid-82cf6483992998eb');
    }

    const lockRoot = join(this.vaultPath, '.mcpvault');
    const lockDirectory = join(lockRoot, 'skill-locks');
    await this.createOrVerifySkillLockDirectory(vaultRoot, lockRoot);
    await this.createOrVerifySkillLockDirectory(vaultRoot, lockDirectory);

    const lockPath = join(lockDirectory, `${skillId}.lock`);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, 'wx');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw guidanceError(new Error('Skill transaction is busy; retry later.'), 'guid-c2269e77bfe61c79');
      }
      throw guidanceError(new Error('Skill transaction lock could not be acquired.'), 'guid-308e9594883a82e4');
    }

    // This is an opaque, non-secret ownership marker. It is not an authority
    // credential; it only avoids treating unstable SMB/NFS dev/inode values as
    // the sole ownership proof during best-effort cooperative cleanup.
    const ownershipMarker = randomUUID();
    try {
      await handle.writeFile(ownershipMarker, 'utf8');
    } catch {
      await handle.close();
      throw guidanceError(new Error('Skill transaction lock could not be initialized.'), 'guid-69c186a3c052674b');
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      try {
        this.assertSkillLockDirectory(vaultRoot, lockRoot);
        this.assertSkillLockDirectory(vaultRoot, lockDirectory);
        const current = lstatSync(lockPath);
        if (current.isSymbolicLink() || !current.isFile()) throw guidanceError(new Error('lock replacement'), 'guid-627f17a9e181730c');
        // lstat prevents following a replacement symlink. A close-to-unlink
        // race remains outside this cooperative, non-hostile lock boundary.
        if (await readFile(lockPath, 'utf8') !== ownershipMarker) throw guidanceError(new Error('lock replacement'), 'guid-627f17a9e181730c');
        await unlink(lockPath);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
          throw guidanceError(new Error('Skill transaction lock could not be released.'), 'guid-cdaac20482eb59de');
        }
      }
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
    private readonly scopeAccess = new ScopeAccessPolicy(),
    private readonly assertNoticeMutation: (path: string) => void = () => {},
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

  private normalizeReferenceMutationPath(inputPath: string): string {
    // Structural moves/deletes must compare the same lexical path used by IO.
    // Do not change authored response spellings for unrelated operations.
    const separated = this.normalizePath(inputPath).replace(/\\/g, '/');
    return !separated || separated.startsWith('//') ? separated : posix.normalize(separated);
  }

  /** Existing reference identity, after normal path and realpath containment
   * checks. Callers must authorize this canonical path before reading content. */
  canonicalReferencePath(path: string): string {
    const full = this.resolvePath(path);
    return relative(this.vaultPath, realpathSync(full)).replace(/\\/g, '/');
  }

  private resolvePath(relativePath: string): string {
    const normalizedPath = this.normalizePath(relativePath);

    const fullPath = resolve(join(this.vaultPath, normalizedPath));

    // Security check: ensure path is within vault (lexical)
    const relativeToVault = relative(this.vaultPath, fullPath);
    if (relativeToVault.startsWith('..')) {
      throw guidanceError(new Error(`Path traversal not allowed: ${relativePath}. Paths must be within the vault directory.`), 'guid-6eda287a313aac90');
    }

    // Security check: ensure symlinks don't escape vault boundary
    try {
      const realPath = realpathSync(fullPath);
      const realRelative = relative(this.vaultPath, realPath);
      if (realRelative.startsWith('..')) {
        throw guidanceError(new Error(`Symlink target is outside vault: ${relativePath}. Symbolic links must resolve to a path within the vault directory.`), 'guid-0978cbb142f8f6c4');
      }
      const canonicalRelative = realRelative.replace(/\\/g, '/');
      if (!this.pathFilter.isAllowedForListing(canonicalRelative)) {
        throw guidanceError(new Error(`Access denied: ${relativePath}. Its canonical target is restricted.`), 'guid-22315a8b4963c206');
      }
      if (lstatSync(realPath).isDirectory()) {
        if (!canTraverseEnterpriseStoragePath(canonicalRelative || '.')) throw new Error('Access denied: directory traversal unavailable');
      } else {
        assertEnterpriseStorageAccess(canonicalRelative);
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
              throw guidanceError(new Error(`Symlink target is outside vault: ${relativePath}. Symbolic links must resolve to a path within the vault directory.`), 'guid-0978cbb142f8f6c4');
            }
            const canonicalParent = parentRelative.replace(/\\/g, '/');
            if (!this.pathFilter.isAllowedForListing(canonicalParent)) {
              throw guidanceError(new Error(`Access denied: ${relativePath}. Its canonical parent is restricted.`), 'guid-33e0fae467973725');
            }
            if (!canTraverseEnterpriseStoragePath(canonicalParent || '.')) throw new Error('Access denied: directory traversal unavailable');
          } catch (parentErr: unknown) {
            // Parent doesn't exist either (will be created by mkdir). Lexical check above is sufficient.
            if (parentErr instanceof Error && parentErr.message.includes('outside vault')) {
              throw parentErr;
            }
          }
        } else if (code === 'ELOOP') {
          throw guidanceError(new Error(`Circular symlink detected: ${relativePath}. The symbolic link chain forms a loop.`), 'guid-66290616fb8a2a25');
        } else if (code === 'EACCES') {
          throw guidanceError(new Error(`Permission denied resolving symlink: ${relativePath}. Cannot verify the symbolic link target is within the vault.`), 'guid-64a1de2d5f78cf2b');
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
  private resolveWritablePath(relativePath: string, exclusiveOriginalCreation = false): string {
    const fullPath = this.resolvePath(relativePath);
    const relativePathToVault = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
    assertOriginalMutation(relativePathToVault, exclusiveOriginalCreation);
    assertRoleplayMutationBoundary(relativePathToVault);
    assertSkillEvolutionMutationBoundary(relativePathToVault);
    assertStoryMutationBoundary(relativePathToVault);
    assertResourceBundleMutationBoundary(relativePathToVault);
    this.assertNoticeMutation(relativePathToVault);
    assertEnterpriseStorageAccess(relativePathToVault, true);
    // Guard the canonical vault-relative destination for every service write,
    // including absolute input paths and indirectly rewritten backlinks. This
    // is legacy-only: immutable source ingestion still needs filesystem writes.
    // Ancestors are protected too so moves cannot relocate the historical tree.
    assertLegacyDiscussionMutationAllowed(relativePathToVault, 'Filesystem mutation', true);
    let current = this.vaultPath;
    for (const component of relativePathToVault.split(/[\\/]+/).filter(Boolean)) {
      current = join(current, component);
      try {
        if (lstatSync(current).isSymbolicLink()) {
          throw guidanceError(new Error(`Symbolic links are not allowed for mutations: ${relativePath}`), 'guid-6866f78b3f983aec');
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Symbolic links are not allowed')) throw error;
        if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
    return fullPath;
  }

  /** Recheck live host notice authority at dispatch, after awaited preparation. */
  private async writeProtectedFile(path: string, content: string | Buffer, options: Parameters<typeof writeFile>[2] = 'utf8') {
    const physicalPath = relative(this.vaultPath, path).replace(/\\/g, '/');
    assertOriginalMutation(physicalPath, typeof options === 'object' && options !== null && 'flag' in options && options.flag === 'wx');
    await prepareDocumentWrite(physicalPath);
    assertEnterpriseStorageAccess(physicalPath, true);
    assertStoryMutationBoundary(physicalPath);
    assertSkillEvolutionMutationBoundary(physicalPath);
    this.assertNoticeMutation(physicalPath);
    return writeFile(path, content, options);
  }
  private async removeProtectedFile(path: string) {
    const physicalPath = relative(this.vaultPath, path).replace(/\\/g, '/');
    assertOriginalMutation(physicalPath);
    assertStoryMutationBoundary(physicalPath);
    assertSkillEvolutionMutationBoundary(physicalPath);
    this.assertNoticeMutation(physicalPath);
    return unlink(path);
  }
  private async renameProtectedFile(from: string, to: string) {
    const sourcePath = relative(this.vaultPath, from).replace(/\\/g, '/');
    const targetPath = relative(this.vaultPath, to).replace(/\\/g, '/');
    assertOriginalMutation(sourcePath);
    assertOriginalMutation(targetPath);
    await prepareDocumentWrite(targetPath);
    assertEnterpriseStorageAccess(sourcePath, true);
    assertEnterpriseStorageAccess(targetPath, true);
    assertStoryMutationBoundary(sourcePath);
    assertStoryMutationBoundary(targetPath);
    assertSkillEvolutionMutationBoundary(sourcePath);
    assertSkillEvolutionMutationBoundary(targetPath);
    this.assertNoticeMutation(sourcePath);
    this.assertNoticeMutation(targetPath);
    return rename(from, to);
  }

  async readNote(path: string, maxBytes?: number): Promise<ParsedNote> {
    return this.withNoteRead(path, async fullPath => {
      const content = maxBytes === undefined
        ? await this.vaultIo.readUtf8(fullPath)
        : await this.vaultIo.readUtf8Bounded(fullPath, maxBytes);
      return { ...this.frontmatterHandler.parse(content), revision: this.revision(content) };
    });
  }

  /** Hash current decoded UTF-8 without parsing. Callers still enforce scope;
   * a revision is not an access grant or a fresh moderation classification. */
  async readNoteRevision(path: string, maxBytes?: number): Promise<string> {
    return this.withNoteRead(path, fullPath => this.vaultIo.readUtf8Revision(fullPath, maxBytes));
  }

  /** Raw image fingerprint only; callers must separately enforce source scope.
   * Do not broaden Markdown parsing or follow aliases into another scope. */
  async readStoryImageRevision(path: string, maxBytes = 8 * 1024 * 1024): Promise<string | undefined> {
    path = this.normalizePath(path);
    if (!/\.(?:png|jpe?g|webp|gif)$/i.test(path)) throw guidanceError(new Error('Unsupported story image extension'), 'guid-a266a4677e9e7e10');
    return this.readStoryBinaryRevision(path, maxBytes);
  }

  /** Managed output hashes use original bytes, including malformed UTF-8. */
  async readStoryOutputRevision(path: string, maxBytes = 8 * 1024 * 1024): Promise<string | undefined> {
    path = this.normalizePath(path);
    if (!/^Community\/Stories\/[a-z0-9][a-z0-9-]{0,63}\/Exports\/[^/]+\.(?:canvas|fountain|output\.md)$/i.test(path)
      || !this.pathFilter.isAllowed(path)) throw guidanceError(new Error('Invalid managed story output path'), 'guid-a3a17abad794a52c');
    return this.readStoryBinaryRevision(path, maxBytes);
  }

  private async readStoryBinaryRevision(path: string, maxBytes: number): Promise<string | undefined> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw guidanceError(new Error('Invalid story image byte limit'), 'guid-071f863f15bc9bbc');
    if (!this.pathFilter.isAllowedForListing(path)) throw guidanceError(new Error('Story image path is restricted'), 'guid-98660a88b15662d1');
    const fullPath = this.resolvePath(path);
    const lexical = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
    assertEnterpriseStorageAccess(lexical);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const canonical = relative(this.vaultPath, realpathSync(fullPath)).replace(/\\/g, '/');
      if (canonical.toLowerCase() !== lexical.toLowerCase()) throw guidanceError(new Error('Story image canonical alias is not permitted'), 'guid-5faaf9b7b21c6248');
      assertEnterpriseStorageAccess(canonical);
      handle = await open(fullPath, 'r');
      const before = await handle.stat();
      if (!before.isFile()) throw guidanceError(new Error('Story image must be a regular file'), 'guid-866e58472ddea6f7');
      if (before.size > maxBytes) throw guidanceError(new Error('Story image exceeds byte budget'), 'guid-d399378dd9215453');
      const hash = createHash('sha256'); let size = 0;
      for (;;) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - size + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > maxBytes) throw guidanceError(new Error('Story image exceeds byte budget'), 'guid-d399378dd9215453');
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw guidanceError(new Error('Story image changed during read'), 'guid-f9ad5110f3ed629b');
      assertEnterpriseStorageAccess(canonical);
      const currentPath = relative(this.vaultPath, realpathSync(fullPath)).replace(/\\/g, '/');
      if (currentPath.toLowerCase() !== canonical.toLowerCase()) throw guidanceError(new Error('Story image canonical path changed'), 'guid-1a5516a0e9d90e67');
      return hash.digest('hex');
    } catch (error) {
      if (!handle && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    } finally { await handle?.close(); }
  }

  private async withNoteRead<T>(path: string, read: (fullPath: string) => Promise<T>): Promise<T> {
    path = this.normalizePath(path);
    const fullPath = this.resolvePath(path);
    const physicalPath = relative(this.vaultPath, fullPath).replace(/\\/g, '/');
    assertEnterpriseStorageAccess(physicalPath);

    if (!this.pathFilter.isAllowed(path)) {
      throw guidanceError(new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
    }

    // Reuse this call's checked path: no await occurs between resolvePath and
    // the directory probe. Public isDirectory still validates its own input.
    const isDir = await this.isResolvedDirectory(fullPath);
    if (isDir) {
      throw guidanceError(new Error(`Cannot read directory as file: ${path}. Use list_directory tool instead.`), 'guid-6dac95374869d668');
    }

    try {
      assertEnterpriseStorageAccess(physicalPath);
      const result = await read(fullPath);
      assertEnterpriseStorageAccess(physicalPath);
      return result;
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          throw guidanceError(new Error(`File not found: ${path}. Use list_directory to see available files, or check the path spelling.`, { cause: error }), 'guid-68e52acda57ed943');
        }
        if (error.code === 'EACCES') {
          throw guidanceError(new Error(`Permission denied: ${path}. The file exists but cannot be read due to filesystem permissions.`), 'guid-7d3f473659ed9e52');
        }
        if (error.code === 'EISDIR') {
          throw guidanceError(new Error(`Cannot read directory as file: ${path}. Use list_directory tool instead.`), 'guid-6dac95374869d668');
        }
      }
      throw guidanceError(new Error(`Failed to read file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error }), 'guid-0839d2dc671a1032');
    }
  }

  async noteExists(path: string): Promise<boolean> {
    path = this.normalizePath(path);
    if (!this.pathFilter.isAllowed(path)) return false;
    if (!canReadEnterpriseStoragePath(path)) return false;
    try {
      return (await stat(this.resolvePath(path))).isFile();
    } catch (error) {
      if (isMissingVaultPath(error)) return false;
      throw new VaultReadUnavailableError();
    }
  }

  private async assertExpectedRevision(path: string, expectedRevision?: string, maxBytes?: number): Promise<void> {
    if (!expectedRevision) return;
    const exists = await this.noteExists(path);
    if (expectedRevision === 'missing') {
      if (exists) throw guidanceError(new Error(`Revision conflict for ${path}: expected a new note, but it already exists`), 'guid-e56077192c6f6fe9');
      return;
    }
    if (!exists) throw guidanceError(new Error(`Revision conflict for ${path}: expected ${expectedRevision}, but the note is missing`), 'guid-8adc796d5fab8d28');
    // A guard needs the exact content hash, not a parsed body/Properties copy.
    const current = /^Community\/Stories\/[a-z0-9][a-z0-9-]{0,63}\/Exports\/[^/]+(?:\.output\.md|\.fountain|\.canvas)$/i.test(path)
      ? await this.readStoryOutputRevision(path, maxBytes)
      : await this.readNoteRevision(path, maxBytes);
    if (current !== expectedRevision) {
      throw guidanceError(new Error(`Revision conflict for ${path}: expected ${expectedRevision}, current ${current}. Read the note again before changing it.`), 'guid-b2b68521ae3b9387');
    }
  }

  async writeNote(params: NoteWriteParams): Promise<void> {
    await this.writeNoteWithReceipt(params);
  }

  /** Trusted capture primitive, not a generic write endpoint. Original bytes
   * are exclusive-create only, never rewritten or removed even after a later
   * projection failure. A same-byte retry may finish an interrupted capture. */
  async preserveOriginal(pathInput: string, bytes: Buffer): Promise<{ path: string; sha256: string; byteLength: number }> {
    const path = this.normalizePath(pathInput);
    if (!isOriginalPath(path) || !this.pathFilter.isAllowedForListing(path) || !Buffer.isBuffer(bytes)
      || bytes.length > 50 * 1024 * 1024) throw new Error('Original capture requires a source path and at most 50 MiB of bytes');
    bytes = Buffer.from(bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    return this.withMutationLock(path, async () => {
      const fullPath = this.resolveWritablePath(path, true);
      await mkdir(dirname(fullPath), { recursive: true });
      try {
        await this.writeProtectedFile(fullPath, bytes, { flag: 'wx' });
        this.notifyNoteChanged(path, 'upsert');
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
        // Verify identity, never "repair" existing originals by replacing them.
        if ((await stat(fullPath)).size !== bytes.length
          || createHash('sha256').update(await readFile(fullPath)).digest('hex') !== digest) {
          throw new Error('Existing immutable original has different bytes; capture a new source');
        }
      }
      return { path, sha256: digest, byteLength: bytes.length };
    });
  }

  /** Revision of this serialized write, not a subsequent read/current-state guarantee. */
  async writeNoteWithReceipt(params: NoteWriteParams, policy: { maxBytes?: number; assertAccess?: () => void | Promise<void> } = {}): Promise<{ revision: string }> {
    const path = this.normalizePath(params.path);
    const receipt = await this.withMutationLock(path, async () => {
      await policy.assertAccess?.();
      return this.writeNoteUnlocked({ ...params, path }, policy.maxBytes, policy.assertAccess);
    });
    return { revision: receipt.revision };
  }

  /**
   * Write one note while holding revision locks for related notes whose state
   * is an invariant of the write. Guards are assertions only: they are never
   * rewritten, but a stale guard aborts before the target changes.
   */
  async writeNoteWithRevisionGuards(
    params: NoteWriteParams,
    guards: Array<{ path: string; expectedRevision: string }>,
  ): Promise<void> {
    await this.writeNoteWithRevisionGuardsAndReceipt(params, guards);
  }

  /** Same related-note assertions/locks, with the target's own write revision. */
  async writeNoteWithRevisionGuardsAndReceipt(
    params: NoteWriteParams,
    guards: Array<{ path: string; expectedRevision: string }>,
    policy: { maxBytes?: number; assertAccess?: () => void | Promise<void>; maxGuards?:number } = {},
  ): Promise<{ revision: string }> {
    const path = this.normalizePath(params.path);
    const maxGuards=policy.maxGuards ?? 9;
    if(!Number.isInteger(maxGuards)||maxGuards<1||maxGuards>128)throw guidanceError(new Error('Invalid internal revision guard budget'), 'guid-f94ae065606d850d');
    if (!Array.isArray(guards) || guards.length < 1 || guards.length > maxGuards) {
      throw guidanceError(new Error(`A guarded note write requires between 1 and ${maxGuards} related-note revision guards`), 'guid-4b3dc779d1aad92f');
    }
    const targetIdentity = this.resolvePath(path).toLowerCase();
    const guardIdentities = new Set<string>();
    const normalizedGuards = guards.map(guard => {
      const guardPath = this.normalizePath(guard?.path);
      if (!guardPath || !this.pathFilter.isAllowed(guardPath)) throw guidanceError(new Error(`Access denied: ${guardPath || '(empty path)'}`), 'guid-26a1bd21fd48991f');
      const identity = this.resolvePath(guardPath).toLowerCase();
      if (identity === targetIdentity) throw guidanceError(new Error('A guarded note write cannot repeat the target as a related-note guard, including equivalent path spellings'), 'guid-3ee2bea57f208187');
      if (guardIdentities.has(identity)) throw guidanceError(new Error('A related note may appear only once in revision guards, including equivalent path spellings'), 'guid-74264025ac24ef33');
      guardIdentities.add(identity);
      if (guard?.expectedRevision !== 'missing' && !/^[a-f0-9]{64}$/i.test(String(guard?.expectedRevision || ''))) {
        throw guidanceError(new Error(`Each related-note guard requires a current SHA-256 revision or missing: ${guardPath}`), 'guid-b6cf3b4945552012');
      }
      return { path: guardPath, expectedRevision: guard.expectedRevision };
    });
    return this.withMutationLocks([path, ...normalizedGuards.map(guard => guard.path)], async () => {
      const assertCurrent = async () => {
        await policy.assertAccess?.();
        for (const guard of normalizedGuards) await this.assertExpectedRevision(guard.path, guard.expectedRevision, policy.maxBytes);
      };
      await assertCurrent();
      const receipt = await this.writeNoteUnlocked({ ...params, path }, policy.maxBytes, assertCurrent);
      return { revision: receipt.revision };
    });
  }

  private async writeDerivedViewFile(params: { path: string; content: string; expectedRevision: string }, extension: 'base' | 'canvas'): Promise<{ path: string; previousRevision: string; revision: string }> {
    const path = this.normalizePath(params.path);
    const allowed = new RegExp(`^(?:Community/|_scopes/(?:models|agents)/[A-Za-z0-9._-]+/)?Views/[^/]+\\.${extension}$`, 'i');
    const label = extension === 'base' ? 'Bases' : 'Canvas';
    if (!allowed.test(path)) throw guidanceError(new Error(`${label} export path must be a single .${extension} file directly under the current scope's Views/ directory`), 'guid-e13d7c6e416c3e07');
    if (!this.pathFilter.isAllowed(path)) throw guidanceError(new Error(`Access denied: ${path}`), 'guid-26a1bd21fd48991f');
    if (!params.expectedRevision) throw guidanceError(new Error(`expectedRevision is required; use 'missing' for a new ${label} file`), 'guid-951a0c9b75f2b8b0');
    const content = String(params.content ?? '');
    assertNoteContentSize(content, path);
    return this.withMutationLock(path, async () => {
      const fullPath = this.resolveWritablePath(path);
      let previousRevision = 'missing';
      try {
        previousRevision = this.revision(await readFile(fullPath, 'utf-8'));
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
      }
      if (params.expectedRevision !== previousRevision) {
        throw guidanceError(new Error(`Revision conflict for ${path}: expected ${params.expectedRevision}, current ${previousRevision}. Read the ${label} file again before replacing it.`), 'guid-8a35a2238c3cdb2f');
      }
      await mkdir(dirname(fullPath), { recursive: true });
      await this.writeProtectedFile(fullPath, content, 'utf-8');
      return { path, previousRevision, revision: this.revision(content) };
    });
  }

  /**
   * Write an Obsidian Bases definition as a derived, revision-checked view.
   * Derived views are limited to one file directly under a scope-local Views/
   * directory so this cannot become a general-purpose write primitive.
   */
  async writeBaseFile(params: { path: string; content: string; expectedRevision: string }): Promise<{ path: string; previousRevision: string; revision: string }> {
    return this.writeDerivedViewFile(params, 'base');
  }

  /** Write a validated JSON Canvas 1.0 projection as a disposable view. */
  async writeCanvasFile(params: { path: string; content: string; expectedRevision: string }): Promise<{ path: string; previousRevision: string; revision: string }> {
    let parsed: unknown;
    try { parsed = JSON.parse(String(params.content ?? '')); }
    catch { throw guidanceError(new Error('Canvas content must be valid JSON'), 'guid-6bca86081a98f1b0'); }
    validateJsonCanvasDocument(parsed);
    return this.writeDerivedViewFile(params, 'canvas');
  }

  /** Read one scope-local Canvas for bounded derived-view maintenance. */
  async readCanvasFile(pathInput: string, maxBytes = MAX_DERIVED_VIEW_READ_BYTES): Promise<{ path: string; revision: string; document: unknown }> {
    const path = this.normalizePath(pathInput);
    const allowed = /^(?:Community\/|_scopes\/(?:models|agents)\/[A-Za-z0-9._-]+\/)?Views\/[^/]+\.canvas$/i;
    if (!allowed.test(path) || !this.pathFilter.isAllowed(path)) throw guidanceError(new Error('Canvas health reads are limited to one scope-local Views/*.canvas file'), 'guid-12d358bf766c96c3');
    const fullPath = this.resolvePath(path);
    assertEnterpriseStorageAccess(path);
    const info = await stat(fullPath);
    if (!info.isFile()) throw guidanceError(new Error(`Canvas path is not a file: ${path}`), 'guid-2243f6e6ab96a183');
    const boundedBytes = Math.min(Math.max(Number(maxBytes) || MAX_DERIVED_VIEW_READ_BYTES, 1024), MAX_DERIVED_VIEW_READ_BYTES);
    if (info.size > boundedBytes) throw guidanceError(new Error(`Canvas exceeds the ${boundedBytes}-byte health-read limit: ${path}`), 'guid-f0f3671005746560');
    assertEnterpriseStorageAccess(path);
    const content = await readFile(fullPath, 'utf8');
    let document: unknown;
    try { document = JSON.parse(content); }
    catch { throw guidanceError(new Error(`Canvas is not valid JSON: ${path}`), 'guid-aa0db2f41daca3b5'); }
    return { path, revision: this.revision(content), document };
  }

  private async writeNoteUnlocked(params: NoteWriteParams, revisionMaxBytes?: number, assertAccess?: () => void | Promise<void>): Promise<{ revision: string; originalContent: string }> {
    const { content, frontmatter, mode = 'overwrite', expectedRevision } = params;
    const path = this.normalizePath(params.path);
    const fullPath = this.resolveWritablePath(path, expectedRevision === 'missing' && mode === 'overwrite');

    if (!this.pathFilter.isAllowed(path)) {
      throw guidanceError(new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
    }

    await this.assertExpectedRevision(path, expectedRevision, revisionMaxBytes);

    // Validate content is a defined string to prevent writing literal "undefined"
    if (content === undefined || content === null) {
      throw guidanceError(new Error(`Content is required for writing a note: ${path}. The content parameter must be a string.`), 'guid-a92b847c37d8e303');
    }

    // Validate frontmatter if provided
    if (frontmatter) {
      const validation = this.frontmatterHandler.validate(frontmatter);
      if (!validation.isValid) {
        throw guidanceError(new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`), 'guid-bbacd231de0f80bb');
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
          // Only confirmed absence permits creation. An unreadable source is
          // not an empty note: dropping it would destroy its body/Properties.
          if (!isMissingVaultPath(error instanceof Error ? error.cause : undefined)) throw error;
          if (expectedRevision && expectedRevision !== 'missing') {
            throw guidanceError(new Error(`Revision conflict for ${path}: the source disappeared before append/prepend; read it again before changing it.`), 'guid-870ebb0021ce5b99');
          }
          finalContent = frontmatter
            ? this.frontmatterHandler.stringify(frontmatter, content)
            : content;
        }

        if (existingNote!) {
          if (expectedRevision && existingNote.revision !== expectedRevision) {
            throw guidanceError(new Error(`Revision conflict for ${path}: the source changed before append/prepend; read it again before changing it.`), 'guid-f671900d08850673');
          }
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
      // The missing guard must survive another process creating the target
      // after our existence check. Exclusive creation never truncates it.
      // Recheck caller policy after all awaited preparation, at write dispatch.
      const accessCheck = assertAccess?.();
      if (accessCheck) await accessCheck;
      // External host editors do not participate in our revision locks. Check
      // again after asynchronous authorization/source checks, immediately before
      // dispatch, so an edit during those awaits is never silently truncated.
      await this.assertExpectedRevision(path, expectedRevision, revisionMaxBytes);
      await this.writeProtectedFile(fullPath, finalContent!, expectedRevision === 'missing'
        ? { encoding: 'utf-8', flag: 'wx' } : 'utf-8');
      this.notifyNoteChanged(path, 'upsert');
      return { revision: this.revision(finalContent!), originalContent: finalContent! };
    } catch (error) {
      if (expectedRevision === 'missing' && error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw guidanceError(new Error(`Revision conflict for ${path}: expected a new note, but it already exists`), 'guid-e56077192c6f6fe9');
      }
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
        message: guidanceText('guid-58d6655434915c22', `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`)
      };
    }

    // Validate that strings are not empty
    if (!oldString || oldString.trim() === '') {
      return {
        success: false,
        path,
        message: guidanceText('guid-634a322986d96947', 'oldString cannot be empty')
      };
    }

    if (newString === undefined || newString === null) {
      return {
        success: false,
        path,
        message: guidanceText('guid-b2d2979d6ac0bc99', 'newString is required')
      };
    }

    // Validate that oldString and newString are different
    if (oldString === newString) {
      return {
        success: false,
        path,
        message: guidanceText('guid-9fefab8424f3812c', 'oldString and newString must be different')
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
          message: guidanceText('guid-d4d43a67c7644230', `String not found in note: "${oldString.substring(0, 50)}${oldString.length > 50 ? '...' : ''}"`),
          matchCount: 0
        };
      }

      // If not replaceAll and multiple occurrences exist, fail
      if (!replaceAll && occurrences > 1) {
        return {
          success: false,
          path,
          message: guidanceText('guid-35ee172b1f95e01a', `Found ${occurrences} occurrences of the string. Use replaceAll=true to replace all occurrences, or provide a more specific string to match exactly one occurrence.`),
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
      await this.writeProtectedFile(fullPath, updatedContent, 'utf-8');
      this.notifyNoteChanged(path, 'upsert');

      return {
        success: true,
        path,
        message: guidanceText('guid-765878f0fc69b6ca', `Successfully replaced ${replaceAll ? occurrences : 1} occurrence${occurrences > 1 ? 's' : ''}`),
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
        message: guidanceText('guid-a7d23d3cc081c33a', `Failed to patch note: ${error instanceof Error ? error.message : 'Unknown error'}`)
      };
    }
  }

  /** Compute exact hunks without writing so single-note and change-set edits share semantics. */
  private planImprovedPatch(path: string, note: ParsedNote, params: PatchNoteParams): { content: string; result: PatchNoteResult; focusOffset: number } {
    const hunks = params.patches || [{
      oldString: params.oldString || '',
      newString: params.newString ?? '',
      replaceAll: params.replaceAll,
      startLine: params.startLine,
      endLine: params.endLine,
    }];
    if (!hunks.length) throw guidanceError(new Error('patches must contain at least one hunk'), 'guid-97f486b4de85ac77');
    if (hunks.length > 50) throw guidanceError(new Error('A single patch request may contain at most 50 hunks'), 'guid-eb45c7cbee42f897');
    let content = note.originalContent;
    let totalMatches = 0;
    let firstOffset = 0;
    const patchResults: Array<{ matchCount: number; startLine?: number; endLine?: number }> = [];

    for (const hunk of hunks) {
      const oldString = String(hunk.oldString ?? '');
      const newString = String(hunk.newString ?? '');
      if (!oldString || oldString.trim() === '') throw guidanceError(new Error('oldString cannot be empty'), 'guid-2b12c6a8e68a5596');
      if (oldString === newString) throw guidanceError(new Error('oldString and newString must be different'), 'guid-7d4c6ea615b7e7ef');
      const starts = lineStarts(content);
      const lineCount = content.split(/\r\n|\n|\r/).length;
      const hasRange = hunk.startLine !== undefined || hunk.endLine !== undefined;
      if (hasRange && (hunk.startLine === undefined || hunk.endLine === undefined)) throw guidanceError(new Error('startLine and endLine must be supplied together'), 'guid-3e037195dbaabf07');
      let regionStart = 0;
      let regionEnd = content.length;
      if (hasRange) {
        const startLine = Number(hunk.startLine);
        const endLine = Number(hunk.endLine);
        if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lineCount) throw guidanceError(new Error(`line range must be between 1 and ${lineCount}, with startLine <= endLine`), 'guid-39d100c8d550427c');
        regionStart = starts[startLine - 1]!;
        regionEnd = endLine < lineCount ? starts[endLine]! : content.length;
      }
      const region = content.slice(regionStart, regionEnd);
      const matchCount = region.split(oldString).length - 1;
      if (!matchCount) throw guidanceError(new Error(`String not found${hasRange ? ` within lines ${hunk.startLine}-${hunk.endLine}` : ''}: "${oldString.slice(0, 50)}${oldString.length > 50 ? '...' : ''}"`), 'guid-7def09592b4f3d7a');
      if (!hunk.replaceAll && matchCount > 1) throw guidanceError(new Error(`Found ${matchCount} occurrences; use replaceAll=true or a more specific hunk`), 'guid-bed04ce42d0e9c00');
      const matchOffset = region.indexOf(oldString);
      const replaced = hunk.replaceAll ? region.split(oldString).join(newString) : region.replace(oldString, () => newString);
      content = content.slice(0, regionStart) + replaced + content.slice(regionEnd);
      totalMatches += matchCount;
      patchResults.push({ matchCount, ...(hasRange && { startLine: Number(hunk.startLine), endLine: Number(hunk.endLine) }) });
      if (patchResults.length === 1) firstOffset = regionStart + matchOffset;
    }
    const previewMaxChars = Math.min(Math.max(Number(params.previewMaxChars ?? 1200), 200), 5000);
    assertNoteContentSize(content, path);
    const revision = this.revision(content);
    return {
      content,
      focusOffset: firstOffset,
      result: {
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
      },
    };
  }

  /** Apply line-scoped or multi-hunk patches as one all-or-nothing operation. */
  private async patchNoteImproved(params: PatchNoteParams): Promise<PatchNoteResult> {
    const path = this.normalizePath(params.path);
    if (!this.pathFilter.isAllowed(path)) return { success: false, path, message: guidanceText('guid-6b3474538aa020dc', `Access denied: ${path}`) };
    try {
      await this.assertExpectedRevision(path, params.expectedRevision);
      const note = await this.readNote(path);
      const planned = this.planImprovedPatch(path, note, params);
      if (params.dryRun || planned.content === note.originalContent) return planned.result;
      await this.writeProtectedFile(this.resolveWritablePath(path), planned.content, 'utf-8');
      this.notifyNoteChanged(path, 'upsert');
      return planned.result;
    } catch (error) {
      return { success: false, path, message: guidanceText('guid-a7d23d3cc081c33a', `Failed to patch note: ${error instanceof Error ? error.message : 'Unknown error'}`) };
    }
  }

  private planFrontmatterMutation(path: string, originalContent: string, frontmatter: NonNullable<PatchMultipleNotesParams['changes'][number]['frontmatter']>): string {
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) throw guidanceError(new Error(`frontmatter must be an object for ${path}`), 'guid-c1eaaba66cfb7496');
    const set = frontmatter.set ?? {};
    const remove = frontmatter.remove ?? [];
    if (!set || typeof set !== 'object' || Array.isArray(set)) throw guidanceError(new Error(`frontmatter.set must be an object for ${path}`), 'guid-6a764a13ea0e7b5e');
    if (!Array.isArray(remove)) throw guidanceError(new Error(`frontmatter.remove must be an array for ${path}`), 'guid-5e20db5b3d64307c');
    const setNames = Object.keys(set);
    if (setNames.length > 100 || remove.length > 100) throw guidanceError(new Error(`A change may set or remove at most 100 Properties: ${path}`), 'guid-72ae57c2051c496e');
    if (setNames.some(name => set[name] === undefined)) throw guidanceError(new Error(`frontmatter.set cannot contain undefined values for ${path}; use remove instead`), 'guid-514ff5eb35eaac6e');
    const blockedNames = new Set(['__proto__', 'prototype', 'constructor']);
    const cleanRemove = [...new Set(remove.map(value => String(value || '').trim()))];
    for (const name of [...setNames, ...cleanRemove]) {
      if (!name || name.length > 100 || blockedNames.has(name)) throw guidanceError(new Error(`Invalid top-level Property name for ${path}: ${name || '(empty)'}`), 'guid-8e0e86f6584023d8');
    }
    const overlap = setNames.filter(name => cleanRemove.includes(name));
    if (overlap.length) throw guidanceError(new Error(`A Property cannot be both set and removed for ${path}: ${overlap.join(', ')}`), 'guid-d2d21793d019b4fb');
    if (!setNames.length && !cleanRemove.length) throw guidanceError(new Error(`frontmatter must set or remove at least one Property for ${path}`), 'guid-ea7815c3cb0520f5');
    if (Buffer.byteLength(JSON.stringify(set), 'utf8') > 128 * 1024) throw guidanceError(new Error(`frontmatter.set exceeds the 128 KiB change-set limit for ${path}`), 'guid-31b84d85e66d52a4');

    const parsed = this.frontmatterHandler.parse(originalContent);
    const nextFrontmatter = { ...parsed.frontmatter, ...set };
    for (const name of cleanRemove) delete nextFrontmatter[name];
    const validation = this.frontmatterHandler.validate(nextFrontmatter);
    if (!validation.isValid) throw guidanceError(new Error(`Invalid frontmatter for ${path}: ${validation.errors.join(', ')}`), 'guid-6be617a17753a7e2');
    const updates: Record<string, unknown> = { ...set };
    for (const name of cleanRemove) updates[name] = undefined;
    const content = parsed.matter && parsed.matter.trim() !== ''
      ? this.frontmatterHandler.preserveStringify(parsed.matter, updates, parsed.content)
      : this.frontmatterHandler.stringify(nextFrontmatter, parsed.content);
    assertNoteContentSize(content, path);
    return content;
  }

  /**
   * Preflight and apply a small revision-checked, rollback-backed multi-note
   * transaction. Filesystem writes are not globally atomic, so a failed write
   * is restored from the in-memory originals and reported explicitly.
   */
  async patchMultipleNotes(params: PatchMultipleNotesParams, projectPath: (path: string) => string = path => path): Promise<PatchMultipleNotesResult> {
    if (!params || !Array.isArray(params.changes)) throw guidanceError(new Error('changes must be an array'), 'guid-56275582a4671b0b');
    if (params.changes.length < 1 || params.changes.length > 10) throw guidanceError(new Error('A note change set must contain between 1 and 10 changes'), 'guid-f78b834a8f1a2c46');
    const previewMaxChars = Math.min(Math.max(Number(params.previewMaxChars ?? 400), 200), 1000);
    const maxChars = Math.min(Math.max(Number(params.maxChars ?? 12000), 4096), 20000);
    let totalHunks = 0;
    let totalPatchBytes = 0;
    const targetIdentities = new Set<string>();
    const normalized = params.changes.map(change => {
      if (!change || typeof change !== 'object') throw guidanceError(new Error('Every change must be an object'), 'guid-89ccaba71c3960e4');
      const path = this.normalizePath(change.path);
      if (!path || !this.pathFilter.isAllowed(path)) throw guidanceError(new Error(`Access denied: ${path || '(empty path)'}`), 'guid-26a1bd21fd48991f');
      // Preflight every destination, including dry runs, before any member of
      // this batch can be written. Absolute inputs must use the same guard.
      const resolvedPath = this.resolvePath(path);
      assertLegacyDiscussionMutationAllowed(relative(this.vaultPath, resolvedPath), 'Change set', true);
      const identity = resolvedPath.toLowerCase();
      if (targetIdentities.has(identity)) throw guidanceError(new Error('A note may appear only once in a change set, including equivalent path spellings. Combine its patches and Properties into one change, then dry-run again.'), 'guid-a3ab939d15cf65ae');
      targetIdentities.add(identity);
      if (!/^[a-f0-9]{64}$/i.test(String(change.expectedRevision || ''))) throw guidanceError(new Error(`Each change requires the current SHA-256 revision of an existing note: ${path}`), 'guid-a00edd7fe82c324b');
      const patches = change.patches;
      const frontmatter = change.frontmatter;
      if (patches !== undefined && (!Array.isArray(patches) || patches.length < 1)) throw guidanceError(new Error(`patches must be a non-empty array for ${path}`), 'guid-fcf686f9db1ad765');
      if (patches === undefined && frontmatter === undefined) throw guidanceError(new Error(`Each change needs patches, frontmatter, or both: ${path}`), 'guid-88bcfaa6a38318b0');
      totalHunks += patches?.length || 0;
      for (const hunk of patches || []) totalPatchBytes += Buffer.byteLength(String(hunk?.oldString ?? ''), 'utf8') + Buffer.byteLength(String(hunk?.newString ?? ''), 'utf8');
      return { ...change, path };
    });
    if (totalHunks > 50) throw guidanceError(new Error('A note change set may contain at most 50 total patch hunks'), 'guid-843cf02526f0ff4c');
    if (totalPatchBytes > 2 * 1024 * 1024) throw guidanceError(new Error('A note change set may contain at most 2 MiB of patch text'), 'guid-243148697f06f3dd');

    return this.withMutationLocks(normalized.map(change => change.path), async () => {
      const plans: Array<{ path: string; original: string; content: string; item: NoteChangeSetResultItem }> = [];
      for (const change of normalized) {
        const note = await this.readNote(change.path, MAX_NOTE_CONTENT_BYTES);
        if (note.revision !== change.expectedRevision) throw guidanceError(new Error(`Revision conflict for ${change.path}: expected ${change.expectedRevision}, current ${note.revision}. Read every note again and rebuild the change set.`), 'guid-35b6ed12ce8003dc');
        let content = note.originalContent;
        let focusOffset = 0;
        let matchCount = 0;
        if (change.patches) {
          const patchPlan = this.planImprovedPatch(change.path, note, {
            path: change.path,
            patches: change.patches,
            expectedRevision: change.expectedRevision,
            dryRun: true,
            previewMaxChars,
          });
          content = patchPlan.content;
          focusOffset = patchPlan.focusOffset;
          matchCount = patchPlan.result.matchCount || 0;
        }
        if (change.frontmatter) content = this.planFrontmatterMutation(change.path, content, change.frontmatter);
        assertNoteContentSize(content, change.path);
        const setNames = Object.keys(change.frontmatter?.set || {}).sort();
        const removeNames = [...new Set((change.frontmatter?.remove || []).map(value => String(value).trim()))].sort();
        plans.push({
          path: change.path,
          original: note.originalContent,
          content,
          item: {
            path: change.path,
            previousRevision: note.revision,
            revision: this.revision(content),
            wouldChange: content !== note.originalContent,
            patchCount: change.patches?.length || 0,
            matchCount,
            frontmatterSet: setNames,
            frontmatterRemoved: removeNames,
            preview: {
              before: boundedPreview(note.originalContent, focusOffset, 2, previewMaxChars),
              after: boundedPreview(content, focusOffset, 2, previewMaxChars),
            },
          },
        });
      }
      const planFingerprint = this.revision(JSON.stringify({
        version: 1,
        changes: plans.map(plan => ({ path: plan.path.toLowerCase(), previousRevision: plan.item.previousRevision, revision: plan.item.revision }))
          .sort((left, right) => left.path.localeCompare(right.path)),
      }));
      const dryRun = params.dryRun !== false;
      if (!dryRun && params.confirmPlanFingerprint !== planFingerprint) {
        throw guidanceError(new Error('Change-set confirmation mismatch. Dry-run this exact request, inspect the previews, and pass its returned confirmPlanFingerprint before applying it.'), 'guid-42cece53614644bd');
      }

      // Admit the success response before side effects. Otherwise an applied
      // transaction could be reported as failed solely because its receipt
      // cannot fit, prompting a caller to repeat an already completed edit.
      const result: PatchMultipleNotesResult = {
        success: true,
        dryRun,
        applied: !dryRun,
        planFingerprint,
        changeCount: plans.length,
        changedCount: plans.filter(plan => plan.item.wouldChange).length,
        changes: plans.map(plan => ({ ...plan.item, path: projectPath(plan.path) })),
        message: dryRun
          ? 'Preflight complete. Re-submit the same changes with dryRun=false and confirmPlanFingerprint to apply them.'
          : 'The complete revision-checked change set was applied.',
      };
      let response = result;
      const indent = params.prettyPrint ? 2 : undefined;
      if (JSON.stringify(response, null, indent).length > maxChars) {
        response = { ...result, changes: result.changes.map(({ preview: _preview, ...item }) => item), truncated: true };
        if (JSON.stringify(response, null, indent).length > maxChars) throw guidanceError(new Error('maxChars is too small to preserve all change paths and revisions; no files were written. Increase maxChars, disable prettyPrint, or reduce the change count.'), 'guid-a87cd7fde5105a2a');
      }

      if (!dryRun) {
        // Recheck all inputs immediately before the first write. This catches
        // external Obsidian/editor changes that do not participate in our lock.
        for (const plan of plans) {
          const current = await readBoundedSource(this.resolvePath(plan.path), MAX_NOTE_CONTENT_BYTES);
          if (this.revision(current) !== plan.item.previousRevision) throw guidanceError(new Error(`Revision conflict for ${plan.path}: it changed after preflight; no change-set files were written`), 'guid-461eca693740f58e');
        }
        const attempted: typeof plans = [];
        try {
          for (const plan of plans.filter(candidate => candidate.item.wouldChange)) {
            let fullPath: string;
            let current: string;
            try {
              fullPath = this.resolveWritablePath(plan.path);
              // Mutation rechecks must be fresh, not coalesced with an earlier
              // in-flight read. Bound source bytes even after external edits.
              current = await readBoundedSource(fullPath, MAX_NOTE_CONTENT_BYTES);
            } catch {
              this.notifyNoteChanged(plan.path, 'upsert');
              throw guidanceError(new Error(`Cannot safely recheck ${plan.path} before its individual write; inspect its current state`), 'guid-dbe87694514e6640');
            }
            if (this.revision(current) !== plan.item.previousRevision) {
              this.notifyNoteChanged(plan.path, 'upsert');
              throw guidanceError(new Error(`Revision conflict for ${plan.path}: it changed before its individual write`), 'guid-f89bdbd4251d29c7');
            }
            attempted.push(plan);
            await this.writeProtectedFile(fullPath, plan.content, 'utf8');
          }
        } catch (error) {
          const rollbackFailures: string[] = [];
          for (const plan of attempted.reverse()) {
            try {
              const fullPath = this.resolveWritablePath(plan.path);
              const current = await readBoundedSource(fullPath, MAX_NOTE_CONTENT_BYTES);
              // Preserve edits from writers outside our instance-local lock.
              // This is a conservative ownership check, not filesystem CAS.
              if (current === plan.original) continue;
              if (current !== plan.content) {
                rollbackFailures.push(`${plan.path}: content changed after our write; current content preserved`);
                continue;
              }
              await this.writeProtectedFile(fullPath, plan.original, 'utf8');
            } catch {
              rollbackFailures.push(`${plan.path}: could not safely read or restore the target; inspect its current state`);
            } finally {
              // Even an uncertain restoration may have changed the disk view.
              this.notifyNoteChanged(plan.path, 'upsert');
            }
          }
          const rollback = rollbackFailures.length ? ` Rollback was incomplete: ${rollbackFailures.join('; ')}` : ' All attempted writes were restored.';
          throw guidanceError(new Error(`Change-set write failed: ${error instanceof Error ? error.message : 'unknown write error'}.${rollback}`), 'guid-132494fb699b28dc');
        }
        for (const plan of plans.filter(candidate => candidate.item.wouldChange)) this.notifyNoteChanged(plan.path, 'upsert');
      }

      return response;
    });
  }

  async listDirectory(path: string = ''): Promise<DirectoryListing> {
    // Normalize path: treat '.' as root directory, strip vault prefix
    const normalizedPath = path === '.' ? '' : this.normalizePath(path);
    const fullPath = this.resolvePath(normalizedPath);
    if (!canTraverseEnterpriseStoragePath(normalizedPath || '.')) throw new Error('Access denied: directory traversal unavailable');

    try {
      assertEnterpriseStorageFresh();
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
            const canonicalEntryPath = realRelative.replace(/\\/g, '/');
            if (!this.pathFilter.isAllowedForListing(canonicalEntryPath)) continue;
            const targetStat = await stat(entryFullPath);
            if (targetStat.isDirectory()) {
              if (!canTraverseEnterpriseStoragePath(canonicalEntryPath)) continue;
              directories.push(entry.name);
            } else if (targetStat.isFile()) {
              if (!canReadEnterpriseStoragePath(canonicalEntryPath)) continue;
              files.push(entry.name);
            }
          } catch {
            continue; // Broken/circular/inaccessible symlink, skip silently
          }
        } else if (entry.isDirectory()) {
          if (!canTraverseEnterpriseStoragePath(entryPath)) continue;
          directories.push(entry.name);
        } else if (entry.isFile()) {
          if (!canReadEnterpriseStoragePath(entryPath)) continue;
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
          throw guidanceError(new Error(`Directory not found: ${path}. Use list_directory with no path or '/' to see root folders.`), 'guid-f965368073d3733f');
        }
        if (error.message.includes('permission') || error.message.includes('access')) {
          throw guidanceError(new Error(`Permission denied: ${path}. The directory exists but cannot be read due to filesystem permissions.`), 'guid-20d1cd55181791bc');
        }
        if (error.message.includes('not a directory') || error.message.includes('ENOTDIR')) {
          throw guidanceError(new Error(`Not a directory: ${path}. This path points to a file, not a folder. Use read_note to read files.`), 'guid-adfbf989918e64da');
        }
      }
      throw guidanceError(new Error(`Failed to list directory: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`), 'guid-da83b406aadd91f1');
    }
  }

  async exists(path: string): Promise<boolean> {
    path = this.normalizePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return false;
    }
    if (!canReadEnterpriseStoragePath(path)) return false;
    const fullPath = this.resolvePath(path);

    try {
      await access(fullPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    path = this.normalizePath(path);

    if (!this.pathFilter.isAllowed(path)) {
      return false;
    }
    if (!canReadEnterpriseStoragePath(path)) return false;
    const fullPath = this.resolvePath(path);

    return this.isResolvedDirectory(fullPath);
  }

  /** Internal stat probe only; callers must validate the path and filter first. */
  private async isResolvedDirectory(fullPath: string): Promise<boolean> {
    try {
      const stats = await stat(fullPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /** Internal scans may cross only the structural ancestors of a readable
   * enterprise scope. The ancestor itself is never returned to the caller. */
  private canTraverseEnterpriseReadPath(path: string, recordSource = true): boolean {
    if (canTraverseEnterpriseStoragePath(path, recordSource)) return true;
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    if (normalized === '_scopes' || normalized === '_scopes/users' || normalized === '_scopes/agents') return true;
    const employeeRoot = /^_scopes\/users\/[^/]+$/.exec(normalized);
    return Boolean(employeeRoot && canReadEnterpriseStoragePath(`${path.replace(/\/$/, '')}/SharedMemory`, recordSource));
  }

  /**
   * Build one visibility-safe move plan. Resolution uses every physical note
   * so an inaccessible same-name target cannot be mistaken for a unique one.
   * Details from inaccessible scopes are collapsed to one boolean barrier.
   */
  private async collectMoveReferencePlans(
    oldPath: string,
    newPath: string,
    canAccessPath: (path: string) => boolean,
    includeMovedSource = true,
  ): Promise<{ plans: Array<{ sourcePath: string; sourceContent: string; plan: MoveReferenceRewritePlan }>; hiddenReferencesPresent: boolean }> {
    const physicalPaths = (await this.collectVaultFiles())
      .filter(path => this.pathFilter.isAllowed(path) && /\.(?:md|markdown|txt)$/i.test(path))
      .sort((a, b) => a.localeCompare(b));
    const documents: Array<{ sourcePath: string; sourceContent: string; descriptor: NoteReferenceDescriptor }> = [];
    const readBatchSize = 32;
    for (let offset = 0; offset < physicalPaths.length; offset += readBatchSize) {
      const batch = await Promise.all(physicalPaths.slice(offset, offset + readBatchSize).map(async sourcePath => {
        try {
          assertEnterpriseStorageAccess(sourcePath);
          const sourceContent = await this.vaultIo.readUtf8(this.resolvePath(sourcePath));
          const frontmatter = this.frontmatterHandler.parse(sourceContent).frontmatter || {};
          return {
            sourcePath,
            sourceContent,
            descriptor: {
              path: sourcePath,
              qualifiedPaths: this.scopeAccess.isCommunityPath(sourcePath)
                ? [`scope://community/${this.scopeAccess.getCommandCenterId()}/${sourcePath.slice('Community/'.length)}`] : [],
              title: frontmatter.title,
              aliases: frontmatter.aliases,
              preferredTerm: frontmatter.preferred_term,
              stableId: frontmatter.stable_id,
            } satisfies NoteReferenceDescriptor,
          };
        } catch (error) {
          // A removed note has no remaining references. Any other failure
          // leaves integrity unknown: never report an incomplete scan as safe.
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
          throw guidanceError(new Error('Reference integrity scan incomplete; restore readable notes and retry. No changes were made.'), 'guid-38983d8f6c48fa62');
        }
      }));
      for (const document of batch) if (document) documents.push(document);
    }
    const referenceIndex = buildNoteReferenceIndex(documents.map(document => document.descriptor));
    const plans: Array<{ sourcePath: string; sourceContent: string; plan: MoveReferenceRewritePlan }> = [];
    let hiddenReferencesPresent = false;
    for (const { sourcePath, sourceContent } of documents) {
      if (!includeMovedSource && sourcePath.toLowerCase() === oldPath.toLowerCase()) continue;
      if (includeMovedSource && sourcePath.toLowerCase() === newPath.toLowerCase() && sourcePath.toLowerCase() !== oldPath.toLowerCase()) continue;
      const plan = planMoveReferenceRewrite(this.frontmatterHandler, sourceContent, sourcePath, oldPath, newPath, referenceIndex);
      if (!canAccessPath(sourcePath)) {
        if (plan.linkChanges.length > 0 || plan.propertyChanges.length > 0 || plan.ambiguous.length > 0) hiddenReferencesPresent = true;
        continue;
      }
      const visibleAmbiguous: AmbiguousMoveReference[] = [];
      for (const reference of plan.ambiguous) {
        if (reference.candidates.every(canAccessPath)) visibleAmbiguous.push(reference);
        else hiddenReferencesPresent = true;
      }
      plans.push({ sourcePath, sourceContent, plan: { ...plan, ambiguous: visibleAmbiguous } });
    }
    return { plans, hiddenReferencesPresent };
  }

  async previewDeleteNote(params: DeleteNotePreviewParams, canAccessPath: (path: string) => boolean = () => true): Promise<DeleteNotePreviewResult> {
    const path = this.normalizeReferenceMutationPath(params.path);
    if (!this.pathFilter.isAllowed(path) || !canAccessPath(path)) throw guidanceError(new Error(`Access denied: ${path}`), 'guid-26a1bd21fd48991f');
    const requestedLimit = params.limit ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw guidanceError(new Error('limit must be a positive integer'), 'guid-14abe8b02cfc3624');
    const limit = Math.min(requestedLimit, 200);
    const scan = await this.collectMoveReferencePlans(path, `${path}.__mcpvault_deleted__`, canAccessPath, false);
    const affectedLinks: DeleteNotePreviewResult['affectedLinks'] = [];
    const affectedProperties: DeleteNotePreviewResult['affectedProperties'] = [];
    const ambiguousReferences: DeleteNotePreviewResult['ambiguousReferences'] = [];
    for (const { sourcePath, plan } of scan.plans) {
      if (normalizeNoteTarget(sourcePath) === normalizeNoteTarget(path)) continue;
      affectedLinks.push(...plan.linkChanges.map(({ replacement: _replacement, direction: _direction, sourcePath: source, ...link }) => ({ ...link, path: source })));
      affectedProperties.push(...plan.propertyChanges.map(change => ({ sourcePath: change.sourcePath, propertyPath: change.propertyPath, value: change.value })));
      ambiguousReferences.push(...plan.ambiguous);
    }
    const total = affectedLinks.length + affectedProperties.length;
    const returnedAmbiguous = ambiguousReferences.slice(0, limit);
    const linkBudget = Math.max(0, limit - returnedAmbiguous.length);
    const returnedLinks = affectedLinks.slice(0, linkBudget);
    const propertyBudget = Math.max(0, linkBudget - returnedLinks.length);
    const returnedProperties = affectedProperties.slice(0, propertyBudget);
    const returnedCount = returnedAmbiguous.length + returnedLinks.length + returnedProperties.length;
    const exists = await this.noteExists(path);
    return {
      path,
      exists,
      affectedLinks: returnedLinks,
      affectedProperties: returnedProperties,
      ambiguousReferences: returnedAmbiguous,
      total,
      ambiguousTotal: ambiguousReferences.length,
      hiddenReferencesPresent: scan.hiddenReferencesPresent,
      truncated: total + ambiguousReferences.length > returnedCount,
      message: scan.hiddenReferencesPresent
        ? 'Deletion would affect an inaccessible scope or hidden identity collision. No hidden path is disclosed; preserve or tombstone this note unless an administrator can review every affected scope.'
        : total + ambiguousReferences.length > 0
          ? 'Deletion would leave visible or potentially ambiguous references dangling. Prefer archive/supersede/tombstone with a replacement; otherwise review this impact before an explicit revision-checked override.'
          : 'No visible or hidden inbound reference was found. Normal revision, retention, and Git review still apply.',
    };
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

    await this.renameProtectedFile(fullPath, finalTrashPath);
  }

  async deleteNote(params: DeleteNoteParams, canAccessPath: (path: string) => boolean = () => true): Promise<DeleteResult> {
    const path = this.normalizeReferenceMutationPath(params.path);
    const confirmPath = this.normalizeReferenceMutationPath(params.confirmPath);
    return this.withMutationLock(path, () => this.deleteNoteUnlocked({ ...params, path, confirmPath }, canAccessPath));
  }

  private async deleteNoteUnlocked(params: DeleteNoteParams, canAccessPath: (path: string) => boolean): Promise<DeleteResult> {
    const { trashMode = 'none' } = params;
    const path = params.path;
    const confirmPath = params.confirmPath;

    // Confirmation check - paths must match exactly
    if (path !== confirmPath) {
      return {
        success: false,
        path: path,
        message: guidanceText('guid-db125383e6c105d1', "Deletion cancelled: confirmation path does not match. For safety, both 'path' and 'confirmPath' must be identical.")
      };
    }

    if (!this.pathFilter.isAllowed(path) || !canAccessPath(path)) {
      return {
        success: false,
        path: path,
        message: guidanceText('guid-58d6655434915c22', `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`)
      };
    }
    if (!['none', 'local', 'system'].includes(trashMode)) {
      return { success: false, path, message: guidanceText('guid-43da830fe410f2ba', 'Deletion cancelled: trashMode must be none, local, or system.') };
    }

    const fullPath = this.resolveWritablePath(path);

    try {
      // Check if it's a directory first (can't delete directories with this method)
      const isDir = await this.isDirectory(path);
      if (isDir) {
        return {
          success: false,
          path: path,
          message: guidanceText('guid-69a52f68f3e3e7a1', `Cannot delete: ${path} is not a file`)
        };
      }

      if (/\.(?:md|markdown|txt)$/i.test(path)) {
        const impact = await this.previewDeleteNote({ path, limit: 1 }, canAccessPath);
        if (impact.hiddenReferencesPresent) {
          return { success: false, path, message: guidanceText('guid-e3ec7d9d9e49bd0c', 'Deletion blocked: an inaccessible scope references this note or has a hidden identity collision. Preserve or tombstone the note; only an administrator able to review every affected scope may delete it.') };
        }
        if (impact.total + impact.ambiguousTotal > 0) {
          if (params.allowDanglingReferences !== true) {
            return { success: false, path, message: guidanceText('guid-4a3713296154507d', `Deletion blocked: ${impact.total} resolved and ${impact.ambiguousTotal} ambiguous inbound reference${impact.total + impact.ambiguousTotal === 1 ? '' : 's'} would become dangling. Call preview_delete_note, then archive/supersede/tombstone or explicitly allow dangling references.`) };
          }
          if (!params.expectedRevision || !String(params.expectedRevision).trim()) {
            return { success: false, path, message: guidanceText('guid-a05504b6ff984966', 'allowDanglingReferences requires expectedRevision from a fresh read of the note.') };
          }
        }
        if (params.expectedRevision) await this.assertExpectedRevision(path, params.expectedRevision);
      }

      if (trashMode === 'local') {
        await this.moveNoteToVaultTrash(path, fullPath);

        this.notifyNoteChanged(path, 'delete');

        return {
          success: true,
          path: path,
          message: guidanceText('guid-bf3659804c363621', `Successfully moved note to vault trash: ${path}`)
        };
      }

      if (trashMode === 'system') {
        try {
          this.assertNoticeMutation(path);
          await trash(fullPath);
          this.notifyNoteChanged(path, 'delete');
          return {
            success: true,
            path: path,
            message: guidanceText('guid-dc3cecf9490b62da', `Successfully moved note to system trash: ${path}`)
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
            message: guidanceText('guid-326189a7fb29e8d9', `System trash unavailable; moved note to vault trash instead: ${path}`)
          };
        }
      }

      // Perform the deletion using Node.js native API
      await this.removeProtectedFile(fullPath);

      this.notifyNoteChanged(path, 'delete');

      return {
        success: true,
        path: path,
        message: guidanceText('guid-c69c5af8db0140e7', `Successfully deleted note: ${path}. This action cannot be undone.`)
      };

    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          return {
            success: false,
            path: path,
            message: guidanceText('guid-f3ef7b0e00dee04c', `File not found: ${path}. Use list_directory to see available files.`)
          };
        }
        if (error.code === 'EACCES') {
          return {
            success: false,
            path: path,
            message: guidanceText('guid-115ee50cfc00e222', `Permission denied: ${path}. The file exists but cannot be deleted due to filesystem permissions.`)
          };
        }
      }
      return {
        success: false,
        path: path,
        message: guidanceText('guid-e3d5e9b841110b4c', `Failed to delete file: ${path} - ${error instanceof Error ? error.message : 'Unknown error'}`)
      };
    }
  }

  async moveNote(params: MoveNoteParams, canAccessPath: (path: string) => boolean = () => true): Promise<MoveResult> {
    const oldPath = this.normalizeReferenceMutationPath(params.oldPath);
    const newPath = this.normalizeReferenceMutationPath(params.newPath);
    return this.withMutationLocks([oldPath, newPath], () => this.moveNoteUnlocked({ ...params, oldPath, newPath }, canAccessPath));
  }

  private async moveNoteUnlocked(params: MoveNoteParams, canAccessPath: (path: string) => boolean): Promise<MoveResult> {
    const { overwrite = false, updateLinks = false } = params;
    const oldPath = params.oldPath;
    const newPath = params.newPath;

    if (!canAccessPath(oldPath) || !canAccessPath(newPath)) {
      return { success: false, oldPath, newPath, message: guidanceText('guid-91b53e27f9ea81c3', 'Access denied: source or destination is outside the caller scope.') };
    }

    if (oldPath.toLowerCase() === newPath.toLowerCase()) {
      return { success: false, oldPath, newPath, message: guidanceText('guid-58f0774cacbcc19d', 'Source and destination are identical; no move was performed.') };
    }

    if (!this.pathFilter.isAllowed(oldPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: guidanceText('guid-58d6655434915c22', `Access denied: ${oldPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`)
      };
    }

    if (!this.pathFilter.isAllowed(newPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: guidanceText('guid-58d6655434915c22', `Access denied: ${newPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`)
      };
    }

    const oldFullPath = this.resolveWritablePath(oldPath);
    const newFullPath = this.resolveWritablePath(newPath);
    const linkBackups: Array<{ path: string; original: string; rewritten: string; updated: boolean }> = [];
    let destinationBackup: string | undefined;
    let destinationTouched = false;

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
            message: guidanceText('guid-70d7d7a538ba7896', `Source file not found: ${oldPath}. Use list_directory to see available files.`)
          };
        }
        throw error;
      }

      if (updateLinks) {
        if (!params.expectedRevision || !String(params.expectedRevision).trim()) {
          return { success: false, oldPath, newPath, message: guidanceText('guid-8d0da6618797f4b2', 'updateLinks requires expectedRevision from a fresh read of the source note.') };
        }
        await this.assertExpectedRevision(oldPath, params.expectedRevision);
        try {
          if (!overwrite) await access(newFullPath, constants.F_OK);
          if (!overwrite) return { success: false, oldPath, newPath, message: guidanceText('guid-c8b93e38ff98c747', `Target file already exists: ${newPath}. Use overwrite=true to replace it.`) };
        } catch (error) {
          if (overwrite || !(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
        }
        const scan = await this.collectMoveReferencePlans(oldPath, newPath, canAccessPath);
        const ambiguities: AmbiguousMoveReference[] = [];
        for (const { sourcePath, sourceContent, plan } of scan.plans) {
          ambiguities.push(...plan.ambiguous);
          if (sourcePath.toLowerCase() === oldPath.toLowerCase()) {
            content = plan.content;
          } else if (plan.content !== sourceContent) {
            linkBackups.push({ path: sourcePath, original: sourceContent, rewritten: plan.content, updated: false });
          }
        }
        if (scan.hiddenReferencesPresent) {
          return { success: false, oldPath, newPath, message: guidanceText('guid-f07458143bc6b53d', 'Move blocked: at least one inaccessible scope references this note or makes its identity ambiguous. Preserve the current path or ask an administrator with access to every affected scope to perform the move.') };
        }
        if (ambiguities.length > 0) {
          const first = ambiguities[0]!;
          return {
            success: false,
            oldPath,
            newPath,
            message: guidanceText('guid-954826d37bda9bb4', `Move blocked: ${ambiguities.length} ambiguous reference${ambiguities.length === 1 ? '' : 's'} may point to the source note. Disambiguate ${first.sourcePath}${first.propertyPath ? ` ${first.propertyPath}` : first.line ? ` line ${first.line}` : ''} before retrying updateLinks=true.`),
          };
        }
        assertNoteContentSize(content, newPath);
        // Reject a protected dependent before writing ANY backlink or moving
        // the source. Checking only inside the write loop would mutate earlier
        // dependents and rely on rollback to restore them.
        for (const backup of linkBackups) this.resolveWritablePath(backup.path);
        for (const backup of linkBackups) {
          const current = await this.readNote(backup.path);
          if (current.originalContent !== backup.original) throw guidanceError(new Error(`Inbound link source changed during rename: ${backup.path}`), 'guid-0976fcf15f9e289f');
          assertNoteContentSize(backup.rewritten, backup.path);
          // Mark before write because writeFile may truncate and then fail.
          // Rollback must cover both complete and partial writes.
          backup.updated = true;
          await this.writeProtectedFile(this.resolveWritablePath(backup.path), backup.rewritten, 'utf-8');
          this.notifyNoteChanged(backup.path, 'upsert');
        }
      }

      // Create directories if needed
      await mkdir(dirname(newFullPath), { recursive: true });

      if (overwrite) {
        try { destinationBackup = await readFile(newFullPath, 'utf-8'); }
        catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
        }
      }

      // Write to new location, checking for existing file atomically if !overwrite
      try {
        // A failed write can still leave a truncated/partial destination. For
        // exclusive creation, EEXIST below clears this flag because that file
        // belongs to the pre-existing/racing writer and must not be removed.
        destinationTouched = true;
        if (overwrite) {
          await this.writeProtectedFile(newFullPath, content, 'utf-8');
        } else {
          // wx flag: write exclusive - fails if file exists
          await this.writeProtectedFile(newFullPath, content, { encoding: 'utf-8', flag: 'wx' });
        }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
          destinationTouched = false;
          throw guidanceError(new Error(`Target file already exists: ${newPath}. Use overwrite=true to replace it.`), 'guid-2e7c727ce916c64a');
        }
        throw error;
      }

      // Delete the source file
      await this.removeProtectedFile(oldFullPath);

      this.notifyNoteChanged(oldPath, 'delete');
      this.notifyNoteChanged(newPath, 'upsert');

      return {
        success: true,
        oldPath,
        newPath,
        message: guidanceText('guid-1d17892f9a9065d4', `Successfully moved note from ${oldPath} to ${newPath}${linkBackups.length ? ` and updated references in ${linkBackups.length} dependent note${linkBackups.length === 1 ? '' : 's'}` : ''}`)
      };

    } catch (error) {
      if (destinationTouched) {
        try {
          if (destinationBackup !== undefined) await this.writeProtectedFile(newFullPath, destinationBackup, 'utf-8');
          else await this.removeProtectedFile(newFullPath);
          this.notifyNoteChanged(newPath, destinationBackup !== undefined ? 'upsert' : 'delete');
        } catch {
          // Preserve the original error; the failure message below flags that the move did not complete.
        }
      }
      for (const backup of linkBackups.filter(item => item.updated).reverse()) {
        try {
          await this.writeProtectedFile(this.resolveWritablePath(backup.path), backup.original, 'utf-8');
          this.notifyNoteChanged(backup.path, 'upsert');
        } catch {
          // Preserve the original failure while making the partial rollback visible in the message.
        }
      }
      return {
        success: false,
        oldPath,
        newPath,
        message: guidanceText('guid-66af0397c6aeece4', `Failed to move note: ${error instanceof Error ? error.message : 'Unknown error'}`)
      };
    }
  }

  async moveFile(params: MoveFileParams): Promise<MoveResult> {
    const oldPath = this.normalizePath(params.oldPath);
    const newPath = this.normalizePath(params.newPath);
    return this.withMutationLocks([oldPath, newPath], () => this.moveFileUnlocked({ ...params, oldPath, newPath }));
  }

  private async moveFileUnlocked(params: MoveFileParams): Promise<MoveResult> {
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
        message: guidanceText('guid-2579fb5e891bbbb5', "Move cancelled: confirmation paths do not match. For safety, oldPath must equal confirmOldPath and newPath must equal confirmNewPath.")
      };
    }

    if (!this.pathFilter.isAllowedForListing(oldPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: guidanceText('guid-58d6655434915c22', `Access denied: ${oldPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`)
      };
    }

    if (!this.pathFilter.isAllowedForListing(newPath)) {
      return {
        success: false,
        oldPath,
        newPath,
        message: guidanceText('guid-58d6655434915c22', `Access denied: ${newPath}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`)
      };
    }

    const oldFullPath = this.resolveWritablePath(oldPath);
    const newFullPath = this.resolveWritablePath(newPath);

    // Generic attachment moves also accept Markdown. Validate against the
    // destination audience before deleting an existing target or moving bytes.
    if (/\.(?:md|markdown|txt)$/i.test(oldPath) || /\.(?:md|markdown|txt)$/i.test(newPath)) {
      try {
        const source = await this.vaultIo.readUtf8Bounded(oldFullPath, MAX_NOTE_CONTENT_BYTES);
        assertMemoryContent(source, newPath);
        assertContextRulesContent(source);
      } catch (error) {
        return { success: false, oldPath, newPath, message: guidanceText('guid-5ae8a9458d133d50', `Move validation failed: ${error instanceof Error ? error.message : 'source unavailable'}`) };
      }
    }

    try {
      const sourceStat = await stat(oldFullPath);
      if (sourceStat.isDirectory()) {
        return {
          success: false,
          oldPath,
          newPath,
          message: guidanceText('guid-889b03065d856ea2', `Source path is a directory: ${oldPath}. move_file currently supports files only.`)
        };
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return {
          success: false,
          oldPath,
          newPath,
          message: guidanceText('guid-70d7d7a538ba7896', `Source file not found: ${oldPath}. Use list_directory to see available files.`)
        };
      }
      return {
        success: false,
        oldPath,
        newPath,
        message: guidanceText('guid-f2f869b6416e2c1f', `Failed to inspect source file: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
            message: guidanceText('guid-c8b93e38ff98c747', `Target file already exists: ${newPath}. Use overwrite=true to replace it.`)
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
              message: guidanceText('guid-3092b9ad1f78e841', `Target path is a directory: ${newPath}. Please provide a file path.`)
            };
          }
          await this.removeProtectedFile(newFullPath);
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      try {
        await this.renameProtectedFile(oldFullPath, newFullPath);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EXDEV') {
          this.assertNoticeMutation(relative(this.vaultPath, oldFullPath));
          this.assertNoticeMutation(relative(this.vaultPath, newFullPath));
          await copyFile(oldFullPath, newFullPath);
          await this.removeProtectedFile(oldFullPath);
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
        message: guidanceText('guid-78db676dca462cf3', `Successfully moved file from ${oldPath} to ${newPath}`)
      };
    } catch (error) {
      return {
        success: false,
        oldPath,
        newPath,
        message: guidanceText('guid-4c2b4de17c38f30e', `Failed to move file: ${error instanceof Error ? error.message : 'Unknown error'}`)
      };
    }
  }

  async readMultipleNotes(params: BatchReadParams): Promise<BatchReadResult> {
    const { paths, includeContent = true, includeFrontmatter = true, knownRevisions } = params;

    if (paths.length > 10) {
      throw guidanceError(new Error('Maximum 10 files per batch read request'), 'guid-4a096d28452931ee');
    }

    const results = await Promise.allSettled(
      paths.map(async (rawPath) => {
        const path = this.normalizePath(rawPath);
        if (!this.pathFilter.isAllowed(path)) {
          throw guidanceError(new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
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
    await this.withMutationLock(path, () => this.updateFrontmatterUnlocked({ ...params, path }));
  }

  /** Parsed Properties and revision from this write, without a later disk read. */
  async updateFrontmatterWithReceipt(params: UpdateFrontmatterParams, policy: { maxBytes?: number } = {}): Promise<{ revision: string; frontmatter: Record<string, any> }> {
    const path = this.normalizePath(params.path);
    const receipt = await this.withMutationLock(path, () => this.updateFrontmatterUnlocked({ ...params, path }, policy.maxBytes));
    return { revision: receipt.revision, frontmatter: this.frontmatterHandler.parse(receipt.originalContent).frontmatter };
  }

  /**
   * Preview a note move without changing files. Markdown, Properties, and
   * Obsidian links remain authoritative, so this resolves one bounded,
   * explainable rewrite plan. Applying that plan remains explicit and
   * revision-checked through moveNote(updateLinks=true).
   */
  async previewMoveNote(params: MoveNotePreviewParams, canAccessPath: (path: string) => boolean = () => true): Promise<MoveNotePreviewResult> {
    const oldPath = this.normalizeReferenceMutationPath(params.oldPath);
    const newPath = this.normalizeReferenceMutationPath(params.newPath);
    if (!this.pathFilter.isAllowed(oldPath) || !canAccessPath(oldPath)) throw guidanceError(new Error(`Access denied: ${oldPath}`), 'guid-26a1bd21fd48991f');
    if (!this.pathFilter.isAllowed(newPath) || !canAccessPath(newPath)) throw guidanceError(new Error(`Access denied: ${newPath}`), 'guid-26a1bd21fd48991f');
    const requestedLimit = params.limit ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw guidanceError(new Error('limit must be a positive integer'), 'guid-14abe8b02cfc3624');
    const limit = Math.min(requestedLimit, 200);
    const scan = await this.collectMoveReferencePlans(oldPath, newPath, canAccessPath);
    const [targetExists, collision] = await Promise.all([this.noteExists(oldPath), this.noteExists(newPath)]);
    const affectedLinks: MoveNotePreviewResult['affectedLinks'] = [];
    const affectedProperties: MoveNotePreviewResult['affectedProperties'] = [];
    const ambiguousReferences: MoveNotePreviewResult['ambiguousReferences'] = [];
    for (const { plan } of scan.plans) {
      affectedLinks.push(...plan.linkChanges);
      affectedProperties.push(...plan.propertyChanges);
      ambiguousReferences.push(...plan.ambiguous);
    }
    const total = affectedLinks.length + affectedProperties.length;
    const returnedAmbiguous = ambiguousReferences.slice(0, limit);
    const linkBudget = Math.max(0, limit - returnedAmbiguous.length);
    const returnedLinks = affectedLinks.slice(0, linkBudget);
    const propertyBudget = Math.max(0, linkBudget - returnedLinks.length);
    const returnedProperties = affectedProperties.slice(0, propertyBudget);
    const returnedCount = returnedAmbiguous.length + returnedLinks.length + returnedProperties.length;
    return {
      oldPath,
      newPath,
      targetExists,
      collision,
      affectedLinks: returnedLinks,
      affectedProperties: returnedProperties,
      ambiguousReferences: returnedAmbiguous,
      ambiguousTotal: ambiguousReferences.length,
      hiddenReferencesPresent: scan.hiddenReferencesPresent,
      total,
      truncated: total + ambiguousReferences.length > returnedCount,
      message: scan.hiddenReferencesPresent
        ? 'The move affects an inaccessible scope or hidden identity collision. No hidden path is disclosed; an administrator with access to every affected scope must perform this move.'
        : ambiguousReferences.length > 0
        ? 'Disambiguate every reported reference before using updateLinks=true; the server will refuse to guess which same-name note was intended.'
        : total > 0
          ? 'Review the bounded body and Property rewrite plan, then pass updateLinks=true with the current source revision to apply it transactionally with the move.'
          : 'No visible body or Property reference requires rewriting. The move still requires normal revision and Git review.',
    };
  }

  private async updateFrontmatterUnlocked(params: UpdateFrontmatterParams, maxBytes?: number): Promise<{ revision: string; originalContent: string }> {
    const { frontmatter, merge = true, expectedRevision } = params;
    const path = this.normalizePath(params.path);

    if (!this.pathFilter.isAllowed(path)) {
      throw guidanceError(new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
    }

    await this.assertExpectedRevision(path, expectedRevision, maxBytes);

    // Read the existing note
    const note = await this.readNote(path, maxBytes);

    // Prepare new frontmatter
    const newFrontmatter = merge
      ? { ...note.frontmatter, ...frontmatter }
      : frontmatter;

    // Validate the new frontmatter
    const validation = this.frontmatterHandler.validate(newFrontmatter);
    if (!validation.isValid) {
      throw guidanceError(new Error(`Invalid frontmatter: ${validation.errors.join(', ')}`), 'guid-bbacd231de0f80bb');
    }

    const fullPath = this.resolveWritablePath(path);

    if (merge && note.matter && note.matter.trim() !== '') {
      // Preserve raw formatting for unmodified fields
      const updatedContent = this.frontmatterHandler.preserveStringify(note.matter, frontmatter, note.content);
      assertNoteContentSize(updatedContent, path);
      await this.writeProtectedFile(fullPath, updatedContent, 'utf-8');
      // Frontmatter-only mutations bypass writeNoteUnlocked, so explicitly
      // invalidate the shared catalog/index read models before returning.
      this.notifyNoteChanged(path, 'upsert');
      return { revision: this.revision(updatedContent), originalContent: updatedContent };
    } else {
      // Replace frontmatter entirely (or no existing matter to preserve)
      return this.writeNoteUnlocked({
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
          throw guidanceError(new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
        }

        const fullPath = this.resolvePath(path);
        assertEnterpriseStorageAccess(path);

        let stats;
        try {
          stats = await stat(fullPath);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            throw guidanceError(new Error(`File not found: ${path}`), 'guid-1d1a89434322658c');
          }
          throw error;
        }

        const size = stats.size;
        const lastModified = stats.mtime.getTime();

        // Quick check for frontmatter without reading full content
        assertEnterpriseStorageAccess(path);
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
    assertEnterpriseStorageFresh();

    // Return only successful results, filter out failed ones
    return results
      .filter((result): result is PromiseFulfilledResult<NoteInfo> => result.status === 'fulfilled')
      .map(result => result.value);
  }

  async manageTags(params: TagManagementParams): Promise<TagManagementResult> {
    const path = this.normalizePath(params.path);
    return this.withMutationLock(path, () => this.manageTagsUnlocked({ ...params, path }));
  }

  private async manageTagsUnlocked(params: TagManagementParams): Promise<TagManagementResult> {
    const { operation, tags = [] } = params;
    const path = this.normalizePath(params.path);

    if (!this.pathFilter.isAllowed(path)) {
      return {
        path,
        operation,
        tags: [],
        success: false,
        message: guidanceText('guid-58d6655434915c22', `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`)
      };
    }

    try {
      if (!['list', 'add', 'remove'].includes(operation)) throw guidanceError(new Error('Invalid tag operation'), 'guid-ddc843b4c8dc70b9');
      const note = await this.readNote(path);
      if (isModerationHidden(note.frontmatter)) throw guidanceError(new Error(`Access denied: ${path}`), 'guid-26a1bd21fd48991f');
      if (params.expectedRevision !== undefined && params.expectedRevision !== note.revision) {
        throw guidanceError(new Error(`Revision conflict for ${path}. Read the note again before changing its tags.`), 'guid-8ad13a0f7e9b6bae');
      }
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
      const inlineTags = extractInlineTags(note.content);
      currentTags = [...new Set([...currentTags, ...inlineTags])]; // Deduplicate

      if (operation === 'list') {
        return {
          path,
          operation,
          tags: currentTags,
          revision: note.revision,
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
      // The lock serializes this service's writers. Also reject external edits
      // observed after deriving tags; this is a recheck, not filesystem CAS.
      await this.assertExpectedRevision(path, note.revision);
      await this.writeProtectedFile(fullPath, updatedContent, 'utf-8');
      this.notifyNoteChanged(path, 'upsert');

      return {
        path,
        operation,
        tags: newTags,
        success: true,
        previousRevision: note.revision,
        revision: this.revision(updatedContent),
        message: guidanceText('guid-c105c5e66e7b725d', `Successfully ${operation === 'add' ? 'added' : 'removed'} tags`)
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
  async findPathForWikiLink(wikiLinkName: string, canAccessPath: (path: string) => boolean = () => true, sourcePath?: string): Promise<string[]> {
    return this.findPathsForNoteReference(wikiLinkName, canAccessPath, sourcePath === undefined ? {} : { sourcePath });
  }

  async findPathForMarkdownLink(target: string, sourcePath: string, canAccessPath: (path: string) => boolean = () => true): Promise<string[]> {
    return this.findPathsForNoteReference(target, canAccessPath, { sourcePath, syntax: 'markdown' });
  }

  /** Request-local resolver for bounded multi-note workflows. Without an index,
   * or with fresh:true (which bypasses it without refreshing),
   * enumerate paths once; only bare identity terms require alias metadata, and
   * all such reads go through the caller's visibility/budget/revision reader. */
  createNoteReferenceResolver(canAccessPath: (path: string) => boolean, readMetadata: (path: string) => Promise<QueryNote | undefined>, policy: { fresh?: boolean } = {}) {
    let pathIndex: Promise<NoteReferenceIndex> | undefined;
    let aliasIndex: Promise<NoteReferenceIndex> | undefined;
    const getPaths = () => pathIndex ||= this.collectVaultFiles().then(paths => buildNoteReferenceIndex(paths
      .filter(path => this.pathFilter.isAllowed(path) && canAccessPath(path) && /\.(?:md|markdown|txt)$/i.test(path))
      .map(path => ({ path }))));
    return async (target: string, options: Pick<ResolveNoteReferenceOptions, 'sourcePath' | 'syntax'> = {}): Promise<string[]> => {
      if (!target.trim()) return [];
      if (this.metadataIndex && !policy.fresh) return this.metadataIndex.resolveNoteReference(target, canAccessPath, options.sourcePath, options.syntax);
      const document = noteReferenceDocument(target).replace(/\\/g, '/');
      const needsAliases = options.syntax !== 'markdown' && !document.includes('/') && !/\.(?:md|markdown|txt)$/i.test(document);
      if (needsAliases && !aliasIndex) aliasIndex = (async () => {
        const descriptors: NoteReferenceDescriptor[] = [];
        for (const path of (await getPaths()).paths) {
          if (!this.pathFilter.isAllowed(path) || !canAccessPath(path)) continue;
          const note = await readMetadata(path);
          if (!note || isModerationHidden(note.frontmatter)) continue;
          descriptors.push({ path: note.path, title: note.frontmatter.title, aliases: note.frontmatter.aliases,
            preferredTerm: note.frontmatter.preferred_term, stableId: note.frontmatter.stable_id });
        }
        return buildNoteReferenceIndex(descriptors);
      })();
      return resolveNoteReference(target, await (needsAliases ? aliasIndex! : getPaths()), options)
        .filter(path => this.pathFilter.isAllowed(path) && canAccessPath(path));
    };
  }

  private async findPathsForNoteReference(wikiLinkName: string, canAccessPath: (path: string) => boolean, options: ResolveNoteReferenceOptions): Promise<string[]> {
    if (!wikiLinkName.trim()) {
      throw guidanceError(new Error('Empty wiki link — provide a document name inside [[ ]].'), 'guid-142717dc0a040dd0');
    }
    if (this.metadataIndex) {
      const indexedMatches = await this.metadataIndex.resolveNoteReference(wikiLinkName, canAccessPath, options.sourcePath, options.syntax);
      return indexedMatches.sort((a, b) => {
        const da = a.split('/').length;
        const db = b.split('/').length;
        return da !== db ? da - db : a.localeCompare(b);
      });
    }
    const notePaths = (await this.collectVaultFiles())
      .filter(path => this.pathFilter.isAllowed(path) && canAccessPath(path))
      .filter(path => /\.(?:md|markdown|txt)$/i.test(path));
    const descriptors: NoteReferenceDescriptor[] = [];
    const readBatchSize = 32;
    for (let offset = 0; offset < notePaths.length; offset += readBatchSize) {
      const batch = await Promise.all(notePaths.slice(offset, offset + readBatchSize).map(async path => {
        if (!canReadEnterpriseStoragePath(path)) return undefined;
        try {
          if (!this.pathFilter.isAllowed(path) || !canAccessPath(path)) return undefined;
          const header = await this.vaultIo.readUtf8Header(this.resolvePath(path));
          if (!this.pathFilter.isAllowed(path) || !canAccessPath(path)) return undefined;
          const frontmatter = this.frontmatterHandler.parse(header).frontmatter || {};
          return {
            path,
            title: frontmatter.title,
            aliases: frontmatter.aliases,
            preferredTerm: frontmatter.preferred_term,
            stableId: frontmatter.stable_id,
          } satisfies NoteReferenceDescriptor;
        } catch {
          // A concurrently removed or unreadable note is not a match.
          return undefined;
        }
      }));
      assertEnterpriseStorageFresh();
      for (const entry of batch) if (entry) descriptors.push(entry);
    }

    const visible = descriptors.filter(({ path }) => this.pathFilter.isAllowed(path) && canAccessPath(path));
    const matches = resolveNoteReference(wikiLinkName, buildNoteReferenceIndex(visible), {
      ...options,
      canReference: (source, target) => this.pathFilter.isAllowed(target) && canAccessPath(target)
        && (!options.canReference || options.canReference(source, target)),
    });

    // Depth-ascending (root-first), alphabetical tiebreak at equal depth.
    // Standalone callers omit sourcePath; note-bound readers can resolve ./ and ../.
    matches.sort((a, b) => {
      const da = a.split('/').length;
      const db = b.split('/').length;
      return da !== db ? da - db : a.localeCompare(b);
    });

    return matches;
  }

  async getBacklinks(path: string, limit: number = 100, canAccessPath: (path: string) => boolean = () => true, offset = 0, options: { includeSourceRevision?: boolean; includeSnapshot?: boolean; expectedRevision?: string } = {}): Promise<BacklinksResult> {
    const target = this.normalizePath(path);
    if (!this.pathFilter.isAllowed(target) || !canAccessPath(target)) throw guidanceError(new Error(`Access denied: ${target}`), 'guid-26a1bd21fd48991f');
    const targetNote = options.expectedRevision === undefined ? await this.readNote(target)
      : (await this.readNoteMetadata([target], canAccessPath, { fresh: true, strict: true }))[0];
    if (!targetNote || (options.expectedRevision !== undefined && targetNote.revision !== options.expectedRevision)) throw guidanceError(new Error('Backlink target revision changed'), 'guid-12470c1f8fe1a635');
    if (isModerationHidden(targetNote.frontmatter)) throw guidanceError(new Error(`Access denied: ${target}`), 'guid-26a1bd21fd48991f');
    return this.withGraphRead(graph => graph.withStableRead(canAccessPath, async () => {
      const result = await graph.getBacklinks(target, limit, canAccessPath, offset, async (sourcePath, revision) => {
        try {
          const current = await this.readNoteMetadata([sourcePath], canAccessPath, { fresh: true, strict: true });
          if (!current.length || isModerationHidden(current[0]!.frontmatter)) return false;
          if (current[0]!.revision !== revision) throw guidanceError(new Error('stale author'), 'guid-0bef5f45bbea9266');
          return true;
        } catch {
          graph.invalidate(sourcePath);
          throw guidanceError(new Error('Graph source changed or became unavailable; retry the query to refresh its snapshot.'), 'guid-16d3d56b92981cc2');
        }
      }, true, options.includeSnapshot, targets => this.assertGraphTargetRevisions(graph, targets, canAccessPath));
      await this.assertGraphReadRevision(graph, target, result.targetRevision, canAccessPath, targetNote.revision);
      const sources = [...new Map(result.backlinks.map(link => [link.path, link.sourceRevision])).entries()];
      for (let offset = 0; offset < sources.length; offset += 8) {
        await Promise.all(sources.slice(offset, offset + 8).map(([path, revision]) => this.assertGraphReadRevision(graph, path, revision, canAccessPath)));
      }
      if (options.includeSourceRevision) return result;
      const { targetRevision: _targetRevision, ...publicResult } = result;
      return { ...publicResult, backlinks: result.backlinks.map(({ sourceRevision: _sourceRevision, ...link }) => link) };
    }));
  }

  private async assertGraphReadRevision(graph: VaultGraphIndex, path: string, revision: string | undefined, canAccessPath: (path: string) => boolean, capturedRevision?: string, maxBytes?: number): Promise<void> {
    try {
      if (!revision || (capturedRevision !== undefined && revision !== capturedRevision)
        || !this.pathFilter.isAllowed(path) || !canAccessPath(path)
        || await this.readNoteRevision(path, maxBytes) !== revision || !canAccessPath(path)) throw guidanceError(new Error('stale graph source'), 'guid-0139a3fdfe186400');
    } catch {
      graph.invalidate(path);
      throw guidanceError(new Error('Graph source changed or became unavailable; retry the query to refresh its snapshot.'), 'guid-16d3d56b92981cc2');
    }
  }

  private async withGraphRead<T>(read: (graph: VaultGraphIndex) => Promise<T>): Promise<T> {
    if (this.graphIndex) return read(this.graphIndex);
    const graph = new VaultGraphIndex(this.vaultPath, this.pathFilter, this.frontmatterHandler, undefined, this.vaultIo);
    try { return await read(graph); }
    finally { graph.close(); }
  }

  private async assertGraphTargetRevisions(graph: VaultGraphIndex, targets: ReadonlyMap<string, string>, canAccessPath: (path: string) => boolean): Promise<void> {
    const entries = [...targets];
    for (let offset = 0; offset < entries.length; offset += 8) {
      // Drain failures before a temporary graph can be released. Off-page
      // dependencies also affect the complete navigation fingerprint.
      const checked = await Promise.allSettled(entries.slice(offset, offset + 8)
        .map(([path, revision]) => this.assertGraphReadRevision(graph, path, revision, canAccessPath, undefined, MAX_NOTE_CONTENT_BYTES)));
      const failed = checked.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
  }

  async getOutlinks(path: string, limit: number = 100, canAccessPath: (path: string) => boolean = () => true, offset = 0, options: { includeSourceRevision?: boolean; includeSnapshot?: boolean } = {}): Promise<OutlinksResult> {
    const source = this.normalizePath(path);
    if (!this.pathFilter.isAllowed(source) || !canAccessPath(source)) throw guidanceError(new Error(`Access denied: ${source}`), 'guid-26a1bd21fd48991f');
    const note = await this.readNote(source);
    if (isModerationHidden(note.frontmatter)) throw guidanceError(new Error(`Access denied: ${source}`), 'guid-26a1bd21fd48991f');
    return this.withGraphRead(graph => graph.withStableRead(canAccessPath, async () => {
      const result = await graph.getOutlinks(source, limit, canAccessPath, offset, true, options.includeSnapshot,
        targets => this.assertGraphTargetRevisions(graph, targets, canAccessPath));
      await this.assertGraphReadRevision(graph, source, result.sourceRevision, canAccessPath, note.revision);
      if (options.includeSourceRevision) return result;
      const { sourceRevision: _sourceRevision, ...publicResult } = result;
      return publicResult;
    }));
  }

  async findUnresolvedLinks(limit: number = 100, canAccessPath: (path: string) => boolean = () => true, offset = 0, options: { includeSnapshot?: boolean } = {}): Promise<UnresolvedLinksResult> {
    return this.withGraphRead(graph => graph.findUnresolvedLinks(limit, canAccessPath, offset, options.includeSnapshot));
  }

  async findOrphanNotes(limit: number = 100, canAccessPath: (path: string) => boolean = () => true, offset = 0, options: { includeSnapshot?: boolean; includeCandidate?: (path: string) => boolean } = {}): Promise<OrphanNotesResult> {
    return this.withGraphRead(graph => graph.findOrphanNotes(limit, canAccessPath, offset, options.includeSnapshot, options.includeCandidate));
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
      throw guidanceError(new Error('content is required for the append action'), 'guid-01acdcd56099713a');
    }

    const alreadyExists = await this.exists(path);
    if (params.action === 'create' && alreadyExists) {
      return {
        success: true,
        action: 'create',
        date,
        path,
        created: false,
        message: guidanceText('guid-24d7960d163adde5', 'Daily note already exists; it was not overwritten.'),
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

  private async collectVaultFiles(recordSource = true): Promise<string[]> {
    const files: string[] = [];
    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      assertEnterpriseStorageFresh();
      if (relativePath && !this.canTraverseEnterpriseReadPath(relativePath, recordSource)) return;
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (this.pathFilter.isAllowedForListing(entryRelativePath)) {
            await scanDirectory(fullEntryPath, entryRelativePath);
          }
        } else if (entry.isFile() && this.pathFilter.isAllowedForListing(entryRelativePath)
          && canReadEnterpriseStoragePath(entryRelativePath, recordSource)) {
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
      throw guidanceError(new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
    }
    const fullPath = this.resolvePath(path);
    assertEnterpriseStorageAccess(path);
    const raw = await readFile(fullPath, 'utf-8');
    return projectNoteOutline(raw);
  }

  async readNoteLineWindow(params: ReadNoteLinesParams): Promise<{ content: string; startLine: number; endLine: number; totalLines: number }> {
    const path = this.normalizePath(params.path);
    if (!this.pathFilter.isAllowed(path)) {
      throw guidanceError(new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
    }
    const fullPath = this.resolvePath(path);
    assertEnterpriseStorageAccess(path);
    const raw = await readFile(fullPath, 'utf-8');
    return projectNoteLineWindow(raw, params);
  }

  async readNoteLines(params: ReadNoteLinesParams): Promise<string> {
    return (await this.readNoteLineWindow(params)).content;
  }

  async getVaultStats(recentCount: number = 5, canAccessPath: (path: string) => boolean = () => true): Promise<VaultStats> {
    if (!Number.isSafeInteger(recentCount) || recentCount < 0) throw guidanceError(new Error('recentCount must be a non-negative safe integer'), 'guid-f217431867bec7d5');
    recentCount = Math.min(recentCount, 20);
    let totalNotes = 0;
    let totalFolders = 0;
    let totalSize = 0;
    const recentFiles: Array<{ path: string; modified: number }> = [];

    const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
      let entries;
      assertEnterpriseStorageFresh();
      if (relativePath && !this.canTraverseEnterpriseReadPath(relativePath)) return;
      try { entries = await readdir(dirPath, { withFileTypes: true }); }
      catch (error) {
        if (relativePath && isMissingVaultPath(error)) return;
        throw new VaultReadUnavailableError();
      }

      for (const entry of entries) {
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!this.pathFilter.isAllowedForListing(entryRelativePath)) {
            continue;
          }
          if (canAccessPath(entryRelativePath) && canReadEnterpriseStoragePath(entryRelativePath)) totalFolders++;
          await scanDirectory(fullEntryPath, entryRelativePath);
        } else if (entry.isFile()) {
          if (!this.pathFilter.isAllowed(entryRelativePath) || !canAccessPath(entryRelativePath)
            || !canReadEnterpriseStoragePath(entryRelativePath)) {
            continue;
          }

          let stats;
          try {
            const checkedPath = this.resolvePath(entryRelativePath);
            stats = await stat(checkedPath);
            if (!stats.isFile()) continue;
            if (/\.(?:md|markdown|txt)$/i.test(entryRelativePath)) {
              const content = await this.vaultIo.readUtf8Bounded(checkedPath, MAX_NOTE_CONTENT_BYTES);
              if (isModerationHidden(this.frontmatterHandler.parse(content).frontmatter)) continue;
            }
          } catch (error) {
            assertEnterpriseStorageFresh();
            if (isMissingVaultPath(error)) continue;
            if (error instanceof SourceReadLimitError) throw guidanceError(new Error('Vault statistics require Markdown sources within the 8 MiB supported-note limit; no partial totals were returned.'), 'guid-099aebef449bcaf7');
            throw new VaultReadUnavailableError();
          }
          totalNotes++;
          totalSize += stats.size;

          // Track recent files
          const fileInfo = { path: entryRelativePath, modified: stats.mtime.getTime() };

          // Insert in sorted order (most recent first)
          const insertIndex = recentFiles.findIndex(f => f.modified < fileInfo.modified || (f.modified === fileInfo.modified && f.path > fileInfo.path));
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
    assertEnterpriseStorageFresh();

    return {
      totalNotes,
      totalFolders,
      totalSize,
      recentlyModified: recentFiles
    };
  }

  async listAllTags(canAccessPath: (path: string) => boolean = () => true): Promise<Array<{ tag: string; count: number }>> {
    return this.withGraphRead(graph => graph.listAllTags(canAccessPath));
  }

  private resolvePathPrefix(input?: string): string {
    const rawPathPrefix = input ? this.normalizePath(input) : '';
    if (!rawPathPrefix) return '';
    if (!this.pathFilter.isAllowedForListing(rawPathPrefix)) {
      throw guidanceError(new Error(`Access denied: ${rawPathPrefix}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
    }

    const resolvedPrefix = this.resolvePath(rawPathPrefix);
    const pathPrefix = relative(this.vaultPath, resolvedPrefix).replace(/\\/g, '/');
    if (pathPrefix && !this.pathFilter.isAllowedForListing(pathPrefix)) {
      throw guidanceError(new Error(`Access denied: ${pathPrefix}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`), 'guid-a904f1a7ce9c950e');
    }
    return pathPrefix;
  }

  async listTasks(params: ListTasksParams = {}, canAccessPath: (path: string) => boolean = () => true): Promise<ListTasksResult> {
    const status = params.status || 'open';
    if (status !== 'open' && status !== 'completed' && status !== 'all') {
      throw guidanceError(new Error('status must be open, completed, or all'), 'guid-1f4863cf189099c9');
    }
    const requestedLimit = params.limit ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw guidanceError(new Error('limit must be a positive integer'), 'guid-14abe8b02cfc3624');
    }
    const limit = Math.min(requestedLimit, 500);
    const offset = params.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw guidanceError(new Error('offset must be a non-negative safe integer'), 'guid-f732beec22ffea3f');
    if (params.expectedSnapshot !== undefined && !/^[a-f0-9]{64}$/.test(params.expectedSnapshot)) throw guidanceError(new Error('expectedSnapshot must be a SHA256 fingerprint from list_tasks'), 'guid-4421b16272afa055');
    if (offset > 0 && !params.expectedSnapshot) throw guidanceError(new Error('expectedSnapshot is required for continuation; restart list_tasks at offset 0'), 'guid-e8b3d61d7b723ebd');
    // Validate the optional scope before scanning. resolvePath performs the
    // lexical and symlink boundary checks; listing validation blocks hidden
    // and system directories such as .obsidian and .git.
    const pathPrefix = this.resolvePathPrefix(params.pathPrefix);

    const tasks: TaskItem[] = [];
    let total = 0;
    const fingerprint = createHash('sha256').update(JSON.stringify(['task-page-v1', status, pathPrefix]));
    const notePaths = (await this.collectVaultFiles())
      .filter(path => this.pathFilter.isAllowed(path))
      .filter(canAccessPath)
      .filter(path => /\.(?:md|markdown|txt)$/i.test(path))
      .filter(path => !pathPrefix || path === pathPrefix || path.startsWith(`${pathPrefix}/`))
      .sort();

    for (const path of notePaths) {
      if (!canReadEnterpriseStoragePath(path)) continue;
      let content: string;
      try {
        content = await this.vaultIo.readUtf8Bounded(this.resolvePath(path), MAX_NOTE_CONTENT_BYTES);
      } catch (error) {
        if (error instanceof SourceReadLimitError) throw guidanceError(new Error('Task inventory source exceeds 8 MiB; narrow pathPrefix or split oversized notes before retrying. No partial inventory was returned.'), 'guid-e757f8e504051c60');
        if (isMissingVaultPath(error)) continue;
        throw new VaultReadUnavailableError();
      }
      if (isModerationHidden(this.frontmatterHandler.parse(content).frontmatter)) continue;
      const revision = this.revision(content);
      for (const task of iterateMarkdownTasks(content, path)) {
        if (status !== 'all' && status !== task.status) continue;
        fingerprint.update(JSON.stringify([path, revision, task.line, task.taskId, task.status]));
        if (total >= offset && tasks.length < limit) tasks.push({ ...task, revision });
        total++;
      }
    }
    assertEnterpriseStorageFresh();
    const snapshotFingerprint = fingerprint.digest('hex');
    if (params.expectedSnapshot && params.expectedSnapshot !== snapshotFingerprint) throw guidanceError(new Error('Task listing changed; restart list_tasks at offset 0 without expectedSnapshot'), 'guid-0927a7cee655be52');
    return {
      tasks,
      total,
      truncated: total > offset + tasks.length,
      offset,
      snapshotFingerprint,
    };
  }

  async updateTask(params: UpdateTaskParams): Promise<UpdateTaskResult> {
    const path = this.normalizePath(params.path);
    if (!this.pathFilter.isAllowed(path)) throw guidanceError(new Error(`Access denied: ${path}`), 'guid-26a1bd21fd48991f');
    if (!params.taskId && (!Number.isInteger(params.line) || params.line! < 1)) throw guidanceError(new Error('taskId or line must identify a task'), 'guid-40a11acf501ea9bc');
    if (params.status !== 'open' && params.status !== 'completed') throw guidanceError(new Error('status must be open or completed'), 'guid-978b748c0ffab0dd');
    if (!params.expectedRevision || !String(params.expectedRevision).trim()) throw guidanceError(new Error('expectedRevision is required; read the note first'), 'guid-daa24c6dc3a34e33');

    return this.withMutationLock(path, async () => {
      await this.assertExpectedRevision(path, params.expectedRevision);
      const note = await this.readNote(path);
      if (isModerationHidden(note.frontmatter)) throw guidanceError(new Error(`Access denied: ${path}`), 'guid-26a1bd21fd48991f');
      if (note.revision !== params.expectedRevision) throw guidanceError(new Error(`Revision conflict for ${path}: refresh list_tasks and retry`), 'guid-7947bdeae123b557');
      const lines = note.originalContent.split('\n');
      const candidates = extractMarkdownTasks(note.originalContent, path).filter(task =>
        params.taskId ? task.taskId === params.taskId : task.line === params.line);
      if (candidates.length > 1) throw guidanceError(new Error(`Task identity is ambiguous in ${path}; read the current note and use an explicit line without taskId, or repair duplicate block IDs`), 'guid-8f746dad735fa98d');
      const locatedTask = candidates[0];
      if (params.taskId && !locatedTask) throw guidanceError(new Error(`Task ${params.taskId} was not found in ${path}; refresh list_tasks and retry`), 'guid-a3324e681d909535');
      const targetLine = locatedTask?.line ?? params.line!;
      if (targetLine > lines.length) throw guidanceError(new Error(`Task line ${targetLine} is outside ${path}`), 'guid-582a62891a8696c6');
      const targetIndex = targetLine - 1;
      const targetMatch = locatedTask
        ? /^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/.exec(lines[targetIndex]!.replace(/\r$/, ''))
        : null;
      if (!targetMatch) throw guidanceError(new Error(`Line ${targetLine} is not a Markdown checkbox task outside frontmatter/code fences`), 'guid-8d00a426165904da');
      const previousStatus: 'open' | 'completed' = targetMatch[2]!.toLowerCase() === 'x' ? 'completed' : 'open';
      const marker = params.status === 'completed' ? 'x' : ' ';
      let revision = note.revision;
      if (previousStatus !== params.status) {
        const rawLine = lines[targetIndex]!;
        const checkboxOffset = (targetMatch.index || 0) + targetMatch[1]!.length;
        lines[targetIndex] = `${rawLine.slice(0, checkboxOffset)}${marker}${rawLine.slice(checkboxOffset + 1)}`;
        // We already hold this path's mutation lock. Calling the public
        // writeNote wrapper here would queue behind our own lock forever.
        const receipt = await this.writeNoteUnlocked({ path, content: lines.join('\n'), expectedRevision: params.expectedRevision });
        revision = receipt.revision;
      }
      // A receipt describes this operation, not a subsequent external edit.
      // For a no-op it identifies the inspected snapshot; callers re-read for
      // current state before making another decision.
      const resultingTaskId = locatedTask?.taskId;
      return {
        success: true,
        path,
        line: targetLine,
        status: params.status,
        ...(resultingTaskId ? { taskId: resultingTaskId } : {}),
        previousStatus,
        previousRevision: note.revision,
        revision,
        message: previousStatus === params.status ? 'Task already had the requested status; no write was needed.' : `Task status updated to ${params.status}.`,
      };
    });
  }

  /** Hydrate one admitted metadata row without mixing revisions or reading an unbounded source. */
  async readQueryNoteBody(note: QueryNote, canAccessPath: (path: string) => boolean, canReadNote: (note: QueryNote) => boolean): Promise<QueryNote> {
    const path = this.normalizePath(note.path);
    if (!note.revision || !this.pathFilter.isAllowed(path) || !canAccessPath(path)
      || !canReadEnterpriseStoragePath(path) || !canReadNote(note)) throw new QuerySnapshotChangedError();
    return this.hydrateQueryNote({ ...note, path }, canAccessPath, canReadNote,
      resolved => this.vaultIo.readUtf8Bounded(resolved, MAX_NOTE_CONTENT_BYTES));
  }

  private async hydrateQueryNote(note: QueryNote, canAccessPath: (path: string) => boolean, canReadNote: (note: QueryNote) => boolean, read: (path: string) => Promise<string>): Promise<QueryNote> {
    if (!canReadEnterpriseStoragePath(note.path)) throw new QuerySnapshotChangedError();
    let raw: string;
    try { raw = await read(this.resolvePath(note.path)); }
    catch (error) {
      if (error instanceof SourceReadLimitError) throw error;
      if (isMissingVaultPath(error)) throw new QuerySnapshotChangedError();
      throw new VaultReadUnavailableError();
    }
    if (this.revision(raw) !== note.revision || !canAccessPath(note.path)
      || !canReadEnterpriseStoragePath(note.path)) throw new QuerySnapshotChangedError();
    const parsed = this.frontmatterHandler.parse(raw);
    const current = { path: note.path, revision: note.revision, frontmatter: parsed.frontmatter, content: parsed.content };
    if (!canReadNote(current)) throw new QuerySnapshotChangedError();
    return current;
  }

  async queryNotesBounded(params: QueryNotesParams, maxChars: number, canAccessPath: (path: string) => boolean, canReadNote: (note: QueryNote) => boolean, prettyPrint = false): Promise<PackedQueryPage> {
    if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 20000) throw guidanceError(new Error('maxChars must be an integer between 512 and 20000'), 'guid-cc408e854eb4b949');
    if (params.after && params.after.context !== params.cursorContext) throw new Error('Query navigation or authorization changed; restart without after');
    const page = await this.queryNotes({ ...params, includeContent: false }, canAccessPath, canReadNote);
    let remainingBytes = 1024 * 1024;
    return packQueryPage(page, {
      maxChars, prettyPrint, includeContent: params.includeContent === true,
      cursorFor: note => ({ ...cursorForQueryNote(note, params.sortBy || 'path'), ...(params.cursorContext && { context: params.cursorContext }) }),
      hydrate: async note => {
        if (remainingBytes <= 1) return undefined;
        const allowance = Math.min(256 * 1024, remainingBytes - 1);
        try {
          return await this.hydrateQueryNote(note, canAccessPath, canReadNote, async path => {
            const raw = await this.vaultIo.readUtf8Bounded(path, allowance);
            remainingBytes -= Buffer.byteLength(raw, 'utf8');
            return raw;
          });
        } catch (error) {
          if (!(error instanceof SourceReadLimitError)) throw error;
          // Conservative charge also covers growth detected after the initial stat.
          remainingBytes -= allowance + 1;
          return undefined;
        }
      },
    });
  }

  /** Fresh sequential metadata scan with bounded reads from the first file.
   * Discovery retains path names, not all note metadata or bodies. No index
   * refresh or unrestricted query fallback occurs in this iterator. */
  async *iterateFreshNoteMetadata(canAccessPath: (path: string) => boolean, options: { afterPath?: string; sortByPath?: boolean; sortOrder?: 'asc' | 'desc'; deferDiscoveryObservation?: boolean; maxBytes?: number; strictMissing?: boolean } = {}): AsyncGenerator<QueryNote> {
    const paths = await this.collectVaultFiles(!options.deferDiscoveryObservation);
    if (options.sortByPath) paths.sort((a, b) => (options.sortOrder === 'desc' ? -1 : 1) * a.localeCompare(b));
    for (const path of paths) {
      if (!/\.(?:md|markdown|txt)$/i.test(path) || !this.pathFilter.isAllowed(path) || !canAccessPath(path)) continue;
      if (options.afterPath && path.localeCompare(options.afterPath) <= 0) continue;
      let notes: QueryNote[];
      try { notes = await this.readNoteMetadata([path], canAccessPath, { fresh: true, strict: true, maxBytes: options.maxBytes ?? MAX_NOTE_CONTENT_BYTES }); }
      catch { throw guidanceError(new Error('Bounded metadata inventory unavailable or too large; inspect sources before retrying.'), 'guid-35b6f32664b26275'); }
      if (!notes[0] && options.strictMissing) throw guidanceError(new Error('Bounded metadata inventory changed or unavailable; repeat the query.'), 'guid-a349aacbec327823');
      if (notes[0]) yield notes[0];
    }
  }

  /** Internal whole-inventory consumer. Unlike independent cursor pages, all
   * rows belong to one captured metadata cohort. This is not an OS transaction. */
  async readQueryInventory(
    canAccessPath: (path: string) => boolean,
    canReadNote: (note: QueryNote) => boolean,
    includeContentFor?: (note: QueryNote) => boolean,
    consumeContent?: (note: QueryNote) => void | Promise<void>,
  ): Promise<QueryNote[]> {
    // Consumers collect request-local projections only. Their results are not
    // valid unless this method's final cohort validation succeeds.
    const consume = async (note: QueryNote): Promise<QueryNote> => {
      if (!consumeContent) return note;
      try { await consumeContent(note); }
      catch { throw guidanceError(new Error('Inventory content projection failed; retry the request.'), 'guid-3cb70eee217eaea5'); }
      const { content: _content, ...metadata } = note;
      return metadata;
    };
    const admitted = (note: QueryNote) => this.pathFilter.isAllowed(note.path)
      && canAccessPath(note.path) && canReadEnterpriseStoragePath(note.path) && canReadNote(note);
    const captureMetadata = async (): Promise<QueryNote[]> => (await this.metadataIndex!.list())
      .map(entry => ({ path: this.normalizePath(entry.path), frontmatter: entry.frontmatter, revision: entry.revision }))
      .filter(admitted);
    if (!this.metadataIndex) {
      const paths = (await this.collectVaultFiles()).map(path => this.normalizePath(path))
        .filter(path => /\.(?:md|markdown|txt)$/i.test(path) && this.pathFilter.isAllowed(path) && canAccessPath(path));
      const notes: QueryNote[] = [];
      for (const path of paths) {
        if (!canReadEnterpriseStoragePath(path)) continue;
        let raw: string;
        try { raw = await this.vaultIo.readUtf8Bounded(this.resolvePath(path), MAX_NOTE_CONTENT_BYTES); }
        catch (error) {
          if (error instanceof SourceReadLimitError) throw error;
          if (isMissingVaultPath(error)) throw new QuerySnapshotChangedError();
          throw new VaultReadUnavailableError();
        }
        const parsed = this.frontmatterHandler.parse(raw);
        const note: QueryNote = { path, frontmatter: parsed.frontmatter, revision: this.revision(raw) };
        if (admitted(note)) notes.push(includeContentFor?.(note) ? await consume({ ...note, content: parsed.content }) : note);
      }
      if (notes.some(note => !admitted(note))) throw new QuerySnapshotChangedError();
      return notes;
    }
    const notes = await captureMetadata();
    if (!includeContentFor) return notes;
    const selected = notes.filter(includeContentFor);
    if (!selected.length) return notes;
    const hydrated = new Map<string, QueryNote>();
    for (let start = 0; start < selected.length; start += 16) {
      const batch = await Promise.allSettled(selected.slice(start, start + 16).map(async note =>
        consume(await this.hydrateQueryNote(note, canAccessPath, canReadNote,
          path => this.vaultIo.readUtf8Bounded(path, MAX_NOTE_CONTENT_BYTES)))));
      const failure = batch.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      for (const result of batch) if (result.status === 'fulfilled') hydrated.set(result.value.path, result.value);
    }
    // A prerequisite, alias candidate or visibility change can invalidate the
    // plan even when no selected project's own body changed.
    const current = await captureMetadata();
    const revisions = new Map(current.map(note => [note.path, note.revision]));
    if (current.length !== notes.length || notes.some(note => !revisions.has(note.path) || revisions.get(note.path) !== note.revision)) {
      throw new QuerySnapshotChangedError();
    }
    return notes.map(note => hydrated.get(note.path) || note);
  }

  /** Complete the metadata read barrier before consumers capture their generation. */
  prepareMetadataRead(): Promise<void> | undefined { return this.metadataIndex?.prepareRead(); }

  async queryNotes(params: QueryNotesParams = {}, canAccessPath: (path: string) => boolean = () => true, canReadNote: (note: QueryNote) => boolean = () => true): Promise<QueryNotesResult> {
    assertEnterpriseStorageFresh();
    const effectiveCanAccessPath = (path: string): boolean => canAccessPath(path) && canReadEnterpriseStoragePath(path, !params.freshMetadata);
    const requestedLimit = params.limit ?? 100;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw guidanceError(new Error('limit must be a positive integer'), 'guid-14abe8b02cfc3624');
    }
    const limit = Math.min(requestedLimit, 500);
    const requestedOffset = params.offset ?? 0;
    if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
      throw guidanceError(new Error('offset must be a non-negative integer'), 'guid-880ff326296b27cc');
    }
    const sortOrder = params.sortOrder || 'asc';
    if (sortOrder !== 'asc' && sortOrder !== 'desc') {
      throw guidanceError(new Error('sortOrder must be asc or desc'), 'guid-c6b46c2e8497168c');
    }
    if (params.sortBy !== undefined && !params.sortBy.trim()) {
      throw guidanceError(new Error('sortBy cannot be empty'), 'guid-de74cc0ba509561c');
    }
    if (params.filters !== undefined && (typeof params.filters !== 'object' || Array.isArray(params.filters) || params.filters === null)) {
      throw guidanceError(new Error('filters must be an object'), 'guid-58c6ed4f5526e798');
    }
    if (params.after !== undefined && (!params.after || typeof params.after !== 'object' || typeof params.after.path !== 'string' || !params.after.path.trim())) {
      throw guidanceError(new Error('after must contain a cursor path'), 'guid-7f46b6003caeb709');
    }

    const pathPrefix = this.resolvePathPrefix(params.pathPrefix);
    const sortBy = params.sortBy || 'path';
    const notes: QueryNote[] = [];
    const filters = params.filters || {};
    const hydrate = (selected: QueryNote[]) => Promise.all(selected.map(note =>
      this.hydrateQueryNote(note, effectiveCanAccessPath, canReadNote, path => this.vaultIo.readUtf8(path))));
    if (this.metadataIndex && !params.freshMetadata && params.includeTotal === false) {
      const page = await this.metadataIndex.listSortedPage({
        filters,
        pathPrefix,
        sortBy,
        sortOrder,
        limit,
        offset: requestedOffset,
        ...(params.after && { after: params.after }),
        canAccessPath: effectiveCanAccessPath,
        canReadEntry: canReadNote,
      });
      const selected = page.entries.map(entry => ({ path: entry.path, frontmatter: entry.frontmatter, revision: entry.revision }));
      const nextCursor = page.truncated ? cursorForQueryNote(selected[selected.length - 1]!, sortBy) : undefined;
      if (params.includeContent) {
        const withContent = await hydrate(selected);
        return {
          notes: withContent,
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
    const indexedEntries = this.metadataIndex && !params.freshMetadata ? await this.metadataIndex.listSorted(filters, pathPrefix, sortBy, sortOrder) : undefined;
    if (params.freshMetadata) {
      const pathOrdered = sortBy === 'path';
      const admitted = (path: string) => (!pathPrefix || path === pathPrefix || path.startsWith(`${pathPrefix}/`))
        && (params.includeTotal !== false || !pathOrdered || !params.after || compareQueryNoteToCursor({ path, frontmatter: {} }, params.after, 'path', sortOrder) > 0)
        && effectiveCanAccessPath(path);
      for await (const note of this.iterateFreshNoteMetadata(admitted, { maxBytes: 64 * 1024, strictMissing: true,
        deferDiscoveryObservation: true, sortByPath: pathOrdered, sortOrder })) {
        const matches = Object.entries(filters).every(([key, expected]) => {
          const actual = getFrontmatterValue(note.frontmatter, key);
          return actual.found && frontmatterValuesEqual(actual.value, expected);
        });
        if (matches && canReadNote(note)) notes.push(note);
        if (pathOrdered && params.includeTotal === false && notes.length >= requestedOffset + limit + 1) break;
      }
    } else if (indexedEntries) {
      for (const entry of indexedEntries) {
        if (!this.pathFilter.isAllowed(entry.path) || !effectiveCanAccessPath(entry.path)) continue;
        if (pathPrefix && entry.path !== pathPrefix && !entry.path.startsWith(`${pathPrefix}/`)) continue;
        const matches = Object.entries(filters).every(([key, expected]) => {
          const actual = getFrontmatterValue(entry.frontmatter, key);
          return actual.found && frontmatterValuesEqual(actual.value, expected);
        });
        if (matches && canReadNote(entry)) notes.push({ path: entry.path, frontmatter: entry.frontmatter, revision: entry.revision });
      }
    } else {
      const notePaths = (await this.collectVaultFiles())
        .filter(path => this.pathFilter.isAllowed(path))
        .filter(effectiveCanAccessPath)
        .filter(path => /\.(?:md|markdown|txt)$/i.test(path))
        .filter(path => !pathPrefix || path === pathPrefix || path.startsWith(`${pathPrefix}/`))
        .sort((a, b) => a.localeCompare(b));

      for (const path of notePaths) {
        if (!canReadEnterpriseStoragePath(path)) continue;
        let raw: string;
        try {
          raw = await readFile(this.resolvePath(path), 'utf-8');
        } catch (error) {
          if (isMissingVaultPath(error)) throw new QuerySnapshotChangedError();
          throw new VaultReadUnavailableError();
        }

        const parsed = this.frontmatterHandler.parse(raw);
        const matches = Object.entries(filters).every(([key, expected]) => {
          const actual = getFrontmatterValue(parsed.frontmatter, key);
          return actual.found && frontmatterValuesEqual(actual.value, expected);
        });
        const note = { path, frontmatter: parsed.frontmatter, revision: this.revision(raw), ...(params.includeContent && { content: parsed.content }) };
        if (matches && canReadNote(note)) notes.push(note);
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
    if (params.includeContent && (indexedEntries || params.freshMetadata)) {
      const withContent = await hydrate(selected);
      return {
        notes: withContent,
        total: notes.length,
        truncated,
        ...(nextCursor ? { nextCursor } : {}),
      };
    }
    return {
      notes: selected,
      total: params.includeTotal === false ? -1 : notes.length,
      ...(params.includeTotal === false && { totalKnown: false }),
      truncated,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async prepareSituation(input: string, intent: import('./context-rules.js').ContextIntent, explain: boolean, canAccessPath: (path: string) => boolean) {
    assertEnterpriseStorageFresh();
    return this.metadataIndex?.prepareSituation(input, intent, explain, path =>
      path === this.normalizePath(path) && this.pathFilter.isAllowed(path) && canAccessPath(path) && canReadEnterpriseStoragePath(path));
  }

  async queryAuthorityShelf(params: {
    scheme: string;
    aroundAuthorityId?: string;
    includeUnclassified?: boolean;
    limit?: number;
  }, canAccessPath: (path: string) => boolean = () => true): Promise<AuthorityShelfResult> {
    if (!this.metadataIndex) throw guidanceError(new Error('Authority shelf queries require the metadata index'), 'guid-4c89926d25b7f89b');
    assertEnterpriseStorageFresh();
    return this.metadataIndex.queryAuthorityShelf(params, path => canAccessPath(path) && canReadEnterpriseStoragePath(path));
  }

  /** Fresh bypasses indexes; strict preserves storage failures instead of treating them as missing notes. */
  async readNoteMetadata(paths: readonly string[], canAccessPath: (path: string) => boolean = () => true, options: { fresh?: boolean; strict?: boolean; maxBytes?: number } = {}): Promise<QueryNote[]> {
    if (paths.length > 500) throw guidanceError(new Error('note metadata lookup supports at most 500 paths'), 'guid-12cc4417235fd455');
    const normalizedPaths: string[] = [];
    const seen = new Set<string>();
    for (const rawPath of paths) {
      const path = this.normalizePath(rawPath);
      const key = path.toLocaleLowerCase('en-US');
      if (!path || seen.has(key)) continue;
      seen.add(key);
      if (!this.pathFilter.isAllowed(path) || !canAccessPath(path) || !canReadEnterpriseStoragePath(path)) continue;
      normalizedPaths.push(path);
    }
    if (this.metadataIndex && !options.fresh && options.maxBytes === undefined) {
      return (await this.metadataIndex.getMany(normalizedPaths, path => canAccessPath(path) && canReadEnterpriseStoragePath(path)))
        .map(entry => ({ path: entry.path, frontmatter: entry.frontmatter, revision: entry.revision }));
    }
    const notes: QueryNote[] = [];
    for (const path of normalizedPaths) {
      if (!canReadEnterpriseStoragePath(path)) continue;
      try {
        const source = await this.vaultIo.readUtf8Metadata(this.resolvePath(path), options.maxBytes);
        const parsed = this.frontmatterHandler.parse(source.header);
        if (!canAccessPath(path) || !canReadEnterpriseStoragePath(path)) continue;
        notes.push({ path, frontmatter: parsed.frontmatter, revision: source.revision });
      } catch (error) {
        // A projected candidate may be deleted between the source scan and
        // this metadata read. Omit it rather than returning stale authority.
        const code = (error as NodeJS.ErrnoException)?.code;
        if (options.strict && code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      }
    }
    assertEnterpriseStorageFresh();
    return notes;
  }

  /** Count metadata rows without reading note bodies; used by bounded windows. */
  async countNotes(
    params: QueryNotesParams = {},
    canAccessPath: (path: string) => boolean = () => true,
    predicate: (note: QueryNote) => boolean = () => true,
  ): Promise<number> {
    assertEnterpriseStorageFresh();
    const effectiveCanAccessPath = (path: string): boolean => canAccessPath(path) && canReadEnterpriseStoragePath(path);
    const pathPrefix = this.resolvePathPrefix(params.pathPrefix);
    if (this.metadataIndex) {
      return this.metadataIndex.count(params.filters || {}, pathPrefix, effectiveCanAccessPath, entry => predicate({ path: entry.path, frontmatter: entry.frontmatter, revision: entry.revision }));
    }
    const result = await this.queryNotes({ ...params, limit: 1, includeContent: false, includeTotal: true }, effectiveCanAccessPath);
    return result.total;
  }
}
