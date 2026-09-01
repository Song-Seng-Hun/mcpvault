const PAGE_SIZE = 500;
/**
 * Read every matching metadata row in bounded pages. The caller still owns
 * the final response limit; this helper only removes the old silent 500-row
 * ceiling from internal discovery paths. Callers should leave
 * includeContent=false and hydrate only the selected rows when bodies are
 * needed.
 */
export async function queryAllNotes(fileSystem, params = {}, canAccessPath = () => true) {
    const notes = [];
    let offset = 0;
    let total = 0;
    while (true) {
        const page = await fileSystem.queryNotes({ ...params, limit: PAGE_SIZE, offset, includeContent: params.includeContent === true }, canAccessPath);
        notes.push(...page.notes);
        total = page.total;
        offset += page.notes.length;
        if (!page.truncated || page.notes.length === 0 || offset >= page.total)
            break;
    }
    return { notes, total, truncated: offset < total };
}
