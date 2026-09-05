import { createHash } from 'node:crypto';
import { normalizeSearchMaxChars } from './search-limits.js';
/** Input is the graph's count-descending, ordinal-tag, caller-visible view. */
export function packTagPage(tags, args) {
    const requestedLimit = args.limit === undefined ? 50 : Number(args.limit);
    const offset = args.offset === undefined ? 0 : Number(args.offset);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)
        throw new Error('limit must be a positive safe integer');
    if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error('offset must be a non-negative safe integer');
    if (args.prefix !== undefined && typeof args.prefix !== 'string')
        throw new Error('prefix must be a string');
    if (args.expectedSnapshot !== undefined && (typeof args.expectedSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSnapshot))) {
        throw new Error('expectedSnapshot must be a lowercase SHA-256 fingerprint');
    }
    if (offset > 0 && !args.expectedSnapshot)
        throw new Error('Positive offset requires expectedSnapshot; start at offset 0');
    const limit = Math.min(requestedLimit, 200);
    const maxChars = normalizeSearchMaxChars(args.maxChars);
    const prefix = (args.prefix ?? '').trim().replace(/^#/, '').toLowerCase();
    const indent = args.prettyPrint ? 2 : undefined;
    const hash = createHash('sha256').update(JSON.stringify(['tag-page-v1', prefix]));
    const selected = [];
    let total = 0;
    for (const tag of tags) {
        if (!tag.tag.startsWith(prefix))
            continue;
        hash.update(JSON.stringify([tag.tag, tag.count]));
        if (total >= offset && selected.length < limit)
            selected.push(tag);
        total++;
    }
    const snapshotFingerprint = hash.digest('hex');
    if (args.expectedSnapshot !== undefined && args.expectedSnapshot !== snapshotFingerprint) {
        throw new Error('Tag view changed; restart at offset 0 without expectedSnapshot. No continuation items returned.');
    }
    const encode = (count) => {
        const nextOffset = offset + count;
        const truncated = nextOffset < total;
        return JSON.stringify({
            tags: selected.slice(0, count), total, returned: count, offset, snapshotFingerprint, truncated,
            ...(truncated && { nextAction: { endpointId: 'mcp.list_all_tags', arguments: {
                        ...(prefix && { prefix }), limit, maxChars, ...(args.prettyPrint && { prettyPrint: true }),
                        offset: nextOffset, expectedSnapshot: snapshotFingerprint,
                    } } }),
        }, null, indent);
    };
    // A final page omits the continuation, so check it before monotonic prefixes.
    const full = encode(selected.length);
    if (full.length <= maxChars && (selected.length > 0 || offset >= total))
        return full;
    let low = 1;
    let high = selected.length - 1;
    let best;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = encode(middle);
        if (candidate.length <= maxChars) {
            best = candidate;
            low = middle + 1;
        }
        else
            high = middle - 1;
    }
    if (best)
        return best;
    if (maxChars === 12000 && !args.prettyPrint && limit === 1) {
        throw new Error('An exact tag or its prefix cannot fit the maximum response budget; no tag was skipped. Inspect source Properties or narrow the prefix.');
    }
    // No partial tag identifiers and no silent zero-progress page loop.
    return JSON.stringify({
        tags: [], total, returned: 0, offset, truncated: true,
        message: 'No tag skipped; retry this position with a larger compact budget.',
        nextAction: { endpointId: 'mcp.list_all_tags', reuseOriginalArguments: true,
            overrides: { maxChars: 12000, prettyPrint: false, limit: 1 } },
    }, null, indent);
}
