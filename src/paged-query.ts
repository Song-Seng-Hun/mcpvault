import type { FileSystemService } from './filesystem.js';
import type { QueryNote, QueryNotesParams, QueryNotesResult } from './types.js';

const PAGE_SIZE = 500;
const BODY_BATCH_SIZE = 4;

/** Stream small revision-checked body groups, never a whole hydrated page.
 * Started siblings settle before failure/return; the next group is not prefetched.
 */
export async function* iterateNoteBodies(
  fileSystem: FileSystemService,
  params: QueryNotesParams = {},
  canAccessPath: (path: string) => boolean = () => true,
  canReadNote: (note: QueryNote) => boolean = () => true,
): AsyncGenerator<QueryNote, void, void> {
  const { offset: _offset, after: initialAfter, ...baseParams } = params;
  let after = initialAfter;
  while (true) {
    const page = await fileSystem.queryNotes({
      ...baseParams, limit: PAGE_SIZE, ...(after ? { after } : {}),
      includeContent: false, includeTotal: false,
    }, canAccessPath, canReadNote);
    for (let start = 0; start < page.notes.length; start += BODY_BATCH_SIZE) {
      const results = await Promise.allSettled(page.notes.slice(start, start + BODY_BATCH_SIZE)
        .map(note => fileSystem.readQueryNoteBody(note, canAccessPath, canReadNote)));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      for (const result of results) if (result.status === 'fulfilled') yield result.value;
    }
    if (!page.truncated || page.notes.length === 0 || !page.nextCursor) return;
    after = page.nextCursor;
  }
}

/**
 * Stream matching metadata pages without retaining the complete collection.
 * Callers that need a response window should prefer queryWindow; this helper
 * is for bounded-memory scans such as linting and derived-index rebuilds.
 */
export async function* iterateNotes(
  fileSystem: FileSystemService,
  params: QueryNotesParams = {},
  canAccessPath: (path: string) => boolean = () => true,
): AsyncGenerator<QueryNotesResult['notes'][number], void, void> {
  const { offset: _offset, after: initialAfter, ...baseParams } = params;
  let after = initialAfter;
  while (true) {
    const page = await fileSystem.queryNotes({
      ...baseParams,
      limit: PAGE_SIZE,
      ...(after ? { after } : {}),
      includeContent: params.includeContent === true,
      includeTotal: false,
    }, canAccessPath);
    for (const note of page.notes) yield note;
    if (!page.truncated || page.notes.length === 0 || !page.nextCursor) return;
    after = page.nextCursor;
  }
}

/**
 * Read only enough metadata rows to fill a bounded response window. A
 * predicate may discard hidden or workflow-closed rows; the helper advances
 * by keyset cursor until the requested visible page is full.
 */
export async function queryWindow(
  fileSystem: FileSystemService,
  params: QueryNotesParams & { limit: number },
  predicate: (note: QueryNotesResult['notes'][number]) => boolean = () => true,
  canAccessPath: (path: string) => boolean = () => true,
): Promise<{ notes: QueryNotesResult['notes']; truncated: boolean }> {
  const notes: QueryNotesResult['notes'] = [];
  let after = params.after;
  let truncated = false;
  while (notes.length < params.limit) {
    const page = await fileSystem.queryNotes({
      ...params,
      limit: Math.max(1, params.limit - notes.length),
      ...(after ? { after } : {}),
      includeTotal: false,
    }, canAccessPath);
    for (const note of page.notes) {
      if (predicate(note)) notes.push(note);
      if (notes.length >= params.limit) break;
    }
    if (!page.truncated || !page.nextCursor) {
      truncated = false;
      break;
    }
    truncated = true;
    after = page.nextCursor;
  }
  return { notes, truncated };
}

/**
 * Read every matching metadata row in bounded pages. The caller still owns
 * the final response limit; this helper only removes the old silent 500-row
 * ceiling from internal discovery paths. Callers should leave
 * includeContent=false and hydrate only the selected rows when bodies are
 * needed.
 */
export async function queryAllNotes(
  fileSystem: FileSystemService,
  params: QueryNotesParams = {},
  canAccessPath: (path: string) => boolean = () => true,
): Promise<QueryNotesResult> {
  const { offset: _offset, after: initialAfter, ...baseParams } = params;
  const notes: QueryNotesResult['notes'] = [];
  let after = initialAfter;
  let total = 0;
  while (true) {
    const page = await fileSystem.queryNotes({ ...baseParams, limit: PAGE_SIZE, ...(after ? { after } : {}), includeContent: params.includeContent === true, includeTotal: true }, canAccessPath);
    notes.push(...page.notes);
    total = page.total;
    if (!page.truncated || page.notes.length === 0 || !page.nextCursor) break;
    after = page.nextCursor;
  }
  return { notes, total, truncated: notes.length < total };
}
