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
  terms: Map<string, Set<string>>;
}

export interface ResolveNoteReferenceOptions {
  sourcePath?: string;
  preferRelative?: boolean;
  canReference?: (sourcePath: string, targetPath: string) => boolean;
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
    add(qualified, withoutExtension.toLocaleLowerCase(), path);
    const alternatePaths = Array.isArray(note.qualifiedPaths)
      ? note.qualifiedPaths
      : note.qualifiedPaths === undefined || note.qualifiedPaths === null ? [] : [note.qualifiedPaths];
    for (const alternate of alternatePaths) {
      if (typeof alternate !== 'string' || !alternate.trim()) continue;
      const alternatePath = normalizeNoteReferencePath(alternate);
      add(qualified, alternatePath.toLocaleLowerCase(), path);
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
  return { paths, qualified, terms };
}

/**
 * Resolve one visible Obsidian-style document reference. Exact paths win over
 * identity terms; ambiguous terms stay ambiguous. The index must contain only
 * notes visible to the caller, and an optional edge predicate can narrow it
 * further without ever broadening visibility.
 */
export function resolveNoteReference(document: string, index: NoteReferenceIndex, options: ResolveNoteReferenceOptions = {}): string[] {
  const target = noteReferenceDocument(document);
  if (!target) return [];
  const normalized = normalizeNoteReferencePath(target);
  let matches: string[] = [];
  if (options.sourcePath && (options.preferRelative || target.startsWith('../') || target.startsWith('./'))) {
    const relative = normalizeNoteReferencePath(posix.normalize(posix.join(posix.dirname(normalizeNoteReferencePath(options.sourcePath)), target)));
    const relativeMatches = index.qualified.get(relative.toLocaleLowerCase())
      || index.qualified.get(relative.replace(NOTE_EXTENSION, '').toLocaleLowerCase());
    matches = [...(relativeMatches || [])];
  }
  if (!matches.length) {
    const indexed = target.includes('/')
      ? index.qualified.get(normalized.toLocaleLowerCase()) || index.qualified.get(normalized.replace(NOTE_EXTENSION, '').toLocaleLowerCase())
      : noteReferenceTermKeys(normalized).map(key => index.terms.get(key)).find(values => values && values.size > 0);
    matches = [...(indexed || [])];
  }
  if (!matches.length) matches = resolveWikiLinkTargets(target, index.paths);
  const sourcePath = options.sourcePath || '';
  return [...new Set(matches.filter(candidate => !options.canReference || options.canReference(sourcePath, candidate)))]
    .sort((left, right) => left.localeCompare(right));
}
