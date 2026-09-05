/** Preserve a contiguous delivery prefix and never derive a cursor from clipped Properties. */
export async function packQueryPage(page, options) {
    const { maxChars } = options;
    if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 20000)
        throw new Error('maxChars must be an integer between 512 and 20000');
    const delivered = [];
    const envelope = (notes, index) => {
        const more = index < page.notes.length - 1 || page.truncated;
        return { notes, total: page.total, ...(page.totalKnown === false && { totalKnown: false }), truncated: more,
            ...(more && index >= 0 && { nextCursor: options.cursorFor(page.notes[index]) }),
        };
    };
    let value = envelope([], -1);
    const omitted = (note, minimal, hydrated, readBudget = maxChars) => ({
        path: note.path,
        ...(note.revision && { revision: note.revision }),
        ...(minimal ? { frontmatterOmitted: true } : { frontmatter: note.frontmatter }),
        ...(options.includeContent && { contentOmitted: true }),
        ...(!hydrated && { sourceState: 'index_advisory' }),
        nextAction: { endpointId: 'mcp.get_note_outline', arguments: {
                path: note.path, ...(note.revision && { expectedRevision: note.revision }), maxChars: Math.min(readBudget, 12000),
            } },
    });
    for (let index = 0; index < page.notes.length; index++) {
        const original = page.notes[index];
        const fits = (note) => JSON.stringify(envelope([...delivered, note], index)).length <= maxChars;
        const minimal = omitted(original, true, false);
        // Avoid even a bounded source read when this row cannot be represented in
        // the remaining page. A first oversized row may use an explicit locator.
        const canAttempt = fits({ ...original }) || (index === 0 && fits(minimal));
        if (!canAttempt && index > 0)
            break;
        let current = original;
        let hydrated = false;
        if (canAttempt && options.includeContent && options.hydrate) {
            const raw = await options.hydrate(original);
            if (raw) {
                current = raw;
                hydrated = true;
            }
        }
        const full = options.includeContent && !hydrated ? omitted(current, false, false) : { ...current };
        const candidates = [full];
        if (options.includeContent && hydrated)
            candidates.push(omitted(current, false, true));
        if (index === 0)
            candidates.push(omitted(current, true, hydrated));
        const selected = candidates.find(fits);
        if (!selected) {
            if (delivered.length)
                break;
            // The nextAction budget itself grows in the retry. Measure its longest
            // allowed numeral, so the suggested budget fits in one retry.
            const required = JSON.stringify(envelope([omitted(current, true, hydrated, 12000)], index)).length;
            return { isError: true, text: JSON.stringify({
                    error: 'query_response_budget_too_small',
                    hint: required <= 20000 ? 'Repeat the same query with retryArguments merged; no rows were delivered.' : 'Exact row/cursor cannot fit. Narrow filters or use a bounded sort property; no rows were delivered.',
                    ...(required <= 20000 && { retryArguments: { maxChars: Math.min(20000, Math.max(maxChars + 512, required)) } }),
                }) };
        }
        delivered.push(selected);
        value = envelope(delivered, index);
    }
    if (page.notes.length === 0)
        value = { ...value, truncated: false };
    if (options.prettyPrint) {
        const pretty = JSON.stringify(value, null, 2);
        if (pretty.length <= maxChars)
            return { text: pretty };
    }
    return { text: JSON.stringify(value) };
}
