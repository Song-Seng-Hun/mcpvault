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

/** Keep the compact JSON payload within the requested context budget. */
export function boundSearchResults<T>(results: T[], maxChars: number): T[] {
  const bounded: T[] = [];
  for (const result of results) {
    const candidate = [...bounded, result];
    if (bounded.length > 0 && JSON.stringify(candidate).length > maxChars) break;
    bounded.push(result);
    if (JSON.stringify(bounded).length >= maxChars) break;
  }
  return bounded;
}
