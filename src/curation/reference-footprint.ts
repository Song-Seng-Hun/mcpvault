import { posix } from 'node:path';
import { extractObsidianLinkOccurrences } from '../backlinks.js';
import { buildNoteReferenceIndex, noteReferenceDocument, normalizeNoteReferencePath } from '../note-reference.js';
import { acceptsPlainReference } from '../property-references.js';

// Private, conservative candidate keys, NOT resolved edges or permission. A
// basename collision deliberately over-selects; current source resolution must
// follow before any mutation. Keep snapshots separate from navigational graph.
function keysFor(value: string, allowProtocol = false): string[] {
  const document = normalizeNoteReferencePath(noteReferenceDocument(value).split('?', 1)[0]!);
  if (!document || document.startsWith('#')) return [];
  if (!allowProtocol && /^[a-z][a-z0-9+.-]*:/i.test(document) && !/^scope:\/\//i.test(document)) return [];
  const normalized = document.replace(/\.(?:md|markdown|txt)$/i, '').toLocaleLowerCase();
  return [...new Set([normalized, normalized.replace(/\s+/g, ' '), posix.basename(normalized)])];
}

export function referenceTargetKeys(note: { path: string; frontmatter: Record<string, any> }): string[] {
  const fm = note.frontmatter;
  if (Array.isArray(fm.aliases) && fm.aliases.length > 512) throw Error('Reference identity budget exceeded');
  const identities = buildNoteReferenceIndex([{ path: note.path, title: fm.title, aliases: fm.aliases,
    preferredTerm: fm.preferred_term, stableId: fm.stable_id }]);
  const keys = [...new Set([identities.qualified, identities.exact, identities.filenames, identities.terms]
    .flatMap(m => [...m.keys()].flatMap(key => keysFor(key, true))))];
  if (!keys.length || keys.length > 128 || keys.some(k => k.length > 1024)) throw Error('Reference identity budget exceeded');
  return keys.sort();
}

export function referenceDocumentPath(path: string): void {
  if (typeof path !== 'string' || path.length > 4096 || !/\.(?:md|markdown|txt)$/i.test(path)
    || /[\\:\x00-\x1f#|\[\]]/.test(path) || path.startsWith('/') || path.startsWith('~')
    || path.split('/').some(s => !s || s === '.' || s === '..')) throw Error('Invalid reference document path');
}

export function referenceFootprint(note: { path: string; text: string; frontmatter: Record<string, unknown> }): { keys: string[]; partial: boolean } {
  const keys = new Set<string>(), ancestors = new Set<object>();
  let partial = false, occurrences = 0, visited = 0;
  const add = (value: string, allowProtocol = false) => {
    if (++occurrences > 200) { partial = true; return; }
    for (const key of keysFor(value, allowProtocol)) {
      if (key.length > 1024 || keys.size >= 600) partial = true;
      else keys.add(key);
    }
  };
  const explicit = (text: string) => {
    for (const link of extractObsidianLinkOccurrences(text, 201 - Math.min(occurrences, 200))) add(link.target, /^!?\[\[/.test(link.link));
  };
  explicit(note.text);
  const visit = (value: unknown, path: Array<string | number>) => {
    if (++visited > 4096 || path.length > 32 || occurrences > 200) { partial = true; return; }
    if (typeof value === 'string') {
      explicit(value);
      // Mirror the writer: it attempts explicit links, then a plain reference.
      // Over-selection is safe and avoids suppressing mixed malformed values.
      if (acceptsPlainReference(path)) add(value);
    } else if (value && typeof value === 'object') {
      if (ancestors.has(value)) { partial = true; return; }
      ancestors.add(value);
      for (const [key, item] of Object.entries(value)) {
        visit(item, [...path, Array.isArray(value) ? Number(key) : key]);
        if (visited > 4096 || occurrences > 200) break;
      }
      ancestors.delete(value);
    }
  };
  visit(note.frontmatter, []);
  return { keys: [...keys].sort(), partial };
}
