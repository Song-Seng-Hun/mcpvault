type NavigationKey = 'backlinks' | 'outlinks' | 'unresolved' | 'orphans';
type NavigationPage = { offset: number; limit: number; maxChars: number };

export const NAVIGATION_READ_GUIDANCE = ' Paths and locators remain exact; only context/title previews may shrink (fieldsTruncated). Follow nextAction with expectedSnapshot; changed views reject continuation: restart at offset 0 without that field. reuseOriginalArguments means merge its overrides into this request, keeping authentication local. Fingerprints guard observed results, not atomic Vault snapshots; legacy unguarded offsets remain advisory. paginationLimited marks the offset ceiling; verify source revisions before editing.';

/** Exact locators are never prose. Budget the final public JSON before return. */
export function packNavigationPage(key: NavigationKey, endpointId: string, result: Record<string, any>,
  page: NavigationPage, args: Record<string, any>, toPublicPath: (path: string) => string = path => path): string {
  const rows: Array<Record<string, any>> = (Array.isArray(result[key]) ? result[key] : []).map((item: Record<string, any>) => ({
    ...item, ...(typeof item.path === 'string' && { path: toPublicPath(item.path) }),
  }));
  const metadata: Record<string, any> = Object.fromEntries(Object.entries(result).filter(([name]) => name !== key && name !== 'truncated'));
  for (const name of ['source', 'target']) if (typeof metadata[name] === 'string') metadata[name] = toPublicPath(metadata[name]);
  const path = key === 'backlinks' ? metadata.target : key === 'outlinks' ? metadata.source : undefined;
  if (args.expectedSnapshot !== undefined) {
    if (typeof args.expectedSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSnapshot)) {
      throw new Error('expectedSnapshot must be a lowercase SHA-256 fingerprint');
    }
    if (args.expectedSnapshot !== result.snapshotFingerprint) {
      throw new Error('Navigation view changed; restart at offset 0 without expectedSnapshot. No continuation items returned.');
    }
  }
  const total = Number(result.total || 0);
  const indent = args.prettyPrint ? 2 : undefined;
  for (const previewChars of [240, 80, 0]) {
    const items = rows.map(row => {
      const item = { ...row };
      for (const name of ['context', 'title']) {
        if (typeof item[name] !== 'string') continue;
        const original = item[name];
        item[name] = Array.from(original.slice(0, previewChars * 2)).slice(0, previewChars).join('');
        if (item[name].length < original.length) item.fieldsTruncated = true;
      }
      return item;
    });
    const serialize = (count: number) => {
      const nextOffset = page.offset + count;
      const truncated = total > nextOffset;
      const value: Record<string, unknown> = {
        ...metadata, ...((truncated || page.offset > 0) && { offset: page.offset, returned: count }),
        [key]: items.slice(0, count), truncated,
      };
      if (truncated) {
        value.remaining = Math.max(0, total - nextOffset);
        if (nextOffset > 100000) {
          value.paginationLimited = true;
          value.message = 'Navigation offset limit reached; inspect source notes directly for further links.';
        } else value.nextAction = { endpointId, arguments: {
          ...(typeof path === 'string' && { path }), offset: nextOffset, limit: page.limit,
          maxChars: page.maxChars, ...(args.prettyPrint && { prettyPrint: true }),
          ...(typeof result.snapshotFingerprint === 'string' && { expectedSnapshot: result.snapshotFingerprint }),
        } };
      }
      return JSON.stringify(value, null, indent);
    };
    // Final-page metadata is smaller, so test the full page separately.
    const full = serialize(items.length);
    if (full.length <= page.maxChars && (items.length > 0 || page.offset >= total)) return full;
    // At the offset ceiling, the repeated target in nextAction disappears.
    // Search each monotonic region separately, preferring the larger prefix.
    const boundary = Math.max(0, 100000 - page.offset);
    for (const [start, end] of [[boundary + 1, items.length - 1], [1, Math.min(boundary, items.length - 1)]]) {
      let low = start!; let high = end!; let best: string | undefined;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const text = serialize(middle);
        if (text.length <= page.maxChars) { best = text; low = middle + 1; }
        else high = middle - 1;
      }
      if (best) return best;
    }
  }
  if (page.maxChars === 12000 && page.limit === 1 && !args.prettyPrint) {
    throw new Error('Exact navigation locators cannot fit the maximum response budget. No navigation item was skipped; inspect the source note directly.');
  }
  return JSON.stringify({ [key]: [], offset: page.offset, returned: 0, truncated: true,
    message: 'No navigation item skipped; retry this position with a larger compact budget.',
    nextAction: { endpointId, reuseOriginalArguments: true, overrides: { maxChars: 12000, limit: 1, prettyPrint: false } },
  }, null, indent);
}
