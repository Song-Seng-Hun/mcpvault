import { extractObsidianLinkOccurrences } from './backlinks.js';
import type { OutlinkMatch } from './types.js';

type SourceEntry = { path: string; links: readonly OutlinkMatch[] };
type Preview = { text: string; ownLinkFallback?: boolean };
const CACHE_ENTRIES = 256;
const CACHE_CHARS = 64 * 1024;

/** One resolver/permission view only. Neither shared graph entries nor caller data are mutated. */
export function createGraphLinkProjector(invisible: (target: string, source: string) => boolean) {
  const byEntry = new WeakMap<SourceEntry, { id: number; hiddenLines: Map<number, OutlinkMatch[]> }>();
  const cache = new Map<string, { preview: Preview; weight: number }>();
  let nextId = 0;
  let retainedChars = 0;
  const memo = (key: string, compute: () => Preview): Preview => {
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit.preview; }
    const preview = compute();
    const weight = key.length + preview.text.length;
    if (weight > CACHE_CHARS) return preview;
    while (cache.size >= CACHE_ENTRIES || retainedChars + weight > CACHE_CHARS) {
      const oldest = cache.keys().next().value!;
      retainedChars -= cache.get(oldest)!.weight;
      cache.delete(oldest);
    }
    cache.set(key, { preview, weight }); retainedChars += weight;
    return preview;
  };

  return <T extends { context: string; link: string; line: number; heading?: string }>(entry: SourceEntry, link: T): T => {
    let state = byEntry.get(entry);
    if (!state) {
      const hiddenLines = new Map<number, OutlinkMatch[]>();
      for (const other of entry.links) {
        if (!invisible(other.target, entry.path)) continue;
        const line = hiddenLines.get(other.line) || [];
        line.push(other); hiddenLines.set(other.line, line);
      }
      state = { id: nextId++, hiddenLines }; byEntry.set(entry, state);
    }
    const hidden = state.hiddenLines.get(link.line);
    const context = hidden ? memo(`${state.id}\0context\0${link.line}\0${link.context}`, () => {
      let text = link.context;
      for (const other of hidden) {
        if (text.includes(other.link)) text = text.split(other.link).join('[unavailable link]');
        else if (!link.context.includes(other.link) && link.context === other.context) {
          // A clipped private reference requires an own-link template, not reuse
          // of the first caller's completed fallback string.
          return { text: '', ownLinkFallback: true };
        }
      }
      return { text };
    }) : { text: link.context };
    const heading = link.heading ? memo(`${state.id}\0heading\0${link.heading}`, () => {
      let text = link.heading!;
      for (const occurrence of extractObsidianLinkOccurrences(text)) {
        if (invisible(occurrence.target, entry.path)) text = text.split(occurrence.link).join('[unavailable link]');
      }
      return { text };
    }).text : link.heading;
    return { ...link, context: context.ownLinkFallback ? `[context omitted] ${link.link}` : context.text,
      ...(heading !== undefined && { heading }) };
  };
}
