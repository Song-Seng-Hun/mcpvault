/** A narrow projection contract; no child-view metadata is spread into output. */
export interface ExceptionBoardItem {
  path: string;
  code: string;
  category: string;
  severity: 'error' | 'warning';
  state: 'open' | 'quarantined';
  revision?: string;
  sourceState: 'snapshot_matched' | 'recheck_required';
  suggestedAction: string;
  detail: string;
  nextAction: { endpointId: string; arguments: Record<string, unknown> };
}

export type ExceptionBoardProjectedItem = Omit<ExceptionBoardItem, 'detail' | 'suggestedAction' | 'state' | 'category'>
  & Partial<Pick<ExceptionBoardItem, 'detail' | 'suggestedAction' | 'state' | 'category'>>;

export type ExceptionBoardResult = {
  counts?: Record<string, number>;
  total: number;
  countScope: 'validated_candidates';
  coverage: 'partial';
  advisory: true;
  truncated: boolean;
  items: ExceptionBoardProjectedItem[];
  note?: string;
} | {
  advisory: true;
  coverage: 'partial';
  truncated: true;
  retry: { endpointId: 'wiki.exception_board'; reuseOriginalArguments: true; overrides: { maxChars: 16000 } };
};

export function packExceptionBoard(candidates: ExceptionBoardItem[], limit: number, maxChars: number, sourceTruncated: boolean): ExceptionBoardResult {
  const unique = new Map<string, ExceptionBoardItem>();
  for (const item of candidates) {
    const key = `${item.path}\u0000${item.code}`;
    const previous = unique.get(key);
    if (!previous || (previous.severity !== 'error' && item.severity === 'error')) unique.set(key, item);
  }
  const ranked = [...unique.values()].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
  const counts: Record<string, number> = {};
  for (const item of ranked) counts[item.category] = (counts[item.category] || 0) + 1;
  const selected = ranked.slice(0, limit);
  const base = { counts, total: ranked.length, countScope: 'validated_candidates' as const, coverage: 'partial' as const, advisory: true as const,
    truncated: sourceTruncated || ranked.length > selected.length };
  const full = { ...base, items: selected,
    note: 'Candidate signals, not an exhaustive healthy/unhealthy verdict. Source revision matches do not verify every dependency. Follow one returned read action before revision-safe repair.' };
  if (JSON.stringify(full).length <= maxChars) return full;
  // Preserve identity, provenance and the exact action. Drop prose before work.
  const items = selected.map(({ detail: _detail, suggestedAction: _suggestion, state: _state, category: _category, ...item }) => item);
  const pack = () => ({ ...base, items, truncated: true });
  while (items.length > 1 && JSON.stringify(pack()).length > maxChars) items.pop();
  if (JSON.stringify(pack()).length <= maxChars) return pack();
  const { counts: _counts, ...smallBase } = base;
  const minimal = { ...smallBase, items, truncated: true };
  if (JSON.stringify(minimal).length <= maxChars) return minimal;
  return { advisory: true, coverage: 'partial', truncated: true,
    retry: { endpointId: 'wiki.exception_board', reuseOriginalArguments: true, overrides: { maxChars: 16000 } } };
}
