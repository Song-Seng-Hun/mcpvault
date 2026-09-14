/** Shared query semantics only. This policy grants no access or execution authority. */
export function constrainedQuery(query: string): boolean {
  return /["'\[\]:()]|(?:^|\s)-\S|(?:^|\s)OR(?:\s|$)/i.test(query);
}

export function semanticQueryState(query: string, enabled: unknown, caseSensitive?: boolean): 'disabled' | 'filtered' | 'permitted' {
  if (enabled !== true) return 'disabled';
  return constrainedQuery(query) || caseSensitive ? 'filtered' : 'permitted';
}

export function plainQueryExpansion(query: string): string | undefined {
  if (constrainedQuery(query)) return;
  const terms = [...new Set(query.trim().replace(/[?？]+$/, '').split(/\s+/))];
  if (terms.length < 2 || terms.length > 12 || terms.some(t => !/^[\p{L}\p{N}_]+$/u.test(t))) return;
  return terms.join(' OR ');
}
