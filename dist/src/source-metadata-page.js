import { guidanceError } from './guidance-runtime.js';
import { isModerationHidden } from './moderation-policy.js';
import { RETRIEVAL_NOTE_BYTES } from './retrieval-service.js';
/** Fresh bounded discovery without queryNotes' no-index body hydration.
 * Path inventory is reused; only <=60 headers/revision streams are examined.
 * Reaching a budget means possible continuation, not another matching note.
 * Callers must revalidate ALL observed revisions/permissions before return. */
export async function readSourceMetadataPage(fs, canAccess, predicate, afterPath, limit = 20) {
    const notes = [], observed = [];
    let lastVisible;
    for await (const n of fs.iterateFreshNoteMetadata(canAccess, { ...(afterPath && { afterPath }), sortByPath: true, maxBytes: RETRIEVAL_NOTE_BYTES, strictMissing: true })) {
        observed.push(n);
        if (!isModerationHidden(n.frontmatter)) {
            lastVisible = n.path;
            if (predicate(n))
                notes.push(n);
        }
        if (observed.length >= 60 || notes.length >= Math.max(1, Math.min(20, limit))) {
            if (!lastVisible)
                throw guidanceError(Error('Bounded source metadata page unavailable; select an exact source or knowledge path'), 'guid-e97e5a9a3999833d');
            return { notes, observed, truncated: true, afterPath: lastVisible };
        }
    }
    return { notes, observed, truncated: false };
}
