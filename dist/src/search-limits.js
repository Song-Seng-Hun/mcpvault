export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 20;
export const DEFAULT_SEARCH_MAX_CHARS = 4000;
export const MAX_SEARCH_MAX_CHARS = 12000;
export function normalizeSearchLimit(value, defaultValue = DEFAULT_SEARCH_LIMIT) {
    const parsed = value === undefined ? defaultValue : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error('limit must be a positive integer');
    return Math.min(parsed, MAX_SEARCH_LIMIT);
}
export function normalizeSearchMaxChars(value, defaultValue = DEFAULT_SEARCH_MAX_CHARS) {
    const parsed = value === undefined ? defaultValue : Number(value);
    if (!Number.isInteger(parsed) || parsed < 512)
        throw new Error('maxChars must be an integer of at least 512');
    return Math.min(parsed, MAX_SEARCH_MAX_CHARS);
}
/** Keep the compact JSON payload within the requested context budget. */
export function boundSearchResults(results, maxChars) {
    const bounded = [];
    for (const result of results) {
        const candidate = [...bounded, result];
        if (bounded.length > 0 && JSON.stringify(candidate).length > maxChars)
            break;
        bounded.push(result);
        if (JSON.stringify(bounded).length >= maxChars)
            break;
    }
    return bounded;
}
/** Bound metadata/list responses without cutting JSON in the middle. */
export function boundItems(items, maxChars) {
    const bounded = [];
    for (const item of items) {
        const candidate = [...bounded, item];
        if (bounded.length > 0 && JSON.stringify(candidate).length > maxChars) {
            return { items: bounded, truncated: true };
        }
        bounded.push(item);
        if (JSON.stringify(bounded).length >= maxChars) {
            return { items: bounded, truncated: bounded.length < items.length };
        }
    }
    return { items: bounded, truncated: false };
}
/**
 * Keep only the best K items while iterating a large result set. `compare`
 * follows Array#sort semantics: negative means the first item is better.
 * The returned items are sorted with the same comparator.
 */
export function boundedTopK(items, limit, compare) {
    if (!Number.isInteger(limit) || limit < 1)
        throw new Error('limit must be a positive integer');
    const heap = [];
    const worseThan = (a, b) => compare(a, b) > 0;
    const swap = (a, b) => {
        const value = heap[a];
        heap[a] = heap[b];
        heap[b] = value;
    };
    const moveUp = (index) => {
        let child = index;
        while (child > 0) {
            const parent = Math.floor((child - 1) / 2);
            if (!worseThan(heap[child], heap[parent]))
                break;
            swap(child, parent);
            child = parent;
        }
    };
    const moveDown = (index) => {
        let parent = index;
        while (true) {
            const left = parent * 2 + 1;
            const right = left + 1;
            let worst = parent;
            if (left < heap.length && worseThan(heap[left], heap[worst]))
                worst = left;
            if (right < heap.length && worseThan(heap[right], heap[worst]))
                worst = right;
            if (worst === parent)
                break;
            swap(parent, worst);
            parent = worst;
        }
    };
    for (const item of items) {
        if (heap.length < limit) {
            heap.push(item);
            moveUp(heap.length - 1);
        }
        else if (compare(item, heap[0]) < 0) {
            heap[0] = item;
            moveDown(0);
        }
    }
    return heap.sort(compare);
}
