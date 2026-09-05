import { posix } from 'node:path';
import { resolveWikiLinkTargets } from './backlinks.js';

const NOTE_EXTENSION = /\.(?:md|markdown|txt)$/i;

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
  exact: Map<string, Set<string>>;
  filenames: Map<string, Set<string>>;
  terms: Map<string, Set<string>>;
}

export interface ResolveNoteReferenceOptions {
  sourcePath?: string;
  syntax?: 'markdown';
  preferRelative?: boolean;
  canReference?: (sourcePath: string, targetPath: string) => boolean;
}

/** A local Markdown destination names a path, never an alias or basename. */
export function markdownNotePath(target: string, sourcePath: string): string | undefined {
  const value = target.trim().replace(/\\/g, '/');
  if (!value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
  const explicitRelative = /^\.\.?\//.test(value);
  const rootQualified = value.startsWith('/') || (value.includes('/') && !explicitRelative);
  const candidate = posix.normalize(rootQualified ? value.replace(/^\//, '') : posix.join(posix.dirname(normalizeNoteReferencePath(sourcePath)), value));
  if (candidate === '.' || candidate === '..' || candidate.startsWith('../')) return undefined;
  return normalizeNoteReferencePath(candidate);
}

export function normalizeNoteReferencePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function normalizeNoteReferenceTerm(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function noteReferenceDocument(value: string): string {
  return value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split(/[|#]/, 1)[0]!.trim();
}

export function noteReferenceTermKeys(value: unknown): string[] {
  const normalized = normalizeNoteReferenceTerm(value);
  if (!normalized) return [];
  const withoutNoteExtension = normalized.replace(NOTE_EXTENSION, '');
  return withoutNoteExtension === normalized ? [normalized] : [normalized, withoutNoteExtension];
}

function add(index: Map<string, Set<string>>, key: string, path: string): void {
  if (!key) return;
  const values = index.get(key) || new Set<string>();
  values.add(path);
  index.set(key, values);
}

/** Build a request-local identity resolver from notes already filtered for visibility. */
export function buildNoteReferenceIndex(notes: Iterable<NoteReferenceDescriptor>): NoteReferenceIndex {
  const paths: string[] = [];
  const qualified = new Map<string, Set<string>>();
  const exact = new Map<string, Set<string>>();
  const filenames = new Map<string, Set<string>>();
  const terms = new Map<string, Set<string>>();
  const seenPaths = new Set<string>();
  for (const note of notes) {
    const path = normalizeNoteReferencePath(note.path);
    const pathKey = path.toLocaleLowerCase();
    if (!path || seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);
    paths.push(path);
    const withoutExtension = path.replace(NOTE_EXTENSION, '');
    add(qualified, pathKey, path);
    add(exact, pathKey, path);
    add(qualified, withoutExtension.toLocaleLowerCase(), path);
    add(filenames, path.split('/').at(-1)!.toLocaleLowerCase(), path);
    const alternatePaths = Array.isArray(note.qualifiedPaths)
      ? note.qualifiedPaths
      : note.qualifiedPaths === undefined || note.qualifiedPaths === null ? [] : [note.qualifiedPaths];
    for (const alternate of alternatePaths) {
      if (typeof alternate !== 'string' || !alternate.trim()) continue;
      const alternatePath = normalizeNoteReferencePath(alternate);
      add(qualified, alternatePath.toLocaleLowerCase(), path);
      add(exact, alternatePath.toLocaleLowerCase(), path);
      add(qualified, alternatePath.replace(NOTE_EXTENSION, '').toLocaleLowerCase(), path);
    }
    for (const key of noteReferenceTermKeys(withoutExtension.split('/').at(-1))) add(terms, key, path);
    const aliases = Array.isArray(note.aliases) ? note.aliases : note.aliases === undefined || note.aliases === null ? [] : [note.aliases];
    for (const term of [note.title, note.preferredTerm, note.stableId, ...aliases]) {
      if (typeof term !== 'string' || !term.trim()) continue;
      for (const key of noteReferenceTermKeys(term)) add(terms, key, path);
    }
  }
  paths.sort((left, right) => left.localeCompare(right));
  return { paths, qualified, exact, filenames, terms };
}

/**
 * Resolve one visible Obsidian-style document reference. Exact paths win over
 * identity terms; ambiguous terms stay ambiguous. The index must contain only
 * notes visible to the caller, and an optional edge predicate can narrow it
 * further without ever broadening visibility.
 */
export function resolveNoteReference(document: string, index: NoteReferenceIndex, options: ResolveNoteReferenceOptions = {}): string[] {
  if (options.syntax === 'markdown') {
    const path = markdownNotePath(document, options.sourcePath || '');
    if (!path) return [];
    const matches = index.qualified.get(path.toLocaleLowerCase()) || index.qualified.get(path.replace(NOTE_EXTENSION, '').toLocaleLowerCase());
    const hasExtension = /(^|\/)[^/]+\.[^/]+$/.test(path);
    return [...(matches || [])]
      .filter(target => !hasExtension || target.toLocaleLowerCase() === path.toLocaleLowerCase())
      .filter(target => !options.canReference || options.canReference(options.sourcePath || '', target))
      .sort((a, b) => a.localeCompare(b));
  }
  const target = noteReferenceDocument(document);
  if (!target) return [];
  const normalized = normalizeNoteReferencePath(target);
  const explicitNoteExtension = NOTE_EXTENSION.test(normalized);
  let matches: string[] = [];
  if (options.sourcePath && (options.preferRelative || target.startsWith('../') || target.startsWith('./'))) {
    const relative = normalizeNoteReferencePath(posix.normalize(posix.join(posix.dirname(normalizeNoteReferencePath(options.sourcePath)), target)));
    const relativeMatches = (explicitNoteExtension ? index.exact : index.qualified).get(relative.toLocaleLowerCase())
      || (!explicitNoteExtension ? index.qualified.get(relative.replace(NOTE_EXTENSION, '').toLocaleLowerCase()) : undefined);
    matches = [...(relativeMatches || [])];
    // An authored ./ or ../ path is an exact source-relative location, not
    // permission to silently choose a same-name note elsewhere when missing.
    if (!matches.length && (target.startsWith('../') || target.startsWith('./'))) return [];
  }
  if (!matches.length) {
    const indexed = explicitNoteExtension
      ? target.includes('/') ? index.exact.get(normalized.toLocaleLowerCase()) : index.filenames.get(normalized.toLocaleLowerCase())
      : target.includes('/')
      ? index.qualified.get(normalized.toLocaleLowerCase()) || index.qualified.get(normalized.replace(NOTE_EXTENSION, '').toLocaleLowerCase())
      : noteReferenceTermKeys(normalized).map(key => index.terms.get(key)).find(values => values && values.size > 0);
    matches = [...(indexed || [])];
  }
  if (!matches.length && !explicitNoteExtension) matches = resolveWikiLinkTargets(target, index.paths);
  const sourcePath = options.sourcePath || '';
  return [...new Set(matches.filter(candidate => !options.canReference || options.canReference(sourcePath, candidate)))]
    .sort((left, right) => left.localeCompare(right));
}
