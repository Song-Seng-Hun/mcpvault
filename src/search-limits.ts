export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 20;
export const DEFAULT_SEARCH_MAX_CHARS = 4000;
export const MAX_SEARCH_MAX_CHARS = 12000;

export function normalizeSearchLimit(value: unknown, defaultValue = DEFAULT_SEARCH_LIMIT): number {
  const parsed = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer');
  return Math.min(parsed, MAX_SEARCH_LIMIT);
}

export function normalizeSearchMaxChars(value: unknown, defaultValue = DEFAULT_SEARCH_MAX_CHARS): number {
  const parsed = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(parsed) || parsed < 512) throw new Error('maxChars must be an integer of at least 512');
  return Math.min(parsed, MAX_SEARCH_MAX_CHARS);
}

function serializedArrayItemLength<T>(item: T): number {
  // Wrapping the item preserves JSON.stringify's array semantics for values
  // such as undefined, while avoiding serialization of the accumulated array.
  return JSON.stringify([item])!.length - 2;
}

/** Keep the compact JSON payload within the requested context budget. */
export function boundSearchResults<T>(results: T[], maxChars: number): T[] {
  const bounded: T[] = [];
  let serializedLength = 2; // []
  for (const result of results) {
    const candidateLength = serializedLength + (bounded.length > 0 ? 1 : 0) + serializedArrayItemLength(result);
    if (bounded.length > 0 && candidateLength > maxChars) break;
    bounded.push(result);
    serializedLength = candidateLength;
    if (serializedLength >= maxChars) break;
  }
  return bounded;
}

/** Bound metadata/list responses without cutting JSON in the middle. */
export function boundItems<T>(items: T[], maxChars: number): { items: T[]; truncated: boolean } {
  const bounded: T[] = [];
  let serializedLength = 2; // []
  for (const item of items) {
    const candidateLength = serializedLength + (bounded.length > 0 ? 1 : 0) + serializedArrayItemLength(item);
    if (bounded.length > 0 && candidateLength > maxChars) {
      return { items: bounded, truncated: true };
    }
    bounded.push(item);
    serializedLength = candidateLength;
    if (serializedLength >= maxChars) {
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
export function boundedTopK<T>(items: Iterable<T>, limit: number, compare: (a: T, b: T) => number): T[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
  const heap: T[] = [];
  const worseThan = (a: T, b: T) => compare(a, b) > 0;
  const swap = (a: number, b: number) => {
    const value = heap[a]!;
    heap[a] = heap[b]!;
    heap[b] = value;
  };
  const moveUp = (index: number) => {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (!worseThan(heap[child]!, heap[parent]!)) break;
      swap(child, parent);
      child = parent;
    }
  };
  const moveDown = (index: number) => {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let worst = parent;
      if (left < heap.length && worseThan(heap[left]!, heap[worst]!)) worst = left;
      if (right < heap.length && worseThan(heap[right]!, heap[worst]!)) worst = right;
      if (worst === parent) break;
      swap(parent, worst);
      parent = worst;
    }
  };
  for (const item of items) {
    if (heap.length < limit) {
      heap.push(item);
      moveUp(heap.length - 1);
    } else if (compare(item, heap[0]!) < 0) {
      heap[0] = item;
      moveDown(0);
    }
  }
  return heap.sort(compare);
}
