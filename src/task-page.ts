import type { ListTasksResult } from './types.js';
import { normalizeSearchMaxChars } from './search-limits.js';

/** Pack exact locators/revisions and continue from emitted items, not scan size. */
export function packTaskPage(result: ListTasksResult, args: Record<string, any>): string {
  const maxChars = normalizeSearchMaxChars(args.maxChars);
  const indent = args.prettyPrint ? 2 : undefined;
  const limit = Math.min(Number(args.limit ?? 100), 500);
  const encode = (count: number, previewChars: number) => {
    const tasks = result.tasks.slice(0, count).map(task => {
      // Bound work too: only inspect a short UTF-16 prefix before code points.
      const text = Array.from(task.text.slice(0, previewChars * 2)).slice(0, previewChars).join('');
      return { ...task, text, ...(text.length < task.text.length && { textTruncated: true }) };
    });
    const nextOffset = result.offset + tasks.length;
    const hasMore = nextOffset < result.total;
    return JSON.stringify({
      tasks, total: result.total, returned: tasks.length, offset: result.offset,
      snapshotFingerprint: result.snapshotFingerprint,
      truncated: hasMore || tasks.some(task => task.textTruncated),
      ...(hasMore && { nextAction: {
        endpointId: 'mcp.list_tasks',
        arguments: {
          status: args.status || 'open',
          ...(typeof args.pathPrefix === 'string' && { pathPrefix: args.pathPrefix }),
          limit, maxChars, ...(args.prettyPrint && { prettyPrint: true }),
          offset: nextOffset, expectedSnapshot: result.snapshotFingerprint,
        },
      } }),
    }, null, indent);
  };
  // Keep useful previews when they fit, then rescue at least one exact locator.
  for (const previewChars of [160, 80, 0]) {
    const count = result.tasks.length;
    const text = encode(count, previewChars);
    if (text.length <= maxChars && (count > 0 || result.offset >= result.total)) return text;
    // The complete page can omit nextAction, so test it separately. Every
    // shorter nonempty prefix has a continuation and monotonic encoded size.
    let low = 1;
    let high = count - 1;
    let best: string | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = encode(middle, previewChars);
      if (candidate.length <= maxChars) { best = candidate; low = middle + 1; }
      else high = middle - 1;
    }
    if (best) return best;
  }
  if (maxChars === 12000 && !args.prettyPrint && limit === 1) {
    throw new Error('A task locator cannot fit the maximum response budget; no task was skipped. Inspect the source note directly.');
  }
  // Do not emit a zero-progress next page. Retry the same position with room
  // for one receipt; reuse original public filters and authorization locally.
  return JSON.stringify({
    tasks: [], total: result.total, returned: 0, offset: result.offset, truncated: true,
    message: 'No task skipped; retry this position with a larger compact budget.',
    nextAction: { endpointId: 'mcp.list_tasks', reuseOriginalArguments: true,
      overrides: { maxChars: 12000, prettyPrint: false, limit: 1 } },
  }, null, indent);
}
