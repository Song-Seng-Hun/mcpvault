import { join, resolve, relative, dirname, posix } from 'path';
import { homedir } from 'os';
import { readdir, stat, readFile, writeFile, unlink, mkdir, access, rename, copyFile } from 'node:fs/promises';
import { constants, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import trash from 'trash';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { generateObsidianUri } from './uri.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { buildDailyNotePath, resolveDailyDate } from './daily.js';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultIoCoordinator } from './vault-io.js';
import { buildNoteReferenceIndex, resolveNoteReference } from './note-reference.js';
import { validateJsonCanvasDocument } from './json-canvas.js';
import { acceptsPlainReference, propertyPathText } from './property-references.js';
import { assertLegacyDiscussionMutationAllowed } from './scope-access.js';
import { extractMarkdownTasks, iterateMarkdownTasks } from './markdown-tasks.js';
import { extractInlineTags } from './markdown-tags.js';
import { isModerationHidden } from './moderation-policy.js';
import { projectNoteOutline, projectNoteLineWindow } from './note-projections.js';
import { isMissingVaultPath, QuerySnapshotChangedError, VaultReadUnavailableError } from './vault-read-errors.js';
import { SourceReadLimitError } from './bounded-source-read.js';
import { packQueryPage } from './query-page.js';
/** Hard per-note write limit so stdio callers cannot exhaust the vault disk. */
export const MAX_NOTE_CONTENT_BYTES = 8 * 1024 * 1024;
/** Health scans never load arbitrarily large derived views into memory. */
export const MAX_DERIVED_VIEW_READ_BYTES = 512 * 1024;
function assertNoteContentSize(content, path) {
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > MAX_NOTE_CONTENT_BYTES) {
        throw new Error(`Note exceeds ${MAX_NOTE_CONTENT_BYTES} bytes: ${path}`);
    }
}
function getFrontmatterValue(frontmatter, key) {
    let current = frontmatter;
    for (const segment of key.split('.')) {
        if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
            return { found: false };
        }
        current = current[segment];
    }
    return { found: true, value: current };
}
function frontmatterValuesEqual(actual, expected) {
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
function compareQueryValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number')
        return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean')
        return Number(a) - Number(b);
    return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}
