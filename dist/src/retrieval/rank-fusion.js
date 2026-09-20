/** Discovery rank only; no truth, authority or independence claim. */
export function reciprocalRanks(channels) {
    const scores = new Map();
    for (const channel of channels) {
        const seen = new Set();
        for (const id of channel.slice(0, 20)) {
            if (seen.has(id))
                continue;
            seen.add(id);
            scores.set(id, (scores.get(id) || 0) + 1 / (60 + seen.size));
        }
    }
    return scores;
}
