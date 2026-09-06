/** Pack a ranked prefix, never substitute a lower-ranked cheap row for its head. */
export function packNextActionPacket(result: Record<string, any> & { items: Array<Record<string, any>>; total: number },
  maxChars: number, prettyPrint = false): Record<string, any> {
  const fits = (value: unknown) => JSON.stringify(value, null, prettyPrint ? 2 : undefined).length <= maxChars;
  if (fits(result)) return result;
  const counters = (value: Record<string, unknown> | undefined) => Object.fromEntries(
    Object.entries(value || {}).filter(([, count]) => typeof count === 'number'));
  const metadata = {
    ...(result.context && { context: result.context }),
    ...(result.selection && { selection: result.selection }),
    ...(result.filterDiagnostics && { filterDiagnostics: result.filterDiagnostics }),
    ...(result.exclusions && { exclusions: counters(result.exclusions) }),
  };
  const packet = (items: Array<Record<string, any>>, extra: Record<string, unknown> = {}) => ({
    ...extra, items, total: result.total, truncated: true, detailsOmitted: true,
  });
  const compact = (row: Record<string, any>) => ({
    path: row.path, ...(row.revision && { revision: row.revision }), action: row.action,
    ...(row.actionTruncated && { actionTruncated: true }),
    readAction: { endpointId: 'notes.read', arguments: { path: row.path, expectedRevision: row.revision, maxChars: 8000 } },
  });
  // Collapse oversized descriptions once, not repeatedly for every prefix.
  const concise = result.items.map(compact);
  const previews = result.items.map((row, i) => fits(row) ? row : concise[i]!);
  for (const extra of [metadata, {}]) {
    for (const rows of [previews, concise]) {
      for (let count = rows.length; count > 0; count--) {
        const value = packet(rows.slice(0, count), extra);
        if (fits(value)) return value;
      }
    }
  }
  if (result.items.length === 0) {
    const empty = packet([], {
      ...(result.filterDiagnostics && { filterDiagnostics: counters(result.filterDiagnostics) }),
      ...(result.exclusions && { exclusions: counters(result.exclusions) }),
    });
    if (fits(empty)) return empty;
  } else {
    // The full action may itself exceed a small budget. Require a source read,
    // rather than offering a silently clipped instruction for execution.
    const first = compact(result.items[0]!);
    const { action: _action, actionTruncated: _preview, ...locator } = first;
    const value = packet([{ ...locator, actionOmitted: true }]);
    if (fits(value)) return value;
  }
  if (maxChars < 16000 || prettyPrint) {
    const retry = packet([], {
      message: 'Retry the same request. No actions skipped.',
      nextAction: { endpointId: 'wiki.next_actions', reuseOriginalArguments: true,
        overrides: { maxChars: 16000, limit: 1, prettyPrint: false } },
    });
    if (fits(retry)) return retry;
  }
  throw new Error('Next-action identity exceeds the response ceiling; no actions skipped. Inspect source paths directly.');
}
