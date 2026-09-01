const PAGE_SIZE = 500;
/**
 * Read every matching metadata row in bounded pages. The caller still owns
 * the final response limit; this helper only removes the old silent 500-row
 * ceiling from internal discovery paths. Callers should leave
 * includeContent=false and hydrate only the selected rows when bodies are
 * needed.
 */
export async function queryAllNotes(fileSystem, params = {}, canAccessPath = () => true) {
    const { offset: _offset, after: initialAfter, ...baseParams } = params;
    const notes = [];
    let after = initialAfter;
    let total = 0;
    while (true) {
        const page = await fileSystem.queryNotes({ ...baseParams, limit: PAGE_SIZE, ...(after ? { after } : {}), includeContent: params.includeContent === true, includeTotal: true }, canAccessPath);
        notes.push(...page.notes);
        total = page.total;
        if (!page.truncated || page.notes.length === 0 || !page.nextCursor)
            break;
        after = page.nextCursor;
    }
    return { notes, total, truncated: notes.length < total };
}