const TOP_K_MAX = 1_024;
function compareQueryNotes(a, b, sortBy, sortOrder) {
    const aValue = sortBy === 'path' ? a.path : getFrontmatterValue(a.frontmatter, sortBy).value;
    const bValue = sortBy === 'path' ? b.path : getFrontmatterValue(b.frontmatter, sortBy).value;
    const aMissing = aValue === undefined;
    const bMissing = bValue === undefined;
    if (aMissing !== bMissing)
        return aMissing ? 1 : -1;
    const comparison = compareQueryValues(aValue, bValue);
    if (comparison !== 0)
        return sortOrder === 'asc' ? comparison : -comparison;
    return a.path.localeCompare(b.path);
}
function normalizeNoteTarget(path) {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.(?:md|markdown|txt)$/i, '').toLowerCase();
}
function rewriteLinkText(link, sourcePath, newPath) {
    if (link.includes('[[')) {
        const prefix = link.startsWith('!') ? '![[' : '[[';
        const inner = link.slice(prefix.length, -2);
        const anchorOrAlias = inner.search(/[|#]/);
        const suffix = anchorOrAlias === -1 ? '' : inner.slice(anchorOrAlias);
        return `${prefix}${newPath}${suffix}]]`;
    }
    const markdown = /^(\[[^\]]*\]\(\s*<?)([^>\s)]+)(.*)$/s.exec(link);
    if (!markdown)
        return link;
    const destination = relative(dirname(sourcePath), newPath).replace(/\\/g, '/') || newPath;
    const rawTarget = markdown[2];
    const suffixAt = [rawTarget.indexOf('?'), rawTarget.indexOf('#')].filter(index => index >= 0).sort((a, b) => a - b)[0];
    const suffix = suffixAt === undefined ? '' : rawTarget.slice(suffixAt);
    const wrappedDestination = /<$/.test(markdown[1])
        ? `${destination}${suffix}`
        : /\s/.test(destination) ? `<${destination}${suffix}>` : `${destination}${suffix}`;
    return `${markdown[1]}${wrappedDestination}${markdown[3]}`;
}
function frontmatterEndLine(content) {
    const lines = content.split('\n');
    if (lines[0]?.replace(/\r$/, '') !== '---')
        return 0;
    for (let index = 1; index < lines.length; index += 1) {
        if (lines[index]?.replace(/\r$/, '') === '---')
            return index + 1;
    }
    return 0;
}
function isWikiSyntax(link) {
    return link.startsWith('[[') || link.startsWith('![[');
}
function resolveMarkdownLinkTargets(target, sourcePath, referenceIndex) {
    const normalizedTarget = target.replace(/\\/g, '/').trim();
    const candidate = posix.normalize(normalizedTarget.startsWith('/')
        ? normalizedTarget.slice(1)
        : posix.join(posix.dirname(sourcePath), normalizedTarget));
    if (!candidate || candidate === '..' || candidate.startsWith('../'))
        return [];
    const normalizedCandidate = candidate.toLowerCase();
    const matches = referenceIndex.qualified.get(normalizedCandidate)
        || referenceIndex.qualified.get(normalizedCandidate.replace(/\.(?:md|markdown|txt)$/i, ''));
    return [...(matches || [])].sort((left, right) => left.localeCompare(right));
}
function resolveOccurrenceTargets(link, target, sourcePath, referenceIndex) {
    return isWikiSyntax(link)
        ? resolveNoteReference(target, referenceIndex)
        : resolveMarkdownLinkTargets(target, sourcePath, referenceIndex);
}
function moveDirection(sourcePath, oldPath, targetPath) {
    const sourceIsMoved = normalizeNoteTarget(sourcePath) === normalizeNoteTarget(oldPath);
    const targetIsMoved = normalizeNoteTarget(targetPath) === normalizeNoteTarget(oldPath);
    return sourceIsMoved && targetIsMoved ? 'self' : sourceIsMoved ? 'outgoing' : 'inbound';
}
function rewriteExplicitLinks(content, sourcePath, renderedSourcePath, oldPath, newPath, referenceIndex, lineOffset = 0) {
    const lines = content.split('\n');
    const changes = [];
    const ambiguous = [];
    const occurrences = extractObsidianLinkOccurrences(content).sort((a, b) => a.line - b.line);
    const byLine = new Map();
    const replacements = new Map();
    for (const occurrence of occurrences) {
        const targets = resolveOccurrenceTargets(occurrence.link, occurrence.target, sourcePath, referenceIndex);
        const includesMovedTarget = targets.some(target => normalizeNoteTarget(target) === normalizeNoteTarget(oldPath));
        if (targets.length > 1 && includesMovedTarget) {
            ambiguous.push({ sourcePath, value: occurrence.link, candidates: targets, line: occurrence.line + lineOffset });
            continue;
        }
        if (targets.length !== 1)
            continue;
        const targetPath = targets[0];
        const targetIsMoved = normalizeNoteTarget(targetPath) === normalizeNoteTarget(oldPath);
        const sourceIsMoved = normalizeNoteTarget(sourcePath) === normalizeNoteTarget(oldPath);
        if (!targetIsMoved && !(sourceIsMoved && !isWikiSyntax(occurrence.link)))
            continue;
        const renderedTarget = targetIsMoved ? newPath : targetPath;
        const replacement = rewriteLinkText(occurrence.link, renderedSourcePath, renderedTarget);
        if (replacement === occurrence.link)
            continue;
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
            if (offset === -1)
                continue;
            const replacement = replacements.get(occurrence);
            if (!replacement)
                continue;
            line = `${line.slice(0, offset)}${replacement}${line.slice(offset + occurrence.link.length)}`;
            cursor = offset + replacement.length;
        }
        lines[lineNumber - 1] = line;
    }
    return { content: lines.join('\n'), changes, ambiguous };
}
function rewritePlainReference(value, oldPath, newPath, referenceIndex) {
    const trimmed = value.trim();
    if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('#'))
        return {};
    const suffixAt = [trimmed.indexOf('?'), trimmed.indexOf('#')].filter(index => index >= 0).sort((a, b) => a - b)[0];
    const document = suffixAt === undefined ? trimmed : trimmed.slice(0, suffixAt);
    const suffix = suffixAt === undefined ? '' : trimmed.slice(suffixAt);
    const targets = resolveNoteReference(document, referenceIndex);
    const includesMovedTarget = targets.some(target => normalizeNoteTarget(target) === normalizeNoteTarget(oldPath));
    if (targets.length > 1 && includesMovedTarget)
        return { candidates: targets };
    if (targets.length !== 1 || !includesMovedTarget)
        return {};
    const keepExtension = /\.(?:md|markdown|txt)$/i.test(document);
    return { replacement: `${keepExtension ? newPath : newPath.replace(/\.(?:md|markdown|txt)$/i, '')}${suffix}` };
}
function rewriteFrontmatterReferences(frontmatter, sourcePath, renderedSourcePath, oldPath, newPath, referenceIndex) {
    const changes = [];
    const ambiguous = [];
    const visit = (value, segments) => {
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
                    direction: explicit.changes[0].direction,
                });
                return explicit.content;
            }
            if (!acceptsPlainReference(segments))
                return value;
            const plain = rewritePlainReference(value, oldPath, newPath, referenceIndex);
            if (plain.candidates) {
                ambiguous.push({ sourcePath, propertyPath: propertyPathText(segments), value, candidates: plain.candidates });
                return value;
            }
            if (!plain.replacement || plain.replacement === value)
                return value;
            changes.push({ sourcePath, propertyPath: propertyPathText(segments), value, replacement: plain.replacement, direction: moveDirection(sourcePath, oldPath, oldPath) });
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
            const next = {};
            for (const [key, item] of Object.entries(value)) {
                const rewritten = visit(item, [...segments, key]);
                changed ||= rewritten !== item;
                next[key] = rewritten;
            }
            return changed ? next : value;
        }
        return value;
    };
    const updates = {};
    for (const [key, value] of Object.entries(frontmatter)) {
        const rewritten = visit(value, [key]);
        if (rewritten !== value)
            updates[key] = rewritten;
    }
    return { updates, changes, ambiguous };
}
function planMoveReferenceRewrite(handler, content, sourcePath, oldPath, newPath, referenceIndex) {
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
    }
    else if (Object.keys(properties.updates).length > 0) {
        rewritten = handler.stringify({ ...parsed.frontmatter, ...properties.updates }, bodyRewrite.content);
    }
    return {
        content: rewritten,
        linkChanges: bodyRewrite.changes,
        propertyChanges: properties.changes,
        ambiguous: [...bodyRewrite.ambiguous, ...properties.ambiguous],
    };
}
function selectSortedNotes(notes, sortBy, sortOrder, offset, limit) {
    const needed = offset + limit;
    const compare = (a, b) => compareQueryNotes(a, b, sortBy, sortOrder);
    if (needed > TOP_K_MAX || needed >= notes.length)
        return notes.sort(compare).slice(offset, needed);
    // Keep the worst selected item at the heap root. This reduces sorting from
    // O(N log N) to O(N log K) when callers ask for a small first page.
    const heap = [];
    const siftUp = (index) => {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (compare(heap[parent], heap[index]) >= 0)
                break;
            [heap[parent], heap[index]] = [heap[index], heap[parent]];
            index = parent;
        }
    };
    const siftDown = (index) => {
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let worst = index;
            if (left < heap.length && compare(heap[left], heap[worst]) > 0)
                worst = left;
            if (right < heap.length && compare(heap[right], heap[worst]) > 0)
                worst = right;
            if (worst === index)
                break;
            [heap[index], heap[worst]] = [heap[worst], heap[index]];
            index = worst;
        }
    };
    for (const note of notes) {
        if (heap.length < needed) {
            heap.push(note);
            siftUp(heap.length - 1);
        }
        else if (compare(note, heap[0]) < 0) {
            heap[0] = note;
            siftDown(0);
        }
    }
    return heap.sort(compare).slice(offset, needed);
}
function queryCursorValue(note, sortBy) {
    if (sortBy === 'path')
        return note.path;
    return getFrontmatterValue(note.frontmatter, sortBy).value;
}
function compareQueryNoteToCursor(note, cursor, sortBy, sortOrder) {
    const noteValue = queryCursorValue(note, sortBy);
    const noteMissing = noteValue === undefined;
    const cursorMissing = cursor.missing === true;
    if (noteMissing !== cursorMissing)
        return noteMissing ? 1 : -1;
    const comparison = compareQueryValues(noteValue, cursor.value);
    if (comparison !== 0)
        return sortOrder === 'asc' ? comparison : -comparison;
    return note.path.localeCompare(cursor.path);
}
function cursorForQueryNote(note, sortBy) {
    const value = queryCursorValue(note, sortBy);
    if (value === undefined)
        return { path: note.path, missing: true };
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return { path: note.path, value };
    }
    return { path: note.path, value: String(value) };
}
function lineStarts(content) {
    const starts = [0];
    const newline = /\r\n|\n|\r/g;
    let match;
    while ((match = newline.exec(content)))
        starts.push(match.index + match[0].length);
    return starts;
}
function boundedPreview(content, offset, contextLines, maxChars) {
    const starts = lineStarts(content);
    let line = 0;
    for (let index = 0; index < starts.length; index += 1) {
        if (starts[index] > offset)
            break;
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
export function classifyWriteError(error, path) {
    const code = error instanceof Error ? error.code : undefined;
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
export class FileSystemService {
    vaultPath;
    onNoteChanged;
    metadataIndex;
    graphIndex;
    vaultIo;
    frontmatterHandler;
    pathFilter;
    mutationTails = new Map();
    notifyNoteChanged(path, kind) {
        const callback = this.onNoteChanged;
        if (!callback || !/\.(?:md|markdown|txt)$/i.test(path))
            return;
        try {
            void Promise.resolve(callback(path, kind)).catch(() => {
                // Index maintenance is deliberately best-effort and must never change
                // the outcome of the user's note mutation.
            });
        }
        catch {
            // A synchronous callback failure is isolated for the same reason.
        }
    }
    revision(content) {
        return createHash('sha256').update(content, 'utf8').digest('hex');
    }
    async withMutationLock(path, operation) {
        return this.withMutationLockKey(this.mutationLockKey(path), operation);
    }
    /** Lock identity only; never use this folded key for access checks or IO. */
    mutationLockKey(path) {
        return resolve(this.vaultPath, this.normalizePath(path).replace(/\\/g, '/')).toLowerCase();
    }
    async withMutationLockKey(key, operation) {
        const previous = this.mutationTails.get(key) || Promise.resolve();
        let release;
        const current = new Promise(resolveLock => { release = resolveLock; });
        this.mutationTails.set(key, current);
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
            if (this.mutationTails.get(key) === current)
                this.mutationTails.delete(key);
        }
    }
    /** Acquire several note locks in one stable order so reciprocal edits cannot deadlock. */
    async withMutationLocks(paths, operation) {
        const ordered = [...new Set(paths.map(path => this.mutationLockKey(path)))].sort();
        const acquire = async (index) => index >= ordered.length
            ? operation()
            : this.withMutationLockKey(ordered[index], () => acquire(index + 1));
        return acquire(0);
    }
    constructor(vaultPath, pathFilter, frontmatterHandler, onNoteChanged, metadataIndex, graphIndex, vaultIo = new VaultIoCoordinator()) {
        this.vaultPath = vaultPath;
        this.onNoteChanged = onNoteChanged;
        this.metadataIndex = metadataIndex;
        this.graphIndex = graphIndex;
        this.vaultIo = vaultIo;
        const resolved = resolve(vaultPath);
        try {
            this.vaultPath = realpathSync(resolved);
        }
        catch {
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
    normalizePath(inputPath) {
        if (!inputPath)
            return '';
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
        }
        else if (normalized === vaultPrefix) {
            p = '';
        }
        else if (p.startsWith('/')) {
            p = p.slice(1);
        }
        return p;
    }
    resolvePath(relativePath) {
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
        }
        catch (err) {
            if (err instanceof Error && 'code' in err) {
                const code = err.code;
                if (code === 'ENOENT') {
                    // File doesn't exist yet (e.g. writing a new note). Verify the parent directory resolves inside vault.
                    try {
                        const parentReal = realpathSync(dirname(fullPath));
                        const parentRelative = relative(this.vaultPath, parentReal);
                        if (parentRelative.startsWith('..')) {
                            throw new Error(`Symlink target is outside vault: ${relativePath}. Symbolic links must resolve to a path within the vault directory.`);
                        }
                    }
                    catch (parentErr) {
                        // Parent doesn't exist either (will be created by mkdir). Lexical check above is sufficient.
                        if (parentErr instanceof Error && parentErr.message.includes('outside vault')) {
                            throw parentErr;
                        }
                    }
                }
                else if (code === 'ELOOP') {
                    throw new Error(`Circular symlink detected: ${relativePath}. The symbolic link chain forms a loop.`);
                }
                else if (code === 'EACCES') {
                    throw new Error(`Permission denied resolving symlink: ${relativePath}. Cannot verify the symbolic link target is within the vault.`);
                }
                else {
                    throw err;
                }
            }
            else {
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
    resolveWritablePath(relativePath) {
        const fullPath = this.resolvePath(relativePath);
        const relativePathToVault = relative(this.vaultPath, fullPath);
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
                    throw new Error(`Symbolic links are not allowed for mutations: ${relativePath}`);
                }
            }
            catch (error) {
                if (error instanceof Error && error.message.startsWith('Symbolic links are not allowed'))
                    throw error;
                if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
                    break;
                throw error;
            }
        }
        return fullPath;
    }
    async readNote(path) {
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
        }
        catch (error) {
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
    async noteExists(path) {
        path = this.normalizePath(path);
        if (!this.pathFilter.isAllowed(path))
            return false;
        try {
            return (await stat(this.resolvePath(path))).isFile();
        }
        catch {
            return false;
        }
    }
    async assertExpectedRevision(path, expectedRevision) {
        if (!expectedRevision)
            return;
        const exists = await this.noteExists(path);
        if (expectedRevision === 'missing') {
            if (exists)
                throw new Error(`Revision conflict for ${path}: expected a new note, but it already exists`);
            return;
        }
        if (!exists)
            throw new Error(`Revision conflict for ${path}: expected ${expectedRevision}, but the note is missing`);
        const current = (await this.readNote(path)).revision;
        if (current !== expectedRevision) {
            throw new Error(`Revision conflict for ${path}: expected ${expectedRevision}, current ${current}. Read the note again before changing it.`);
        }
    }
    async writeNote(params) {
        const path = this.normalizePath(params.path);
        return this.withMutationLock(path, () => this.writeNoteUnlocked({ ...params, path }));
    }
    /**
     * Write one note while holding revision locks for related notes whose state
     * is an invariant of the write. Guards are assertions only: they are never
     * rewritten, but a stale guard aborts before the target changes.
     */
    async writeNoteWithRevisionGuards(params, guards) {
        const path = this.normalizePath(params.path);
        if (!Array.isArray(guards) || guards.length < 1 || guards.length > 9) {
            throw new Error('A guarded note write requires between 1 and 9 related-note revision guards');
        }
        const targetIdentity = this.resolvePath(path).toLowerCase();
        const guardIdentities = new Set();
        const normalizedGuards = guards.map(guard => {
            const guardPath = this.normalizePath(guard?.path);
            if (!guardPath || !this.pathFilter.isAllowed(guardPath))
                throw new Error(`Access denied: ${guardPath || '(empty path)'}`);
            const identity = this.resolvePath(guardPath).toLowerCase();
            if (identity === targetIdentity)
                throw new Error('A guarded note write cannot repeat the target as a related-note guard, including equivalent path spellings');
            if (guardIdentities.has(identity))
                throw new Error('A related note may appear only once in revision guards, including equivalent path spellings');
            guardIdentities.add(identity);
            if (!/^[a-f0-9]{64}$/i.test(String(guard?.expectedRevision || ''))) {
                throw new Error(`Each related-note guard requires a current SHA-256 revision: ${guardPath}`);
            }
            return { path: guardPath, expectedRevision: guard.expectedRevision };
        });
        return this.withMutationLocks([path, ...normalizedGuards.map(guard => guard.path)], async () => {
            for (const guard of normalizedGuards)
                await this.assertExpectedRevision(guard.path, guard.expectedRevision);
            await this.writeNoteUnlocked({ ...params, path });
        });
    }
    async writeDerivedViewFile(params, extension) {
        const path = this.normalizePath(params.path);
        const allowed = new RegExp(`^(?:Community/|_scopes/(?:models|agents)/[A-Za-z0-9._-]+/)?Views/[^/]+\\.${extension}$`, 'i');
        const label = extension === 'base' ? 'Bases' : 'Canvas';
        if (!allowed.test(path))
            throw new Error(`${label} export path must be a single .${extension} file directly under the current scope's Views/ directory`);
        if (!this.pathFilter.isAllowed(path))
            throw new Error(`Access denied: ${path}`);
        if (!params.expectedRevision)
            throw new Error(`expectedRevision is required; use 'missing' for a new ${label} file`);
        const content = String(params.content ?? '');
        assertNoteContentSize(content, path);
        return this.withMutationLock(path, async () => {
            const fullPath = this.resolveWritablePath(path);
            let previousRevision = 'missing';
            try {
                previousRevision = this.revision(await readFile(fullPath, 'utf-8'));
            }
            catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                    throw error;
            }
            if (params.expectedRevision !== previousRevision) {
                throw new Error(`Revision conflict for ${path}: expected ${params.expectedRevision}, current ${previousRevision}. Read the ${label} file again before replacing it.`);
            }
            await mkdir(dirname(fullPath), { recursive: true });
            await writeFile(fullPath, content, 'utf-8');
            return { path, previousRevision, revision: this.revision(content) };
        });
    }
    /**
     * Write an Obsidian Bases definition as a derived, revision-checked view.
     * Derived views are limited to one file directly under a scope-local Views/
     * directory so this cannot become a general-purpose write primitive.
     */
    async writeBaseFile(params) {
        return this.writeDerivedViewFile(params, 'base');
    }
    /** Write a validated JSON Canvas 1.0 projection as a disposable view. */
    async writeCanvasFile(params) {
        let parsed;
        try {
            parsed = JSON.parse(String(params.content ?? ''));
        }
        catch {
            throw new Error('Canvas content must be valid JSON');
        }
        validateJsonCanvasDocument(parsed);
        return this.writeDerivedViewFile(params, 'canvas');
    }
    /** Read one scope-local Canvas for bounded derived-view maintenance. */
    async readCanvasFile(pathInput, maxBytes = MAX_DERIVED_VIEW_READ_BYTES) {
        const path = this.normalizePath(pathInput);
        const allowed = /^(?:Community\/|_scopes\/(?:models|agents)\/[A-Za-z0-9._-]+\/)?Views\/[^/]+\.canvas$/i;
        if (!allowed.test(path) || !this.pathFilter.isAllowed(path))
            throw new Error('Canvas health reads are limited to one scope-local Views/*.canvas file');
        const fullPath = this.resolvePath(path);
        const info = await stat(fullPath);
        if (!info.isFile())
            throw new Error(`Canvas path is not a file: ${path}`);
        const boundedBytes = Math.min(Math.max(Number(maxBytes) || MAX_DERIVED_VIEW_READ_BYTES, 1024), MAX_DERIVED_VIEW_READ_BYTES);
        if (info.size > boundedBytes)
            throw new Error(`Canvas exceeds the ${boundedBytes}-byte health-read limit: ${path}`);
        const content = await readFile(fullPath, 'utf8');
        let document;
        try {
            document = JSON.parse(content);
        }
        catch {
            throw new Error(`Canvas is not valid JSON: ${path}`);
        }
        return { path, revision: this.revision(content), document };
    }
    async writeNoteUnlocked(params) {
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
            let finalContent;
            if (mode === 'overwrite') {
                // Original behavior - replace entire content
                finalContent = frontmatter
                    ? this.frontmatterHandler.stringify(frontmatter, content)
                    : content;
            }
            else {
                // For append/prepend, we need to read existing content
                let existingNote;
                try {
                    existingNote = await this.readNote(path);
                }
                catch (error) {
                    // File doesn't exist, treat as overwrite
                    finalContent = frontmatter
                        ? this.frontmatterHandler.stringify(frontmatter, content)
                        : content;
                }
                if (existingNote) {
                    // Merge frontmatter if provided
                    const mergedFrontmatter = frontmatter
                        ? { ...existingNote.frontmatter, ...frontmatter }
                        : existingNote.frontmatter;
                    const mergedContent = mode === 'append'
                        ? existingNote.content + content
                        : content + existingNote.content;
                    if (existingNote.matter && existingNote.matter.trim() !== '') {
                        // Preserve raw formatting for unmodified fields by only applying explicit updates
                        finalContent = this.frontmatterHandler.preserveStringify(existingNote.matter, frontmatter || {}, mergedContent);
                    }
                    else {
                        finalContent = this.frontmatterHandler.stringify(mergedFrontmatter, mergedContent);
                    }
                }
            }
            assertNoteContentSize(finalContent, path);
            // Create directories if they don't exist
            await mkdir(dirname(fullPath), { recursive: true });
            await writeFile(fullPath, finalContent, 'utf-8');
            this.notifyNoteChanged(path, 'upsert');
        }
        catch (error) {
            throw classifyWriteError(error, path);
        }
    }
    async patchNote(params) {
        const path = this.normalizePath(params.path);
        const advanced = params.dryRun === true || params.patches !== undefined || params.startLine !== undefined || params.endLine !== undefined;
        return this.withMutationLock(path, () => advanced
            ? this.patchNoteImproved({ ...params, path })
            : this.patchNoteUnlocked({ ...params, path }));
    }
    async patchNoteUnlocked(params) {
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
        }
        catch (error) {
            return {
                success: false,
                path,
                message: `Failed to patch note: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    /** Compute exact hunks without writing so single-note and change-set edits share semantics. */
    planImprovedPatch(path, note, params) {
        const hunks = params.patches || [{
                oldString: params.oldString || '',
                newString: params.newString ?? '',
                replaceAll: params.replaceAll,
                startLine: params.startLine,
                endLine: params.endLine,
            }];
        if (!hunks.length)
            throw new Error('patches must contain at least one hunk');
        if (hunks.length > 50)
            throw new Error('A single patch request may contain at most 50 hunks');
        let content = note.originalContent;
        let totalMatches = 0;
        let firstOffset = 0;
        const patchResults = [];
        for (const hunk of hunks) {
            const oldString = String(hunk.oldString ?? '');
            const newString = String(hunk.newString ?? '');
            if (!oldString || oldString.trim() === '')
                throw new Error('oldString cannot be empty');
            if (oldString === newString)
                throw new Error('oldString and newString must be different');
            const starts = lineStarts(content);
            const lineCount = content.split(/\r\n|\n|\r/).length;
            const hasRange = hunk.startLine !== undefined || hunk.endLine !== undefined;
            if (hasRange && (hunk.startLine === undefined || hunk.endLine === undefined))
                throw new Error('startLine and endLine must be supplied together');
            let regionStart = 0;
            let regionEnd = content.length;
            if (hasRange) {
                const startLine = Number(hunk.startLine);
                const endLine = Number(hunk.endLine);
                if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lineCount)
                    throw new Error(`line range must be between 1 and ${lineCount}, with startLine <= endLine`);
                regionStart = starts[startLine - 1];
                regionEnd = endLine < lineCount ? starts[endLine] : content.length;
            }
            const region = content.slice(regionStart, regionEnd);
            const matchCount = region.split(oldString).length - 1;
            if (!matchCount)
                throw new Error(`String not found${hasRange ? ` within lines ${hunk.startLine}-${hunk.endLine}` : ''}: "${oldString.slice(0, 50)}${oldString.length > 50 ? '...' : ''}"`);
            if (!hunk.replaceAll && matchCount > 1)
                throw new Error(`Found ${matchCount} occurrences; use replaceAll=true or a more specific hunk`);
            const matchOffset = region.indexOf(oldString);
            const replaced = hunk.replaceAll ? region.split(oldString).join(newString) : region.replace(oldString, () => newString);
            content = content.slice(0, regionStart) + replaced + content.slice(regionEnd);
            totalMatches += matchCount;
            patchResults.push({ matchCount, ...(hasRange && { startLine: Number(hunk.startLine), endLine: Number(hunk.endLine) }) });
            if (patchResults.length === 1)
                firstOffset = regionStart + matchOffset;
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
    async patchNoteImproved(params) {
        const path = this.normalizePath(params.path);
        if (!this.pathFilter.isAllowed(path))
            return { success: false, path, message: `Access denied: ${path}` };
        try {
            await this.assertExpectedRevision(path, params.expectedRevision);
            const note = await this.readNote(path);
            const planned = this.planImprovedPatch(path, note, params);
            if (params.dryRun || planned.content === note.originalContent)
                return planned.result;
            await writeFile(this.resolveWritablePath(path), planned.content, 'utf-8');
            this.notifyNoteChanged(path, 'upsert');
            return planned.result;
        }
        catch (error) {
            return { success: false, path, message: `Failed to patch note: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
    planFrontmatterMutation(path, originalContent, frontmatter) {
        if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter))
            throw new Error(`frontmatter must be an object for ${path}`);
        const set = frontmatter.set ?? {};
        const remove = frontmatter.remove ?? [];
        if (!set || typeof set !== 'object' || Array.isArray(set))
            throw new Error(`frontmatter.set must be an object for ${path}`);
        if (!Array.isArray(remove))
            throw new Error(`frontmatter.remove must be an array for ${path}`);
        const setNames = Object.keys(set);
        if (setNames.length > 100 || remove.length > 100)
            throw new Error(`A change may set or remove at most 100 Properties: ${path}`);
        if (setNames.some(name => set[name] === undefined))
            throw new Error(`frontmatter.set cannot contain undefined values for ${path}; use remove instead`);
        const blockedNames = new Set(['__proto__', 'prototype', 'constructor']);
        const cleanRemove = [...new Set(remove.map(value => String(value || '').trim()))];
        for (const name of [...setNames, ...cleanRemove]) {
            if (!name || name.length > 100 || blockedNames.has(name))
                throw new Error(`Invalid top-level Property name for ${path}: ${name || '(empty)'}`);
        }
        const overlap = setNames.filter(name => cleanRemove.includes(name));
        if (overlap.length)
            throw new Error(`A Property cannot be both set and removed for ${path}: ${overlap.join(', ')}`);
        if (!setNames.length && !cleanRemove.length)
            throw new Error(`frontmatter must set or remove at least one Property for ${path}`);
        if (Buffer.byteLength(JSON.stringify(set), 'utf8') > 128 * 1024)
            throw new Error(`frontmatter.set exceeds the 128 KiB change-set limit for ${path}`);
        const parsed = this.frontmatterHandler.parse(originalContent);
        const nextFrontmatter = { ...parsed.frontmatter, ...set };
        for (const name of cleanRemove)
            delete nextFrontmatter[name];
        const validation = this.frontmatterHandler.validate(nextFrontmatter);
        if (!validation.isValid)
            throw new Error(`Invalid frontmatter for ${path}: ${validation.errors.join(', ')}`);
        const updates = { ...set };
        for (const name of cleanRemove)
            updates[name] = undefined;
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
    async patchMultipleNotes(params, projectPath = path => path) {
        if (!params || !Array.isArray(params.changes))
            throw new Error('changes must be an array');
        if (params.changes.length < 1 || params.changes.length > 10)
            throw new Error('A note change set must contain between 1 and 10 changes');
        const previewMaxChars = Math.min(Math.max(Number(params.previewMaxChars ?? 400), 200), 1000);
        const maxChars = Math.min(Math.max(Number(params.maxChars ?? 12000), 4096), 20000);
        let totalHunks = 0;
        let totalPatchBytes = 0;
        const targetIdentities = new Set();
        const normalized = params.changes.map(change => {
            if (!change || typeof change !== 'object')
                throw new Error('Every change must be an object');
            const path = this.normalizePath(change.path);
            if (!path || !this.pathFilter.isAllowed(path))
                throw new Error(`Access denied: ${path || '(empty path)'}`);
            // Preflight every destination, including dry runs, before any member of
            // this batch can be written. Absolute inputs must use the same guard.
            const resolvedPath = this.resolvePath(path);
            assertLegacyDiscussionMutationAllowed(relative(this.vaultPath, resolvedPath), 'Change set', true);
            const identity = resolvedPath.toLowerCase();
            if (targetIdentities.has(identity))
                throw new Error('A note may appear only once in a change set, including equivalent path spellings. Combine its patches and Properties into one change, then dry-run again.');
            targetIdentities.add(identity);
            if (!/^[a-f0-9]{64}$/i.test(String(change.expectedRevision || '')))
                throw new Error(`Each change requires the current SHA-256 revision of an existing note: ${path}`);
            const patches = change.patches;
            const frontmatter = change.frontmatter;
            if (patches !== undefined && (!Array.isArray(patches) || patches.length < 1))
                throw new Error(`patches must be a non-empty array for ${path}`);
            if (patches === undefined && frontmatter === undefined)
                throw new Error(`Each change needs patches, frontmatter, or both: ${path}`);
            totalHunks += patches?.length || 0;
            for (const hunk of patches || [])
                totalPatchBytes += Buffer.byteLength(String(hunk?.oldString ?? ''), 'utf8') + Buffer.byteLength(String(hunk?.newString ?? ''), 'utf8');
            return { ...change, path };
        });
        if (totalHunks > 50)
            throw new Error('A note change set may contain at most 50 total patch hunks');
        if (totalPatchBytes > 2 * 1024 * 1024)
            throw new Error('A note change set may contain at most 2 MiB of patch text');
        return this.withMutationLocks(normalized.map(change => change.path), async () => {
            const plans = [];
            for (const change of normalized) {
                const note = await this.readNote(change.path);
                if (note.revision !== change.expectedRevision)
                    throw new Error(`Revision conflict for ${change.path}: expected ${change.expectedRevision}, current ${note.revision}. Read every note again and rebuild the change set.`);
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
                if (change.frontmatter)
                    content = this.planFrontmatterMutation(change.path, content, change.frontmatter);
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
                throw new Error('Change-set confirmation mismatch. Dry-run this exact request, inspect the previews, and pass its returned confirmPlanFingerprint before applying it.');
            }
            // Admit the success response before side effects. Otherwise an applied
            // transaction could be reported as failed solely because its receipt
            // cannot fit, prompting a caller to repeat an already completed edit.
            const result = {
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
                if (JSON.stringify(response, null, indent).length > maxChars)
                    throw new Error('maxChars is too small to preserve all change paths and revisions; no files were written. Increase maxChars, disable prettyPrint, or reduce the change count.');
            }
            if (!dryRun) {
                // Recheck all inputs immediately before the first write. This catches
                // external Obsidian/editor changes that do not participate in our lock.
                for (const plan of plans) {
                    const current = await readFile(this.resolvePath(plan.path), 'utf8');
                    if (this.revision(current) !== plan.item.previousRevision)
                        throw new Error(`Revision conflict for ${plan.path}: it changed after preflight; no change-set files were written`);
                }
                const attempted = [];
                try {
                    for (const plan of plans.filter(candidate => candidate.item.wouldChange)) {
                        let fullPath;
                        let current;
                        try {
                            fullPath = this.resolveWritablePath(plan.path);
                            current = await readFile(fullPath, 'utf8');
                        }
                        catch {
                            this.notifyNoteChanged(plan.path, 'upsert');
                            throw new Error(`Cannot safely recheck ${plan.path} before its individual write; inspect its current state`);
                        }
                        if (this.revision(current) !== plan.item.previousRevision) {
                            this.notifyNoteChanged(plan.path, 'upsert');
                            throw new Error(`Revision conflict for ${plan.path}: it changed before its individual write`);
                        }
                        attempted.push(plan);
                        await writeFile(fullPath, plan.content, 'utf8');
                    }
                }
                catch (error) {
                    const rollbackFailures = [];
                    for (const plan of attempted.reverse()) {
                        try {
                            const fullPath = this.resolveWritablePath(plan.path);
                            const current = await readFile(fullPath, 'utf8');
                            // Preserve edits from writers outside our instance-local lock.
                            // This is a conservative ownership check, not filesystem CAS.
                            if (current === plan.original)
                                continue;
                            if (current !== plan.content) {
                                rollbackFailures.push(`${plan.path}: content changed after our write; current content preserved`);
                                continue;
                            }
                            await writeFile(fullPath, plan.original, 'utf8');
                        }
                        catch {
                            rollbackFailures.push(`${plan.path}: could not safely read or restore the target; inspect its current state`);
                        }
                        finally {
                            // Even an uncertain restoration may have changed the disk view.
                            this.notifyNoteChanged(plan.path, 'upsert');
                        }
                    }
                    const rollback = rollbackFailures.length ? ` Rollback was incomplete: ${rollbackFailures.join('; ')}` : ' All attempted writes were restored.';
                    throw new Error(`Change-set write failed: ${error instanceof Error ? error.message : 'unknown write error'}.${rollback}`);
                }
                for (const plan of plans.filter(candidate => candidate.item.wouldChange))
                    this.notifyNoteChanged(plan.path, 'upsert');
            }
            return response;
        });
    }
    async listDirectory(path = '') {
        // Normalize path: treat '.' as root directory, strip vault prefix
        const normalizedPath = path === '.' ? '' : this.normalizePath(path);
        const fullPath = this.resolvePath(normalizedPath);
        try {
            const entries = await readdir(fullPath, { withFileTypes: true });
            const files = [];
            const directories = [];
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
                        }
                        else if (targetStat.isFile()) {
                            files.push(entry.name);
                        }
                    }
                    catch {
                        continue; // Broken/circular/inaccessible symlink, skip silently
                    }
                }
                else if (entry.isDirectory()) {
                    directories.push(entry.name);
                }
                else if (entry.isFile()) {
                    files.push(entry.name);
                }
            }
            return {
                files: files.sort(),
                directories: directories.sort()
            };
        }
        catch (error) {
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
    async exists(path) {
        path = this.normalizePath(path);
        const fullPath = this.resolvePath(path);
        if (!this.pathFilter.isAllowed(path)) {
            return false;
        }
        try {
            await access(fullPath, constants.F_OK);
            return true;
        }
        catch {
            return false;
        }
    }
    async isDirectory(path) {
        path = this.normalizePath(path);
        const fullPath = this.resolvePath(path);
        if (!this.pathFilter.isAllowed(path)) {
            return false;
        }
        try {
            const stats = await stat(fullPath);
            return stats.isDirectory();
        }
        catch {
            return false;
        }
    }
    /**
     * Build one visibility-safe move plan. Resolution uses every physical note
     * so an inaccessible same-name target cannot be mistaken for a unique one.
     * Details from inaccessible scopes are collapsed to one boolean barrier.
     */
    async collectMoveReferencePlans(oldPath, newPath, canAccessPath) {
        const physicalPaths = (await this.collectVaultFiles())
            .filter(path => this.pathFilter.isAllowed(path) && /\.(?:md|markdown|txt)$/i.test(path))
            .sort((a, b) => a.localeCompare(b));
        const documents = [];
        const readBatchSize = 32;
        for (let offset = 0; offset < physicalPaths.length; offset += readBatchSize) {
            const batch = await Promise.all(physicalPaths.slice(offset, offset + readBatchSize).map(async (sourcePath) => {
                try {
                    const sourceContent = await this.vaultIo.readUtf8(this.resolvePath(sourcePath));
                    const frontmatter = this.frontmatterHandler.parse(sourceContent).frontmatter || {};
                    return {
                        sourcePath,
                        sourceContent,
                        descriptor: {
                            path: sourcePath,
                            title: frontmatter.title,
                            aliases: frontmatter.aliases,
                            preferredTerm: frontmatter.preferred_term,
                            stableId: frontmatter.stable_id,
                        },
                    };
                }
                catch {
                    // A concurrently removed or unreadable note cannot be rewritten.
                    return undefined;
                }
            }));
            for (const document of batch)
                if (document)
                    documents.push(document);
        }
        const referenceIndex = buildNoteReferenceIndex(documents.map(document => document.descriptor));
        const plans = [];
        let hiddenReferencesPresent = false;
        for (const { sourcePath, sourceContent } of documents) {
            if (sourcePath.toLowerCase() === newPath.toLowerCase() && sourcePath.toLowerCase() !== oldPath.toLowerCase())
                continue;
            const plan = planMoveReferenceRewrite(this.frontmatterHandler, sourceContent, sourcePath, oldPath, newPath, referenceIndex);
            if (!canAccessPath(sourcePath)) {
                if (plan.linkChanges.length > 0 || plan.propertyChanges.length > 0 || plan.ambiguous.length > 0)
                    hiddenReferencesPresent = true;
                continue;
            }
            const visibleAmbiguous = [];
            for (const reference of plan.ambiguous) {
                if (reference.candidates.every(canAccessPath))
                    visibleAmbiguous.push(reference);
                else
                    hiddenReferencesPresent = true;
            }
            plans.push({ sourcePath, sourceContent, plan: { ...plan, ambiguous: visibleAmbiguous } });
        }
        return { plans, hiddenReferencesPresent };
    }
    async previewDeleteNote(params, canAccessPath = () => true) {
        const path = this.normalizePath(params.path);
        if (!this.pathFilter.isAllowed(path) || !canAccessPath(path))
            throw new Error(`Access denied: ${path}`);
        const requestedLimit = params.limit ?? 100;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1)
            throw new Error('limit must be a positive integer');
        const limit = Math.min(requestedLimit, 200);
        const scan = await this.collectMoveReferencePlans(path, `__mcpvault_deleted__/${path}`, canAccessPath);
        const affectedLinks = [];
        const affectedProperties = [];
        const ambiguousReferences = [];
        for (const { sourcePath, plan } of scan.plans) {
            if (normalizeNoteTarget(sourcePath) === normalizeNoteTarget(path))
                continue;
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
    async moveNoteToVaultTrash(path, fullPath) {
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
        }
        catch {
            // File does not exist in trash, no collision.
        }
        await rename(fullPath, finalTrashPath);
    }
    async deleteNote(params, canAccessPath = () => true) {
        const path = this.normalizePath(params.path);
        const confirmPath = this.normalizePath(params.confirmPath);
        return this.withMutationLock(path, () => this.deleteNoteUnlocked({ ...params, path, confirmPath }, canAccessPath));
    }
    async deleteNoteUnlocked(params, canAccessPath) {
        const { trashMode = 'none' } = params;
        const path = params.path;
        const confirmPath = params.confirmPath;
        // Confirmation check - paths must match exactly
        if (path !== confirmPath) {
            return {
                success: false,
                path: path,
                message: "Deletion cancelled: confirmation path does not match. For safety, both 'path' and 'confirmPath' must be identical."
            };
        }
        if (!this.pathFilter.isAllowed(path) || !canAccessPath(path)) {
            return {
                success: false,
                path: path,
                message: `Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`
            };
        }
        if (!['none', 'local', 'system'].includes(trashMode)) {
            return { success: false, path, message: 'Deletion cancelled: trashMode must be none, local, or system.' };
        }
        const fullPath = this.resolveWritablePath(path);
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
            if (/\.(?:md|markdown|txt)$/i.test(path)) {
                const impact = await this.previewDeleteNote({ path, limit: 1 }, canAccessPath);
                if (impact.hiddenReferencesPresent) {
                    return { success: false, path, message: 'Deletion blocked: an inaccessible scope references this note or has a hidden identity collision. Preserve or tombstone the note; only an administrator able to review every affected scope may delete it.' };
                }
                if (impact.total + impact.ambiguousTotal > 0) {
                    if (params.allowDanglingReferences !== true) {
                        return { success: false, path, message: `Deletion blocked: ${impact.total} resolved and ${impact.ambiguousTotal} ambiguous inbound reference${impact.total + impact.ambiguousTotal === 1 ? '' : 's'} would become dangling. Call preview_delete_note, then archive/supersede/tombstone or explicitly allow dangling references.` };
                    }
                    if (!params.expectedRevision || !String(params.expectedRevision).trim()) {
                        return { success: false, path, message: 'allowDanglingReferences requires expectedRevision from a fresh read of the note.' };
                    }
                }
                if (params.expectedRevision)
                    await this.assertExpectedRevision(path, params.expectedRevision);
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
                }
                catch (systemTrashError) {
                    // Some locked-down Windows environments cannot launch the bundled
                    // recycle-bin helper. Preserve recoverability by falling back to
                    // the vault trash, but never claim that the system trash succeeded.
                    if (!(await this.exists(path)))
                        throw systemTrashError;
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
        }
        catch (error) {
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
    async moveNote(params, canAccessPath = () => true) {
        const oldPath = this.normalizePath(params.oldPath);
        const newPath = this.normalizePath(params.newPath);
        return this.withMutationLocks([oldPath, newPath], () => this.moveNoteUnlocked({ ...params, oldPath, newPath }, canAccessPath));
    }
    async moveNoteUnlocked(params, canAccessPath) {
        const { overwrite = false, updateLinks = false } = params;
        const oldPath = params.oldPath;
        const newPath = params.newPath;
        if (oldPath.toLowerCase() === newPath.toLowerCase()) {
            return { success: false, oldPath, newPath, message: 'Source and destination are identical; no move was performed.' };
        }
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
        const linkBackups = [];
        let destinationBackup;
        let destinationTouched = false;
        try {
            // Read source content (will throw ENOENT if not found)
            let content;
            try {
                content = await readFile(oldFullPath, 'utf-8');
            }
            catch (error) {
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
            if (updateLinks) {
                if (!params.expectedRevision || !String(params.expectedRevision).trim()) {
                    return { success: false, oldPath, newPath, message: 'updateLinks requires expectedRevision from a fresh read of the source note.' };
                }
                await this.assertExpectedRevision(oldPath, params.expectedRevision);
                try {
                    if (!overwrite)
                        await access(newFullPath, constants.F_OK);
                    if (!overwrite)
                        return { success: false, oldPath, newPath, message: `Target file already exists: ${newPath}. Use overwrite=true to replace it.` };
                }
                catch (error) {
                    if (overwrite || !(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
                        throw error;
                }
                const scan = await this.collectMoveReferencePlans(oldPath, newPath, canAccessPath);
                const ambiguities = [];
                for (const { sourcePath, sourceContent, plan } of scan.plans) {
                    ambiguities.push(...plan.ambiguous);
                    if (sourcePath.toLowerCase() === oldPath.toLowerCase()) {
                        content = plan.content;
                    }
                    else if (plan.content !== sourceContent) {
                        linkBackups.push({ path: sourcePath, original: sourceContent, rewritten: plan.content, updated: false });
                    }
                }
                if (scan.hiddenReferencesPresent) {
                    return { success: false, oldPath, newPath, message: 'Move blocked: at least one inaccessible scope references this note or makes its identity ambiguous. Preserve the current path or ask an administrator with access to every affected scope to perform the move.' };
                }
                if (ambiguities.length > 0) {
                    const first = ambiguities[0];
                    return {
                        success: false,
                        oldPath,
                        newPath,
                        message: `Move blocked: ${ambiguities.length} ambiguous reference${ambiguities.length === 1 ? '' : 's'} may point to the source note. Disambiguate ${first.sourcePath}${first.propertyPath ? ` ${first.propertyPath}` : first.line ? ` line ${first.line}` : ''} before retrying updateLinks=true.`,
                    };
                }
                assertNoteContentSize(content, newPath);
                // Reject a protected dependent before writing ANY backlink or moving
                // the source. Checking only inside the write loop would mutate earlier
                // dependents and rely on rollback to restore them.
                for (const backup of linkBackups)
                    this.resolveWritablePath(backup.path);
                for (const backup of linkBackups) {
                    const current = await this.readNote(backup.path);
                    if (current.originalContent !== backup.original)
                        throw new Error(`Inbound link source changed during rename: ${backup.path}`);
                    assertNoteContentSize(backup.rewritten, backup.path);
                    // Mark before write because writeFile may truncate and then fail.
                    // Rollback must cover both complete and partial writes.
                    backup.updated = true;
                    await writeFile(this.resolveWritablePath(backup.path), backup.rewritten, 'utf-8');
                    this.notifyNoteChanged(backup.path, 'upsert');
                }
            }
            // Create directories if needed
            await mkdir(dirname(newFullPath), { recursive: true });
            if (overwrite) {
                try {
                    destinationBackup = await readFile(newFullPath, 'utf-8');
                }
                catch (error) {
                    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
                        throw error;
                }
            }
            // Write to new location, checking for existing file atomically if !overwrite
            try {
                // A failed write can still leave a truncated/partial destination. For
                // exclusive creation, EEXIST below clears this flag because that file
                // belongs to the pre-existing/racing writer and must not be removed.
                destinationTouched = true;
                if (overwrite) {
                    await writeFile(newFullPath, content, 'utf-8');
                }
                else {
                    // wx flag: write exclusive - fails if file exists
                    await writeFile(newFullPath, content, { encoding: 'utf-8', flag: 'wx' });
                }
            }
            catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
                    destinationTouched = false;
                    throw new Error(`Target file already exists: ${newPath}. Use overwrite=true to replace it.`);
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
                message: `Successfully moved note from ${oldPath} to ${newPath}${linkBackups.length ? ` and updated references in ${linkBackups.length} dependent note${linkBackups.length === 1 ? '' : 's'}` : ''}`
            };
        }
        catch (error) {
            if (destinationTouched) {
                try {
                    if (destinationBackup !== undefined)
                        await writeFile(newFullPath, destinationBackup, 'utf-8');
                    else
                        await unlink(newFullPath);
                    this.notifyNoteChanged(newPath, destinationBackup !== undefined ? 'upsert' : 'delete');
                }
                catch {
                    // Preserve the original error; the failure message below flags that the move did not complete.
                }
            }
            for (const backup of linkBackups.filter(item => item.updated).reverse()) {
                try {
                    await writeFile(this.resolveWritablePath(backup.path), backup.original, 'utf-8');
                    this.notifyNoteChanged(backup.path, 'upsert');
                }
                catch {
                    // Preserve the original failure while making the partial rollback visible in the message.
                }
            }
            return {
                success: false,
                oldPath,
                newPath,
                message: `Failed to move note: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async moveFile(params) {
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
        }
        catch (error) {
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
                }
                catch (error) {
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
                }
                catch (error) {
                    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
                        throw error;
                    }
                }
            }
            try {
                await rename(oldFullPath, newFullPath);
            }
            catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'EXDEV') {
                    await copyFile(oldFullPath, newFullPath);
                    await unlink(oldFullPath);
                }
                else {
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
        }
        catch (error) {
            return {
                success: false,
                oldPath,
                newPath,
                message: `Failed to move file: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async readMultipleNotes(params) {
        const { paths, includeContent = true, includeFrontmatter = true, knownRevisions } = params;
        if (paths.length > 10) {
            throw new Error('Maximum 10 files per batch read request');
        }
        const results = await Promise.allSettled(paths.map(async (rawPath) => {
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
            const result = {
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
        }));
        const successful = [];
        const failed = [];
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successful.push(result.value);
            }
            else {
                failed.push({
                    path: paths[index] || '',
                    error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
                });
            }
        });
        return { successful, failed };
    }
    async updateFrontmatter(params) {
        const path = this.normalizePath(params.path);
        return this.withMutationLock(path, () => this.updateFrontmatterUnlocked({ ...params, path }));
    }
    /**
     * Preview a note move without changing files. Markdown, Properties, and
     * Obsidian links remain authoritative, so this resolves one bounded,
     * explainable rewrite plan. Applying that plan remains explicit and
     * revision-checked through moveNote(updateLinks=true).
     */
    async previewMoveNote(params, canAccessPath = () => true) {
        const oldPath = this.normalizePath(params.oldPath);
        const newPath = this.normalizePath(params.newPath);
        if (!this.pathFilter.isAllowed(oldPath) || !canAccessPath(oldPath))
            throw new Error(`Access denied: ${oldPath}`);
        if (!this.pathFilter.isAllowed(newPath) || !canAccessPath(newPath))
            throw new Error(`Access denied: ${newPath}`);
        const requestedLimit = params.limit ?? 100;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1)
            throw new Error('limit must be a positive integer');
        const limit = Math.min(requestedLimit, 200);
        const scan = await this.collectMoveReferencePlans(oldPath, newPath, canAccessPath);
        const [targetExists, collision] = await Promise.all([this.noteExists(oldPath), this.noteExists(newPath)]);
        const affectedLinks = [];
        const affectedProperties = [];
        const ambiguousReferences = [];
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
    async updateFrontmatterUnlocked(params) {
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
            // Frontmatter-only mutations bypass writeNoteUnlocked, so explicitly
            // invalidate the shared catalog/index read models before returning.
            this.notifyNoteChanged(path, 'upsert');
        }
        else {
            // Replace frontmatter entirely (or no existing matter to preserve)
            await this.writeNoteUnlocked({
                path,
                content: note.content,
                frontmatter: newFrontmatter
            });
        }
    }
    async getNotesInfo(paths) {
        const results = await Promise.allSettled(paths.map(async (rawPath) => {
            const path = this.normalizePath(rawPath);
            if (!this.pathFilter.isAllowed(path)) {
                throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
            }
            const fullPath = this.resolvePath(path);
            let stats;
            try {
                stats = await stat(fullPath);
            }
            catch (error) {
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
        }));
        // Return only successful results, filter out failed ones
        return results
            .filter((result) => result.status === 'fulfilled')
            .map(result => result.value);
    }
    async manageTags(params) {
        const path = this.normalizePath(params.path);
        return this.withMutationLock(path, () => this.manageTagsUnlocked({ ...params, path }));
    }
    async manageTagsUnlocked(params) {
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
            if (!['list', 'add', 'remove'].includes(operation))
                throw new Error('Invalid tag operation');
            const note = await this.readNote(path);
            if (isModerationHidden(note.frontmatter))
                throw new Error(`Access denied: ${path}`);
            if (params.expectedRevision !== undefined && params.expectedRevision !== note.revision) {
                throw new Error(`Revision conflict for ${path}. Read the note again before changing its tags.`);
            }
            let currentTags = [];
            // Extract tags from frontmatter
            if (note.frontmatter.tags) {
                if (Array.isArray(note.frontmatter.tags)) {
                    currentTags = note.frontmatter.tags;
                }
                else if (typeof note.frontmatter.tags === 'string') {
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
            }
            else if (operation === 'remove') {
                newTags = newTags.filter(tag => !tags.includes(tag));
            }
            // Build tag updates for preserveStringify
            const tagUpdates = {};
            if (newTags.length > 0) {
                tagUpdates.tags = newTags;
            }
            else {
                tagUpdates.tags = undefined;
            }
            // Write back the note with updated frontmatter, preserving raw formatting for unmodified fields
            let updatedContent;
            if (note.matter && note.matter.trim() !== '') {
                updatedContent = this.frontmatterHandler.preserveStringify(note.matter, tagUpdates, note.content);
            }
            else {
                const updatedFrontmatter = { ...note.frontmatter };
                if (newTags.length > 0) {
                    updatedFrontmatter.tags = newTags;
                }
                else {
                    delete updatedFrontmatter.tags;
                }
                updatedContent = this.frontmatterHandler.stringify(updatedFrontmatter, note.content);
            }
            assertNoteContentSize(updatedContent, path);
            const fullPath = this.resolveWritablePath(path);
            // The lock serializes this service's writers. Also reject external edits
            // observed after deriving tags; this is a recheck, not filesystem CAS.
            await this.assertExpectedRevision(path, note.revision);
            await writeFile(fullPath, updatedContent, 'utf-8');
            this.notifyNoteChanged(path, 'upsert');
            return {
                path,
                operation,
                tags: newTags,
                success: true,
                previousRevision: note.revision,
                revision: this.revision(updatedContent),
                message: `Successfully ${operation === 'add' ? 'added' : 'removed'} tags`
            };
        }
        catch (error) {
            return {
                path,
                operation,
                tags: [],
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    getVaultPath() {
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
    async findPathForWikiLink(wikiLinkName, canAccessPath = () => true) {
        if (!wikiLinkName.trim()) {
            throw new Error('Empty wiki link — provide a document name inside [[ ]].');
        }
        if (this.metadataIndex) {
            const indexedMatches = await this.metadataIndex.resolveNoteReference(wikiLinkName, canAccessPath);
            return indexedMatches.sort((a, b) => {
                const da = a.split('/').length;
                const db = b.split('/').length;
                return da !== db ? da - db : a.localeCompare(b);
            });
        }
        const notePaths = (await this.collectVaultFiles())
            .filter(path => this.pathFilter.isAllowed(path) && canAccessPath(path))
            .filter(path => /\.(?:md|markdown|txt)$/i.test(path));
        const descriptors = [];
        const readBatchSize = 32;
        for (let offset = 0; offset < notePaths.length; offset += readBatchSize) {
            const batch = await Promise.all(notePaths.slice(offset, offset + readBatchSize).map(async (path) => {
                try {
                    const raw = await readFile(this.resolvePath(path), 'utf-8');
                    const frontmatter = this.frontmatterHandler.parse(raw).frontmatter || {};
                    return {
                        path,
                        title: frontmatter.title,
                        aliases: frontmatter.aliases,
                        preferredTerm: frontmatter.preferred_term,
                        stableId: frontmatter.stable_id,
                    };
                }
                catch {
                    // A concurrently removed or unreadable note is not a match.
                    return undefined;
                }
            }));
            for (const entry of batch)
                if (entry)
                    descriptors.push(entry);
        }
        const matches = resolveNoteReference(wikiLinkName, buildNoteReferenceIndex(descriptors));
        // Depth-ascending (root-first), alphabetical tiebreak at equal depth.
        // No current-folder context exists for a standalone MCP tool.
        matches.sort((a, b) => {
            const da = a.split('/').length;
            const db = b.split('/').length;
            return da !== db ? da - db : a.localeCompare(b);
        });
        return matches;
    }
    async getBacklinks(path, limit = 100, canAccessPath = () => true, offset = 0, options = {}) {
        const target = this.normalizePath(path);
        if (!this.pathFilter.isAllowed(target) || !canAccessPath(target))
            throw new Error(`Access denied: ${target}`);
        const targetNote = await this.readNote(target);
        if (isModerationHidden(targetNote.frontmatter))
            throw new Error(`Access denied: ${target}`);
        return this.withGraphRead(graph => graph.getBacklinks(target, limit, canAccessPath, offset, async (sourcePath) => {
            const current = await this.readNoteMetadata([sourcePath], canAccessPath, { fresh: true, strict: true });
            return current.length > 0 && !isModerationHidden(current[0].frontmatter);
        }, options.includeSourceRevision, options.includeSnapshot));
    }
    async withGraphRead(read) {
        if (this.graphIndex)
            return read(this.graphIndex);
        const graph = new VaultGraphIndex(this.vaultPath, this.pathFilter, this.frontmatterHandler, undefined, this.vaultIo);
        try {
            return await read(graph);
        }
        finally {
            graph.close();
        }
    }
    async getOutlinks(path, limit = 100, canAccessPath = () => true, offset = 0, options = {}) {
        const source = this.normalizePath(path);
        if (!this.pathFilter.isAllowed(source) || !canAccessPath(source))
            throw new Error(`Access denied: ${source}`);
        const note = await this.readNote(source);
        if (isModerationHidden(note.frontmatter))
            throw new Error(`Access denied: ${source}`);
        return this.withGraphRead(graph => graph.getOutlinks(source, limit, canAccessPath, offset, options.includeSourceRevision, options.includeSnapshot));
    }
    async findUnresolvedLinks(limit = 100, canAccessPath = () => true, offset = 0, options = {}) {
        return this.withGraphRead(graph => graph.findUnresolvedLinks(limit, canAccessPath, offset, options.includeSnapshot));
    }
    async findOrphanNotes(limit = 100, canAccessPath = () => true, offset = 0, options = {}) {
        return this.withGraphRead(graph => graph.findOrphanNotes(limit, canAccessPath, offset, options.includeSnapshot));
    }
    async getDailyNote(dateInput = 'today', folder = 'Daily Notes') {
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
    async writeDailyNote(params) {
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
    async collectVaultFiles() {
        const files = [];
        const scanDirectory = async (dirPath, relativePath = '') => {
            const entries = await readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
                const fullEntryPath = join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    if (this.pathFilter.isAllowedForListing(entryRelativePath)) {
                        await scanDirectory(fullEntryPath, entryRelativePath);
                    }
                }
                else if (entry.isFile() && this.pathFilter.isAllowedForListing(entryRelativePath)) {
                    files.push(entryRelativePath);
                }
            }
        };
        await scanDirectory(this.vaultPath);
        return files;
    }
    async getNoteOutline(path) {
        path = this.normalizePath(path);
        if (!this.pathFilter.isAllowed(path)) {
            throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
        }
        const fullPath = this.resolvePath(path);
        const raw = await readFile(fullPath, 'utf-8');
        return projectNoteOutline(raw);
    }
    async readNoteLineWindow(params) {
        const path = this.normalizePath(params.path);
        if (!this.pathFilter.isAllowed(path)) {
            throw new Error(`Access denied: ${path}. This path is restricted (system files like .obsidian, .git, and dotfiles are not accessible).`);
        }
        const fullPath = this.resolvePath(path);
        const raw = await readFile(fullPath, 'utf-8');
        return projectNoteLineWindow(raw, params);
    }
    async readNoteLines(params) {
        return (await this.readNoteLineWindow(params)).content;
    }
    async getVaultStats(recentCount = 5, canAccessPath = () => true) {
        if (!Number.isSafeInteger(recentCount) || recentCount < 0)
            throw new Error('recentCount must be a non-negative safe integer');
        recentCount = Math.min(recentCount, 20);
        let totalNotes = 0;
        let totalFolders = 0;
        let totalSize = 0;
        const recentFiles = [];
        const scanDirectory = async (dirPath, relativePath = '') => {
            let entries;
            try {
                entries = await readdir(this.resolvePath(relativePath), { withFileTypes: true });
            }
            catch (error) {
                if (relativePath && isMissingVaultPath(error))
                    return;
                throw new VaultReadUnavailableError();
            }
            for (const entry of entries) {
                const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
                const fullEntryPath = join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    if (!this.pathFilter.isAllowedForListing(entryRelativePath)) {
                        continue;
                    }
                    if (canAccessPath(entryRelativePath))
                        totalFolders++;
                    await scanDirectory(fullEntryPath, entryRelativePath);
                }
                else if (entry.isFile()) {
                    if (!this.pathFilter.isAllowed(entryRelativePath) || !canAccessPath(entryRelativePath)) {
                        continue;
                    }
                    let stats;
                    try {
                        const checkedPath = this.resolvePath(entryRelativePath);
                        stats = await stat(checkedPath);
                        if (!stats.isFile())
                            continue;
                        if (/\.(?:md|markdown|txt)$/i.test(entryRelativePath)) {
                            const content = await this.vaultIo.readUtf8Bounded(checkedPath, MAX_NOTE_CONTENT_BYTES);
                            if (isModerationHidden(this.frontmatterHandler.parse(content).frontmatter))
                                continue;
                        }
                    }
                    catch (error) {
                        if (isMissingVaultPath(error))
                            continue;
                        if (error instanceof SourceReadLimitError)
                            throw new Error('Vault statistics require Markdown sources within the 8 MiB supported-note limit; no partial totals were returned.');
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
                    }
                    else {
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
    async listAllTags(canAccessPath = () => true) {
        return this.withGraphRead(graph => graph.listAllTags(canAccessPath));
    }
    resolvePathPrefix(input) {
        const rawPathPrefix = input ? this.normalizePath(input) : '';
        if (!rawPathPrefix)
            return '';
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
    async listTasks(params = {}, canAccessPath = () => true) {
        const status = params.status || 'open';
        if (status !== 'open' && status !== 'completed' && status !== 'all') {
            throw new Error('status must be open, completed, or all');
        }
        const requestedLimit = params.limit ?? 100;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new Error('limit must be a positive integer');
        }
        const limit = Math.min(requestedLimit, 500);
        const offset = params.offset ?? 0;
        if (!Number.isSafeInteger(offset) || offset < 0)
            throw new Error('offset must be a non-negative safe integer');
        if (params.expectedSnapshot !== undefined && !/^[a-f0-9]{64}$/.test(params.expectedSnapshot))
            throw new Error('expectedSnapshot must be a SHA256 fingerprint from list_tasks');
        if (offset > 0 && !params.expectedSnapshot)
            throw new Error('expectedSnapshot is required for continuation; restart list_tasks at offset 0');
        // Validate the optional scope before scanning. resolvePath performs the
        // lexical and symlink boundary checks; listing validation blocks hidden
        // and system directories such as .obsidian and .git.
        const pathPrefix = this.resolvePathPrefix(params.pathPrefix);
        const tasks = [];
        let total = 0;
        const fingerprint = createHash('sha256').update(JSON.stringify(['task-page-v1', status, pathPrefix]));
        const notePaths = (await this.collectVaultFiles())
            .filter(path => this.pathFilter.isAllowed(path))
            .filter(canAccessPath)
            .filter(path => /\.(?:md|markdown|txt)$/i.test(path))
            .filter(path => !pathPrefix || path === pathPrefix || path.startsWith(`${pathPrefix}/`))
            .sort();
        for (const path of notePaths) {
            let content;
            try {
                content = await this.vaultIo.readUtf8Bounded(this.resolvePath(path), MAX_NOTE_CONTENT_BYTES);
            }
            catch (error) {
                if (error instanceof SourceReadLimitError)
                    throw new Error('Task inventory source exceeds 8 MiB; narrow pathPrefix or split oversized notes before retrying. No partial inventory was returned.');
                if (isMissingVaultPath(error))
                    continue;
                throw new VaultReadUnavailableError();
            }
            if (isModerationHidden(this.frontmatterHandler.parse(content).frontmatter))
                continue;
            const revision = this.revision(content);
            for (const task of iterateMarkdownTasks(content, path)) {
                if (status !== 'all' && status !== task.status)
                    continue;
                fingerprint.update(JSON.stringify([path, revision, task.line, task.taskId, task.status]));
                if (total >= offset && tasks.length < limit)
                    tasks.push({ ...task, revision });
                total++;
            }
        }
        const snapshotFingerprint = fingerprint.digest('hex');
        if (params.expectedSnapshot && params.expectedSnapshot !== snapshotFingerprint)
            throw new Error('Task listing changed; restart list_tasks at offset 0 without expectedSnapshot');
        return {
            tasks,
            total,
            truncated: total > offset + tasks.length,
            offset,
            snapshotFingerprint,
        };
    }
    async updateTask(params) {
        const path = this.normalizePath(params.path);
        if (!this.pathFilter.isAllowed(path))
            throw new Error(`Access denied: ${path}`);
        if (!params.taskId && (!Number.isInteger(params.line) || params.line < 1))
            throw new Error('taskId or line must identify a task');
        if (params.status !== 'open' && params.status !== 'completed')
            throw new Error('status must be open or completed');
        if (!params.expectedRevision || !String(params.expectedRevision).trim())
            throw new Error('expectedRevision is required; read the note first');
        return this.withMutationLock(path, async () => {
            await this.assertExpectedRevision(path, params.expectedRevision);
            const note = await this.readNote(path);
            if (isModerationHidden(note.frontmatter))
                throw new Error(`Access denied: ${path}`);
            if (note.revision !== params.expectedRevision)
                throw new Error(`Revision conflict for ${path}: refresh list_tasks and retry`);
            const lines = note.originalContent.split('\n');
            const candidates = extractMarkdownTasks(note.originalContent, path).filter(task => params.taskId ? task.taskId === params.taskId : task.line === params.line);
            if (candidates.length > 1)
                throw new Error(`Task identity is ambiguous in ${path}; read the current note and use an explicit line without taskId, or repair duplicate block IDs`);
            const locatedTask = candidates[0];
            if (params.taskId && !locatedTask)
                throw new Error(`Task ${params.taskId} was not found in ${path}; refresh list_tasks and retry`);
            const targetLine = locatedTask?.line ?? params.line;
            if (targetLine > lines.length)
                throw new Error(`Task line ${targetLine} is outside ${path}`);
            const targetIndex = targetLine - 1;
            const targetMatch = locatedTask
                ? /^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/.exec(lines[targetIndex].replace(/\r$/, ''))
                : null;
            if (!targetMatch)
                throw new Error(`Line ${targetLine} is not a Markdown checkbox task outside frontmatter/code fences`);
            const previousStatus = targetMatch[2].toLowerCase() === 'x' ? 'completed' : 'open';
            const marker = params.status === 'completed' ? 'x' : ' ';
            if (previousStatus !== params.status) {
                const rawLine = lines[targetIndex];
                const checkboxOffset = (targetMatch.index || 0) + targetMatch[1].length;
                lines[targetIndex] = `${rawLine.slice(0, checkboxOffset)}${marker}${rawLine.slice(checkboxOffset + 1)}`;
                // We already hold this path's mutation lock. Calling the public
                // writeNote wrapper here would queue behind our own lock forever.
                await this.writeNoteUnlocked({ path, content: lines.join('\n'), expectedRevision: params.expectedRevision });
            }
            const updated = await this.readNote(path);
            const resultingTaskId = locatedTask?.taskId;
            return {
                success: true,
                path,
                line: targetLine,
                status: params.status,
                ...(resultingTaskId ? { taskId: resultingTaskId } : {}),
                previousStatus,
                previousRevision: note.revision,
                revision: updated.revision,
                message: previousStatus === params.status ? 'Task already had the requested status; no write was needed.' : `Task status updated to ${params.status}.`,
            };
        });
    }
    /** Hydrate one admitted metadata row without mixing revisions or reading an unbounded source. */
    async readQueryNoteBody(note, canAccessPath, canReadNote) {
        const path = this.normalizePath(note.path);
        if (!note.revision || !this.pathFilter.isAllowed(path) || !canAccessPath(path) || !canReadNote(note))
            throw new QuerySnapshotChangedError();
        return this.hydrateQueryNote({ ...note, path }, canAccessPath, canReadNote, resolved => this.vaultIo.readUtf8Bounded(resolved, MAX_NOTE_CONTENT_BYTES));
    }
    async hydrateQueryNote(note, canAccessPath, canReadNote, read) {
        let raw;
        try {
            raw = await read(this.resolvePath(note.path));
        }
        catch (error) {
            if (error instanceof SourceReadLimitError)
                throw error;
            if (isMissingVaultPath(error))
                throw new QuerySnapshotChangedError();
            throw new VaultReadUnavailableError();
        }
        if (this.revision(raw) !== note.revision || !canAccessPath(note.path))
            throw new QuerySnapshotChangedError();
        const parsed = this.frontmatterHandler.parse(raw);
        const current = { path: note.path, revision: note.revision, frontmatter: parsed.frontmatter, content: parsed.content };
        if (!canReadNote(current))
            throw new QuerySnapshotChangedError();
        return current;
    }
    async queryNotesBounded(params, maxChars, canAccessPath, canReadNote, prettyPrint = false) {
        if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 20000)
            throw new Error('maxChars must be an integer between 512 and 20000');
        const page = await this.queryNotes({ ...params, includeContent: false }, canAccessPath, canReadNote);
        let remainingBytes = 1024 * 1024;
        return packQueryPage(page, {
            maxChars, prettyPrint, includeContent: params.includeContent === true,
            cursorFor: note => cursorForQueryNote(note, params.sortBy || 'path'),
            hydrate: async (note) => {
                if (remainingBytes <= 1)
                    return undefined;
                const allowance = Math.min(256 * 1024, remainingBytes - 1);
                try {
                    return await this.hydrateQueryNote(note, canAccessPath, canReadNote, async (path) => {
                        const raw = await this.vaultIo.readUtf8Bounded(path, allowance);
                        remainingBytes -= Buffer.byteLength(raw, 'utf8');
                        return raw;
                    });
                }
                catch (error) {
                    if (!(error instanceof SourceReadLimitError))
                        throw error;
                    // Conservative charge also covers growth detected after the initial stat.
                    remainingBytes -= allowance + 1;
                    return undefined;
                }
            },
        });
    }
    /** Internal whole-inventory consumer. Unlike independent cursor pages, all
     * rows belong to one captured metadata cohort. This is not an OS transaction. */
    async readQueryInventory(canAccessPath, canReadNote, includeContentFor, consumeContent) {
        // Consumers collect request-local projections only. Their results are not
        // valid unless this method's final cohort validation succeeds.
        const consume = async (note) => {
            if (!consumeContent)
                return note;
            try {
                await consumeContent(note);
            }
            catch {
                throw new Error('Inventory content projection failed; retry the request.');
            }
            const { content: _content, ...metadata } = note;
            return metadata;
        };
        const admitted = (note) => this.pathFilter.isAllowed(note.path)
            && canAccessPath(note.path) && canReadNote(note);
        const captureMetadata = async () => (await this.metadataIndex.list())
            .map(entry => ({ path: this.normalizePath(entry.path), frontmatter: entry.frontmatter, revision: entry.revision }))
            .filter(admitted);
        if (!this.metadataIndex) {
            const paths = (await this.collectVaultFiles()).map(path => this.normalizePath(path))
                .filter(path => /\.(?:md|markdown|txt)$/i.test(path) && this.pathFilter.isAllowed(path) && canAccessPath(path));
            const notes = [];
            for (const path of paths) {
                let raw;
                try {
                    raw = await this.vaultIo.readUtf8Bounded(this.resolvePath(path), MAX_NOTE_CONTENT_BYTES);
                }
                catch (error) {
                    if (error instanceof SourceReadLimitError)
                        throw error;
                    if (isMissingVaultPath(error))
                        throw new QuerySnapshotChangedError();
                    throw new VaultReadUnavailableError();
                }
                const parsed = this.frontmatterHandler.parse(raw);
                const note = { path, frontmatter: parsed.frontmatter, revision: this.revision(raw) };
                if (admitted(note))
                    notes.push(includeContentFor?.(note) ? await consume({ ...note, content: parsed.content }) : note);
            }
            if (notes.some(note => !admitted(note)))
                throw new QuerySnapshotChangedError();
            return notes;
        }
        const notes = await captureMetadata();
        if (!includeContentFor)
            return notes;
        const selected = notes.filter(includeContentFor);
        if (!selected.length)
            return notes;
        const hydrated = new Map();
        for (let start = 0; start < selected.length; start += 16) {
            const batch = await Promise.allSettled(selected.slice(start, start + 16).map(async (note) => consume(await this.hydrateQueryNote(note, canAccessPath, canReadNote, path => this.vaultIo.readUtf8Bounded(path, MAX_NOTE_CONTENT_BYTES)))));
            const failure = batch.find(result => result.status === 'rejected');
            if (failure?.status === 'rejected')
                throw failure.reason;
            for (const result of batch)
                if (result.status === 'fulfilled')
                    hydrated.set(result.value.path, result.value);
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
    async queryNotes(params = {}, canAccessPath = () => true, canReadNote = () => true) {
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
        const notes = [];
        const filters = params.filters || {};
        const hydrate = (selected) => Promise.all(selected.map(note => this.hydrateQueryNote(note, canAccessPath, canReadNote, path => this.vaultIo.readUtf8(path))));
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
                canReadEntry: canReadNote,
            });
            const selected = page.entries.map(entry => ({ path: entry.path, frontmatter: entry.frontmatter, revision: entry.revision }));
            const nextCursor = page.truncated ? cursorForQueryNote(selected[selected.length - 1], sortBy) : undefined;
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
        const indexedEntries = this.metadataIndex ? await this.metadataIndex.listSorted(filters, pathPrefix, sortBy, sortOrder) : undefined;
        if (indexedEntries) {
            for (const entry of indexedEntries) {
                if (!this.pathFilter.isAllowed(entry.path) || !canAccessPath(entry.path))
                    continue;
                if (pathPrefix && entry.path !== pathPrefix && !entry.path.startsWith(`${pathPrefix}/`))
                    continue;
                const matches = Object.entries(filters).every(([key, expected]) => {
                    const actual = getFrontmatterValue(entry.frontmatter, key);
                    return actual.found && frontmatterValuesEqual(actual.value, expected);
                });
                if (matches && canReadNote(entry))
                    notes.push({ path: entry.path, frontmatter: entry.frontmatter, revision: entry.revision });
            }
        }
        else {
            const notePaths = (await this.collectVaultFiles())
                .filter(path => this.pathFilter.isAllowed(path))
                .filter(canAccessPath)
                .filter(path => /\.(?:md|markdown|txt)$/i.test(path))
                .filter(path => !pathPrefix || path === pathPrefix || path.startsWith(`${pathPrefix}/`))
                .sort((a, b) => a.localeCompare(b));
            for (const path of notePaths) {
                let raw;
                try {
                    raw = await readFile(this.resolvePath(path), 'utf-8');
                }
                catch (error) {
                    if (isMissingVaultPath(error))
                        throw new QuerySnapshotChangedError();
                    throw new VaultReadUnavailableError();
                }
                const parsed = this.frontmatterHandler.parse(raw);
                const matches = Object.entries(filters).every(([key, expected]) => {
                    const actual = getFrontmatterValue(parsed.frontmatter, key);
                    return actual.found && frontmatterValuesEqual(actual.value, expected);
                });
                const note = { path, frontmatter: parsed.frontmatter, revision: this.revision(raw), ...(params.includeContent && { content: parsed.content }) };
                if (matches && canReadNote(note))
                    notes.push(note);
            }
        }
        const afterNotes = params.after
            ? notes.filter(note => compareQueryNoteToCursor(note, params.after, sortBy, sortOrder) > 0)
            : notes;
        const selected = indexedEntries
            ? afterNotes.slice(requestedOffset, requestedOffset + limit)
            : selectSortedNotes(afterNotes, sortBy, sortOrder, requestedOffset, limit);
        const truncated = requestedOffset + limit < afterNotes.length;
        const nextCursor = selected.length > 0 && truncated ? cursorForQueryNote(selected[selected.length - 1], sortBy) : undefined;
        if (params.includeContent && indexedEntries) {
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
    async queryAuthorityShelf(params, canAccessPath = () => true) {
        if (!this.metadataIndex)
            throw new Error('Authority shelf queries require the metadata index');
        return this.metadataIndex.queryAuthorityShelf(params, canAccessPath);
    }
    /** Fresh bypasses indexes; strict preserves storage failures instead of treating them as missing notes. */
    async readNoteMetadata(paths, canAccessPath = () => true, options = {}) {
        if (paths.length > 500)
            throw new Error('note metadata lookup supports at most 500 paths');
        const normalizedPaths = [];
        const seen = new Set();
        for (const rawPath of paths) {
            const path = this.normalizePath(rawPath);
            const key = path.toLocaleLowerCase('en-US');
            if (!path || seen.has(key))
                continue;
            seen.add(key);
            if (!this.pathFilter.isAllowed(path) || !canAccessPath(path))
                continue;
            normalizedPaths.push(path);
        }
        if (this.metadataIndex && !options.fresh) {
            return (await this.metadataIndex.getMany(normalizedPaths, canAccessPath))
                .map(entry => ({ path: entry.path, frontmatter: entry.frontmatter, revision: entry.revision }));
        }
        const notes = [];
        for (const path of normalizedPaths) {
            try {
                const raw = await this.vaultIo.readUtf8(this.resolvePath(path));
                const parsed = this.frontmatterHandler.parse(raw);
                if (!canAccessPath(path))
                    continue;
                notes.push({ path, frontmatter: parsed.frontmatter, revision: this.revision(raw) });
            }
            catch (error) {
                // A projected candidate may be deleted between the source scan and
                // this metadata read. Omit it rather than returning stale authority.
                const code = error?.code;
                if (options.strict && code !== 'ENOENT' && code !== 'ENOTDIR')
                    throw error;
            }
        }
        return notes;
    }
    /** Count metadata rows without reading note bodies; used by bounded windows. */
    async countNotes(params = {}, canAccessPath = () => true, predicate = () => true) {
        const pathPrefix = this.resolvePathPrefix(params.pathPrefix);
        if (this.metadataIndex) {
            return this.metadataIndex.count(params.filters || {}, pathPrefix, canAccessPath, entry => predicate({ path: entry.path, frontmatter: entry.frontmatter, revision: entry.revision }));
        }
        const result = await this.queryNotes({ ...params, limit: 1, includeContent: false, includeTotal: true }, canAccessPath);
        return result.total;
    }
}
