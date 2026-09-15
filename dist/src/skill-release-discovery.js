import { constrainedQuery } from './retrieval/query-policy.js';
const fail = () => { throw Error('Reviewed skill unavailable'); };
export function emptyReviewedProcedureDiscovery() {
    return { kind: 'reviewed_procedures', cards: [], partial: true,
        notice: 'Bounded reviewed procedure discovery, not factual evidence or a complete catalog. Read approval grants no execution. Explicit skill.resolve remains available.' };
}
/** Bounded canary discovery, not a full-library ranker. Only the host can name
 * candidates. The caller supplies the very same verified reader used by resolve.
 * Hidden/revoked/failed/nonmatching candidates produce no titles or counts. */
export async function discoverReviewedProcedures(options, captureDeliveryFence) {
    const max = options.maxChars ?? 4000, limit = options.limit ?? 3;
    if (typeof options.query !== 'string' || !options.query.trim() || options.query.length > 512
        || typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1024 || max > 12000
        || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 3)
        return fail();
    const query = options.query.normalize('NFC').toLowerCase();
    const result = emptyReviewedProcedureDiscovery();
    await options.identity.revalidate();
    options.identity.assertFresh();
    const terms = query.trim().split(/\s+/);
    const selected = [];
    // Unsupported strict expressions never turn into a relaxed metadata query.
    if (!constrainedQuery(query) && terms.length <= 12 && terms.every(t => /^[\p{L}\p{N}_-]+$/u.test(t)) && options.host.candidates) {
        let candidates = [];
        try {
            candidates = await options.host.candidates();
        }
        catch { /* Same non-disclosing bounded response. */ }
        if (!Array.isArray(candidates) || candidates.length > 8 || candidates.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)))
            return fail();
        for (const skillId of new Set(candidates)) {
            options.identity.assertFresh();
            let raw, fence;
            try {
                raw = await options.read(skillId, value => { fence = value; });
            }
            catch {
                continue;
            }
            if (!fence || raw.partial || !raw.card || raw.executionAuthorized !== false || raw.skillId !== skillId)
                continue;
            // Search purpose/functions/aliases only, not restrictions or private evidence.
            const c = raw.card;
            const searchable = [raw.skillId, ...(c.functions ?? []), c.purpose, ...(c.keywords ?? []), ...(c.domains ?? []),
                c.example?.query, c.example?.action, c.example?.expected].filter(v => typeof v === 'string').join('\n').normalize('NFC').toLowerCase();
            if (!terms.every(t => searchable.includes(t)))
                continue;
            const card = { skillId, releaseRevision: raw.releaseRevision, executionAuthorized: false,
                limitations: raw.limitations, useWhen: raw.useWhen, avoidWhen: raw.avoidWhen, card: raw.card, nextAction: raw.nextAction };
            if (JSON.stringify({ ...result, cards: [...result.cards, card] }).length > max)
                continue;
            result.cards.push(card);
            selected.push(fence);
            if (result.cards.length === limit)
                break;
        }
    }
    const fence = {
        revalidate: async () => { for (const f of selected)
            await f.revalidate(); await options.identity.revalidate(); },
        assertFresh: () => { options.identity.assertFresh(); for (const f of selected)
            f.assertFresh(); },
    };
    await fence.revalidate();
    fence.assertFresh();
    captureDeliveryFence?.(fence);
    return result;
}
