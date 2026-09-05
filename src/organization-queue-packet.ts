type Row = Record<string, any>;
export type OrganizationQueuePacket = Row & { items: Row[]; total: number; truncated: boolean };

/** Final wire projection over an already ranked, visibility-filtered queue. */
export function packOrganizationQueue(result: OrganizationQueuePacket, endpointId: string,
  maxChars: number, ceiling: number, prettyPrint = false): OrganizationQueuePacket {
  const fits = (value: unknown) => JSON.stringify(value, null, prettyPrint ? 2 : undefined).length <= maxChars;
  if (fits(result)) return result;
  const { items: source, ...metadata } = result;
  const locator = (row: Row): Row => ({ path: row.path, ...(row.revision && { revision: row.revision }),
    readAction: { endpointId: 'notes.read', arguments: { path: row.path, maxChars: 8000 } } });
  const compact = (row: Row): Row => ({ ...locator(row),
    ...Object.fromEntries(['noteKind', 'lifecycle', 'ageDays', 'agingBand', 'suggestedAction', 'suggested',
      'reviewScore', 'reviewReasons', 'overdue', 'retentionDue', 'legalHold'].filter(key => row[key] !== undefined).map(key => [key, row[key]])),
    detailsOmitted: true });
  const concise = source.map(compact);
  const previews = source.map((row, i) => fits(row) ? row : concise[i]!);
  const packet = (items: Row[], extra: Row = {}): OrganizationQueuePacket => ({ ...extra,
    items, total: result.total, truncated: true, detailsOmitted: true });
  for (const extra of [metadata, {}]) {
    for (const rows of [previews, concise]) {
      for (let count = rows.length; count > 0; count--) {
        const value = packet(rows.slice(0, count), extra);
        if (fits(value)) return value;
      }
    }
  }
  if (source.length === 0 && result.total === 0) return packet([]);
  if (source.length > 0) {
    const value = packet([locator(source[0]!)]);
    if (fits(value)) return value;
  }
  if (maxChars < ceiling || prettyPrint) {
    const retry = packet([], { message: 'Retry the same queue. No items skipped.',
      nextAction: { endpointId, reuseOriginalArguments: true,
        overrides: { maxChars: ceiling, limit: 1, prettyPrint: false } } });
    if (fits(retry)) return retry;
  }
  throw new Error('Queue identity exceeds the response ceiling; no items skipped. Inspect source paths directly.');
}
