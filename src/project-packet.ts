import { guidanceError, guidanceText } from './guidance-runtime.js';
import { createHash } from 'node:crypto';

export interface ProjectPacketOptions { offset?: number; expectedSnapshot?: string; prettyPrint?: boolean }

/** Budget the final public representation; never clip source identities. */
export function packProjectPacket(rows: Array<Record<string, any>>, metadata: Record<string, any>,
  limit: number, maxChars: number, options: ProjectPacketOptions = {}): Record<string, any> {
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw guidanceError(new Error('Project offset must be an integer between 0 and 100000'), 'guid-19aee45b80d27bfe');
  if (options.expectedSnapshot !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedSnapshot)) throw guidanceError(new Error('expectedSnapshot must be a lowercase SHA-256 fingerprint'), 'guid-fdaefa5cd8d6564d');
  if (offset > 0 && !options.expectedSnapshot) throw guidanceError(new Error('Project continuation requires expectedSnapshot; restart at offset 0'), 'guid-0ad9d1c1ace87c3f');
  const hash = createHash('sha256').update('project-packet-v1');
  for (const row of rows) hash.update(JSON.stringify(row));
  const snapshotFingerprint = hash.digest('hex');
  if (options.expectedSnapshot && options.expectedSnapshot !== snapshotFingerprint) throw guidanceError(new Error('Project view changed; restart at offset 0 without expectedSnapshot'), 'guid-536dad7149f471f7');
  const compact = (row: Record<string, any>) => ({
    path: row.path, revision: row.revision, planningNeedsAttention: row.planningNeedsAttention,
    planning: row.planning, execution: { ready: row.execution?.ready }, detailsOmitted: true,
    readAction: { endpointId: 'notes.read', arguments: { path: row.path, expectedRevision: row.revision, maxChars: 8000 } },
  });
  const selected = rows.slice(offset, offset + limit);
  const indent = options.prettyPrint ? 2 : undefined;
  const fits = (value: unknown) => JSON.stringify(value, null, indent).length <= maxChars;
  const makePage = (items: Array<Record<string, any>>) => {
    const nextOffset = offset + items.length, truncated = nextOffset < rows.length;
    return {
      ...metadata, items, total: rows.length, offset, returned: items.length, snapshotFingerprint, truncated,
      ...(truncated && (nextOffset > 100000 ? { paginationLimited: true } : {
        nextAction: { endpointId: 'wiki.project_packet', arguments: {
          offset: nextOffset, limit, maxChars, expectedSnapshot: snapshotFingerprint,
          ...(options.prettyPrint && { prettyPrint: true }),
        } },
      })),
    };
  };
  // Don't repeatedly serialize enormous full rows while choosing a prefix.
  const previews = selected.map(row => fits(row) ? row : compact(row));
  for (const items of [previews, selected.map(compact)]) {
    for (let count = items.length; count > 0; count--) {
      const value = makePage(items.slice(0, count));
      if (fits(value)) return value;
    }
  }
  if (selected.length === 0) {
    const empty = makePage([]);
    if (fits(empty)) return empty;
    return { items: [], total: rows.length, offset, returned: 0, snapshotFingerprint, truncated: false };
  }
  // Same position, original identity and authentication retained by the host.
  if (maxChars < 16000 || options.prettyPrint) {
    return { items: [], total: rows.length, offset, returned: 0, truncated: true,
      message: guidanceText('guid-b72a049869c3bf36', 'No project fits this budget; retry this position. No items skipped.'),
      nextAction: { endpointId: 'wiki.project_packet', reuseOriginalArguments: true,
        overrides: { maxChars: 16000, limit: 1, prettyPrint: false } } };
  }
  throw guidanceError(new Error('Project identity exceeds the response ceiling; no items skipped. Inspect project paths directly.'), 'guid-c970a445e371baa9');
}
