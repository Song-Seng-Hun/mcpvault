import { posix } from 'node:path';
import type { QueryNote } from '../types.js';
import { buildNoteReferenceIndex, markdownNotePath, normalizeNoteReferencePath,
  noteReferenceDocument, noteReferenceTermKeys, resolveNoteReference, type ResolveNoteReferenceOptions } from '../note-reference.js';
import type { MemorySqliteStore } from './sqlite-store.js';

export interface GraphReferenceCapture {
  reason?: string;
  resolve(document: string, options?: ResolveNoteReferenceOptions): Promise<string[]>;
  assertCurrent(): Promise<void>;
}
export interface GraphReadIndex {
  graphReferences(canAccess: (path: string) => boolean, read: (path: string) => Promise<QueryNote | undefined>): Promise<GraphReferenceCapture>;
}

/** Bounded advisory lookup, followed by the same live identity resolver used by
 * the legacy path. Missing candidates are never a proof of reference absence. */
export function indexedGraphReferences(store: MemorySqliteStore, canAccess: (path: string) => boolean,
  read: (path: string) => Promise<QueryNote | undefined>, current: () => Promise<void>): GraphReferenceCapture {
  const observed = new Set<string>();
  let lookups = 0;
  const assertCurrent = async () => {
    await current();
    if ([...observed].some(p => !canAccess(p))) throw Error('Graph access changed');
  };
  return { assertCurrent, resolve: async (document, options = {}) => {
    await assertCurrent();
    if (++lookups > 160) throw Error('Graph lookup budget exceeded');
    const normalized = normalizeNoteReferencePath(noteReferenceDocument(document));
    let keys = [normalized, ...noteReferenceTermKeys(normalized)];
    if (options.syntax === 'markdown') {
      const target = markdownNotePath(document, options.sourcePath ?? '');
      if (!target) return [];
      keys = [target, ...noteReferenceTermKeys(target)];
    } else if (options.sourcePath && (options.preferRelative || /^\.\.?\//.test(normalized))) {
      const relative = posix.normalize(posix.join(posix.dirname(options.sourcePath), normalized));
      keys = [relative, ...noteReferenceTermKeys(relative), ...keys];
    }
    if (!keys.length) return [];
    const page = await store.referenceCandidates(keys, 64);
    // A hidden or high-degree alias cannot force an arbitrary unique match.
    // Public packets do not expose candidate counts or the reason for omission.
    if (page.truncated) { await assertCurrent(); return []; }
    const visible: QueryNote[] = [];
    for (const candidate of page.notes) {
      if (!canAccess(candidate.path)) continue;
      if (observed.size >= 64 && !observed.has(candidate.path)) return [];
      observed.add(candidate.path);
      const note = await read(candidate.path);
      if (!note) { await assertCurrent(); return []; }
      if (note.revision !== candidate.revision) throw Error('Graph identity changed');
      visible.push(note);
    }
    await assertCurrent();
    return resolveNoteReference(document, buildNoteReferenceIndex(visible.map(n => ({ path: n.path,
      title: n.frontmatter.title, aliases: n.frontmatter.aliases, preferredTerm: n.frontmatter.preferred_term,
      stableId: n.frontmatter.stable_id }))), options);
  } };
}
