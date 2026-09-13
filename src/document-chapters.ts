import { guidanceText } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import type { DocumentStructure } from './document-structure.js';
import { documentLineAt, documentLineStarts } from './document-ranges.js';

export const DOCUMENT_CHAPTER_PROFILE = 'mcpvault-source-chapters-v1';
// Leave room for metadata in future physical files. This view never rewrites sources.
const BODY_LINES = 32;
const BODY_CHARS = 1600;
export interface DocumentChapter {
  id: string;
  kind: 'chapter' | 'source_reference';
  status: 'source_projection';
  identity: 'content' | 'ambiguous';
  title: string;
  description: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  position: number;
  previous?: string;
  next?: string;
  reason?: 'indivisible_source_unit';
}
const hash = (...values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const label = (value: string, max: number) => {
  let end = Math.min(value.length, max);
  if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1] ?? '')) end--;
  return value.slice(0, end);
};

/** Exact, disposable source projection. IDs survive only unambiguous unchanged
 * content at the same path; durable IDs across moves/edits require a bundle ledger.
 * Source descriptions are untrusted discovery data, never rule authority. */
export function documentChapters(doc: DocumentStructure): DocumentChapter[] {
  if (!doc.raw.length) return [];
  const byId = new Map(doc.fragments.map(f => [f.id, f]));
  // Outermost Markdown blocks only: nested lists, quotes, tables and their
  // headings are indivisible. Synthetic section wrappers are not source blocks.
  const units = doc.fragments.filter(f => {
    if (f.kind === 'root' || f.kind === 'section') return false;
    let parent = f.parent ? byId.get(f.parent) : undefined;
    while (parent) {
      if (parent.kind !== 'root' && parent.kind !== 'section') return false;
      parent = parent.parent ? byId.get(parent.parent) : undefined;
    }
    return true;
  }).sort((a, b) => a.startOffset - b.startOffset);
  const starts = documentLineStarts(doc.raw);
  const fits = (start: number, end: number) => end - start <= BODY_CHARS
    && documentLineAt(starts, Math.max(start, end - 1)) - documentLineAt(starts, start) + 1 <= BODY_LINES;
  const spans: { start: number; end: number; title: string; description: string }[] = [];
  let pending: typeof spans[number] | undefined;
  const flush = () => { if (pending) spans.push(pending); pending = undefined; };
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    const start = i === 0 ? 0 : unit.startOffset;
    const end = units[i + 1]?.startOffset ?? doc.raw.length;
    if (pending && (unit.kind === 'heading' || !fits(pending.start, end))) flush();
    pending ??= { start, end, title: unit.headingPath.at(-1) ?? doc.title, description: unit.description };
    pending.end = end;
    if (!fits(start, end)) flush();
  }
  flush();
  if (!spans.length) spans.push({ start: 0, end: doc.raw.length, title: doc.title, description: guidanceText('guid-ed7329a2020f160e', 'Whitespace-only source.') });
  const keys = spans.map(s => hash(DOCUMENT_CHAPTER_PROFILE, doc.path, doc.raw.slice(s.start, s.end)));
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const chapters: DocumentChapter[] = spans.map((span, index) => {
    const key = keys[index]!, ambiguous = counts.get(key)! > 1, bounded = fits(span.start, span.end);
    return { id: ambiguous ? hash(key, doc.revision, span.start) : key,
      identity: ambiguous ? 'ambiguous' : 'content', kind: bounded ? 'chapter' : 'source_reference',
      status: 'source_projection', title: label(span.title, 120), description: label(span.description, 160),
      startOffset: span.start, endOffset: span.end,
      startLine: documentLineAt(starts, span.start), endLine: documentLineAt(starts, Math.max(span.start, span.end - 1)),
      position: index + 1, ...(!bounded && { reason: 'indivisible_source_unit' as const }) };
  });
  for (let i = 0; i < chapters.length; i++) {
    if (i > 0) chapters[i]!.previous = chapters[i - 1]!.id;
    if (i + 1 < chapters.length) chapters[i]!.next = chapters[i + 1]!.id;
  }
  return chapters;
}
