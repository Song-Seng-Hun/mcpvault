function unicodeLength(value) {
    return Array.from(value).length;
}
function takeUnicode(value, maxChars) {
    return Array.from(value).slice(0, maxChars).join('');
}
/**
 * Deterministic client-side context packing. It does not interpret content or
 * grant access; it only chooses which already-authorized fragments fit in a
 * caller-provided character budget.
 */
export class ContextBudgeter {
    pack(fragments, maxChars) {
        if (!Number.isInteger(maxChars) || maxChars < 1)
            throw new Error('maxChars must be a positive integer');
        const ordered = fragments.map((fragment, index) => ({ fragment, index })).sort((left, right) => Number(Boolean(right.fragment.required)) - Number(Boolean(left.fragment.required))
            || (right.fragment.priority ?? 0) - (left.fragment.priority ?? 0)
            || left.index - right.index);
        const packed = [];
        const omittedIds = [];
        const truncatedIds = [];
        let usedChars = 0;
        for (const { fragment } of ordered) {
            const text = String(fragment.text || '');
            const separator = packed.length > 0 ? 2 : 0;
            const available = maxChars - usedChars - separator;
            if (available <= 0 || !text) {
                omittedIds.push(fragment.id);
                continue;
            }
            const fragmentCap = fragment.maxChars === undefined ? available : Math.min(available, Math.max(0, fragment.maxChars));
            const clipped = takeUnicode(text, fragmentCap);
            if (!clipped) {
                omittedIds.push(fragment.id);
                continue;
            }
            const truncated = unicodeLength(clipped) < unicodeLength(text);
            packed.push({ id: fragment.id, text: clipped, truncated });
            if (truncated)
                truncatedIds.push(fragment.id);
            usedChars += separator + unicodeLength(clipped);
        }
        return {
            fragments: packed,
            text: packed.map(fragment => fragment.text).join('\n\n'),
            usedChars,
            omittedIds,
            truncatedIds,
        };
    }
    estimateTokens(text) {
        return Math.ceil(unicodeLength(text) / 4);
    }
}
