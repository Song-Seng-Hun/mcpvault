/** Exact first limit round-robin entries: at most limit groups * limit rows.
 * Distinct group keys still use O(groups) memory for an observed diversity count. */
export function createRecallCollector<T>(limit: number, compare: (a: T, b: T) => number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
  const groups = new Set<string>(), buckets = new Map<string, T[]>();
  const ordered = () => [...buckets.entries()].sort((a, b) => compare(a[1][0]!, b[1][0]!));
  return {
    add(group: string, row: T) {
      groups.add(group);
      const bucket = buckets.get(group) || [];
      bucket.push(row); bucket.sort(compare); if (bucket.length > limit) bucket.pop();
      buckets.set(group, bucket);
      if (buckets.size > limit) buckets.delete(ordered().at(-1)![0]);
    },
    get retainedCount() { return [...buckets.values()].reduce((total, bucket) => total + bucket.length, 0); },
    get groupCount() { return groups.size; },
    values() {
      const selected = ordered().map(([, bucket]) => bucket), result: T[] = [];
      for (let i = 0; i < limit && result.length < limit; i++) {
        for (const bucket of selected) { if (bucket[i]) result.push(bucket[i]!); if (result.length === limit) break; }
      }
      return result;
    },
  };
}

/** Never turn a compacted active-recall task into a silently shortened question. */
export function packRecallQueue(candidates: Array<Record<string, any>>, total: number, groups: number, maxChars: number, pretty: boolean): Record<string, any> & { items: Array<Record<string, any>>; total: number; truncated: boolean } {
  const fits = (value: unknown) => JSON.stringify(value, null, pretty ? 2 : undefined).length <= maxChars;
  const metadata = { purpose: 'Attempt recallPrompt before reading the answer. Follow dateRepairAction first for invalid metadata. Advisory reader state, not evidence or truth.',
    diversity: { groups, strategy: 'priority_with_neighborhood_interleaving' }, generatedAt: new Date().toISOString() };
  const items: Array<Record<string, any>> = [];
  for (const item of candidates) {
    if (!fits({ ...metadata, items: [...items, item], total, truncated: total > items.length + 1 })) break;
    items.push(item);
  }
  if (items.length || !total) {
    const report = { ...metadata, items, total, truncated: total > items.length };
    return fits(report) ? report : { items, total, truncated: total > items.length, metadataTruncated: true };
  }
  const first = candidates[0];
  if (first) {
    const { path, revision, recallPrompt, reason, dateRepairAction, promptOmitted, nextAction,
      stateRevision, repairStatus, confusion, repairPath, repairRevision, repairState, suggestedAction } = first;
    const repairNeeded = repairStatus === 'needed' || repairStatus === 'in_progress';
    const compact = { items: [{ path, revision, recallPrompt, reason, dateRepairAction, stateRevision,
      ...(repairNeeded && { repairStatus, confusion, repairPath, repairRevision, repairState, suggestedAction }),
      ...(promptOmitted && { promptOmitted, nextAction }), detailsOmitted: true }], total, truncated: true,
      instruction: dateRepairAction ? 'Repair metadata first; this is not a recall attempt.' : repairNeeded ? 'Preserve the pending repair workflow; omitted details do not resolve it.' : 'Attempt the exact prompt before reading the answer; details are omitted.' };
    if (fits(compact)) return compact;
  }
  if (maxChars < 12000) return { items: [], total, truncated: true,
    retry: { endpointId: 'wiki.recall_queue', reuseOriginalArguments: true, overrides: { maxChars: 12000 } },
    instruction: 'Retry with the larger budget; preserve identity, limit and all other arguments.' };
  const nextAction = first?.dateRepairAction || (first?.promptOmitted ? first.nextAction : undefined);
  const fallback = { items: [], total, truncated: true, ...(nextAction ? { nextAction } : { taskUnavailable: true }),
    instruction: nextAction ? 'Exact task cannot fit. Follow the metadata repair or prompt-only nextAction; do not repeat this queue request unchanged.' : 'The exact task cannot fit. Inspect recall Properties locally or narrow the authored question; do not repeat unchanged.' };
  return fits(fallback) ? fallback : { items: [], total, truncated: true, taskUnavailable: true,
    instruction: 'The exact task cannot fit the maximum budget. Inspect recall Properties locally or narrow the authored question; do not repeat unchanged.' };
}
