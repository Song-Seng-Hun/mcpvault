import { createHash } from 'node:crypto';
/** Budget the final public representation; never clip source identities. */
export function packProjectPacket(rows, metadata, limit, maxChars, options = {}) {
    const offset = options.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
        throw new Error('Project offset must be an integer between 0 and 100000');
    if (options.expectedSnapshot !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedSnapshot))
        throw new Error('expectedSnapshot must be a lowercase SHA-256 fingerprint');
    if (offset > 0 && !options.expectedSnapshot)
        throw new Error('Project continuation requires expectedSnapshot; restart at offset 0');
    const hash = createHash('sha256').update('project-packet-v1');
    for (const row of rows)
        hash.update(JSON.stringify(row));
    const snapshotFingerprint = hash.digest('hex');
    if (options.expectedSnapshot && options.expectedSnapshot !== snapshotFingerprint)
        throw new Error('Project view changed; restart at offset 0 without expectedSnapshot');
    const compact = (row) => ({
        path: row.path, revision: row.revision, planningNeedsAttention: row.planningNeedsAttention,
        planning: row.planning, execution: { ready: row.execution?.ready }, detailsOmitted: true,
        readAction: { endpointId: 'notes.read', arguments: { path: row.path, expectedRevision: row.revision, maxChars: 8000 } },
    });
    const selected = rows.slice(offset, offset + limit);
    const indent = options.prettyPrint ? 2 : undefined;
    const fits = (value) => JSON.stringify(value, null, indent).length <= maxChars;
    const makePage = (items) => {
        const nextOffset = offset + items.length, truncated = nextOffset < rows.length;
        return {
            ...metadata, items, total: rows.length, offset, returned: items.length, snapshotFingerprint, truncated,
            ...(truncated && (nextOffset > 100000 ? { paginationLimited: true } : {
                nextAction: { endpointId: 'wiki.project_packet', arguments: {
                        offset: nextOffset, limit, maxChars, expectedSnapshot: snapshotFingerprint,
                        ...(options.prettyPrint && { prettyPrint: true }),
                    } },
            })),
        };
    };
    // Don't repeatedly serialize enormous full rows while choosing a prefix.
    const previews = selected.map(row => fits(row) ? row : compact(row));
    for (const items of [previews, selected.map(compact)]) {
        for (let count = items.length; count > 0; count--) {
            const value = makePage(items.slice(0, count));
            if (fits(value))
                return value;
        }
    }
    if (selected.length === 0) {
        const empty = makePage([]);
        if (fits(empty))
            return empty;
        return { items: [], total: rows.length, offset, returned: 0, snapshotFingerprint, truncated: false };
    }
    // Same position, original identity and authentication retained by the host.
    if (maxChars < 16000 || options.prettyPrint) {
        return { items: [], total: rows.length, offset, returned: 0, truncated: true,
            message: 'No project fits this budget; retry this position. No items skipped.',
            nextAction: { endpointId: 'wiki.project_packet', reuseOriginalArguments: true,
                overrides: { maxChars: 16000, limit: 1, prettyPrint: false } } };
    }
    throw new Error('Project identity exceeds the response ceiling; no items skipped. Inspect project paths directly.');
}
