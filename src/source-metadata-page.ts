import type { FileSystemService } from './filesystem.js';
import type { QueryNote } from './types.js';
import { isModerationHidden } from './moderation-policy.js';
import { RETRIEVAL_NOTE_BYTES } from './retrieval-service.js';

/** Fresh bounded discovery without queryNotes' no-index body hydration.
 * Path inventory is reused; only <=60 headers/revision streams are examined.
 * Reaching a budget means possible continuation, not another matching note.
 * Callers must revalidate ALL observed revisions/permissions before return. */
export async function readSourceMetadataPage(fs: FileSystemService, canAccess: (p: string) => boolean,
  predicate: (n: QueryNote) => boolean, afterPath?: string, limit = 20): Promise<{ notes: QueryNote[]; observed: QueryNote[]; truncated: boolean; afterPath?: string }> {
  const notes: QueryNote[] = [], observed: QueryNote[] = [];
  let lastVisible: string | undefined;
  for await (const n of fs.iterateFreshNoteMetadata(canAccess, { ...(afterPath && { afterPath }), sortByPath: true, maxBytes: RETRIEVAL_NOTE_BYTES, strictMissing: true })) {
    observed.push(n);
    if (!isModerationHidden(n.frontmatter)) { lastVisible = n.path; if (predicate(n)) notes.push(n); }
    if (observed.length >= 60 || notes.length >= Math.max(1, Math.min(20, limit))) {
      if (!lastVisible) throw Error('Bounded source metadata page unavailable; select an exact source or knowledge path');
      return { notes, observed, truncated: true, afterPath: lastVisible };
    }
  }
  return { notes, observed, truncated: false };
}
