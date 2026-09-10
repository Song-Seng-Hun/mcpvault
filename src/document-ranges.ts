import { guidanceError } from './guidance-runtime.js';
import type { DocumentStructure, DocumentFragment } from './document-structure.js';
export interface DocumentRangeRequest {
  fragmentId?: string; relation?: 'self' | 'previous' | 'next' | 'parent'; edge?: 'head' | 'tail'; lineCount?: number;
  startLine?: number; endLine?: number; startOffset?: number; endOffset?: number; mode?: 'semantic' | 'exact';
}
export interface DocumentRange { startOffset: number; endOffset: number; role: 'requested' | 'heading' | 'table_header' | 'list_context' | 'prerequisite'; fragmentId?: string }
export interface DocumentRangeSelection { ranges: DocumentRange[]; fragment?: DocumentFragment; totalLines: number }
export function documentLineStarts(raw: string): number[] {
  const starts = [0];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\r') { if (raw[i + 1] === '\n') i++; starts.push(i + 1); }
    else if (raw[i] === '\n') starts.push(i + 1);
  }
  return starts;
}
export function documentLineAt(starts: number[], offset: number): number {
  let low = 0, high = starts.length;
  while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (starts[middle]! <= offset) low = middle; else high = middle; }
  return low + 1;
}
function lineEnd(raw: string, starts: number[], line: number): number {
  let end = starts[line] ?? raw.length;
  while (end > starts[line - 1]! && /[\r\n]/.test(raw[end - 1]!)) end--;
  return end;
}
const validInteger = (value: unknown, low: number, high: number) => Number.isSafeInteger(value) && Number(value) >= low && Number(value) <= high;
function unicodeBoundary(raw: string, offset: number): boolean {
  return !(offset > 0 && offset < raw.length && /[\uD800-\uDBFF]/.test(raw[offset - 1]!) && /[\uDC00-\uDFFF]/.test(raw[offset]!));
}

/** Structural context only, not an assertion that a model understood all qualifiers. */
export function selectDocumentRanges(doc: DocumentStructure, request: DocumentRangeRequest): DocumentRangeSelection {
  const starts = documentLineStarts(doc.raw), totalLines = starts.length;
  const mode = request.mode ?? 'semantic', relation = request.relation ?? 'self';
  if (!['semantic', 'exact'].includes(mode) || !['self', 'previous', 'next', 'parent'].includes(relation)
    || (request.edge !== undefined && !['head', 'tail'].includes(request.edge))) throw guidanceError(new Error('Invalid document range mode or relation'), 'guid-69eeb1066a43b102');
  if (request.lineCount !== undefined && !validInteger(request.lineCount, 1, 1000)) throw guidanceError(new Error('lineCount must be 1..1000'), 'guid-11817392abd86c2b');
  const hasLines = request.startLine !== undefined || request.endLine !== undefined;
  const hasOffsets = request.startOffset !== undefined || request.endOffset !== undefined;
  if (hasLines && hasOffsets) throw guidanceError(new Error('Use lines or offsets, not both'), 'guid-72e11f6f6df3addd');
  if ((hasLines || hasOffsets) && relation !== 'self') throw guidanceError(new Error('Neighbor reads use lineCount, not absolute ranges'), 'guid-149d3433c2c003fb');
  const byId = new Map(doc.fragments.map(f => [f.id, f]));
  let fragment = request.fragmentId === undefined ? undefined : byId.get(request.fragmentId);
  if (request.fragmentId !== undefined && !fragment) throw guidanceError(new Error('Stale or unavailable document fragment; reread outline'), 'guid-ecd3d2156880361a');
  if (relation !== 'self') {
    if (!fragment) throw guidanceError(new Error('A current fragment is required for neighbor reading'), 'guid-afa5c582f7abea57');
    const target = fragment[relation];
    fragment = target ? byId.get(target) : undefined;
    if (!fragment) throw guidanceError(new Error(`Document ${relation} neighbor unavailable`), 'guid-7b786ef02448eb8c');
  }
  if (!fragment && !hasLines && !hasOffsets) fragment = doc.fragments.find(f => !f.children.length && !['root', 'frontmatter', 'section'].includes(f.kind)) ?? doc.fragments[0];
  let startOffset = fragment?.startOffset ?? 0, endOffset = fragment?.endOffset ?? doc.raw.length;
  if (hasLines) {
    const startLine = request.startLine ?? request.endLine!, endLine = request.endLine ?? startLine;
    if (!validInteger(startLine, 1, totalLines) || !validInteger(endLine, startLine, totalLines)) throw guidanceError(new Error('Invalid document line range'), 'guid-20d1a3d896de6ed5');
    startOffset = starts[startLine - 1]!; endOffset = lineEnd(doc.raw, starts, endLine);
  } else if (hasOffsets) {
    startOffset = request.startOffset ?? 0; endOffset = request.endOffset ?? doc.raw.length;
    if (!validInteger(startOffset, 0, doc.raw.length) || !validInteger(endOffset, startOffset, doc.raw.length)
      || !unicodeBoundary(doc.raw, startOffset) || !unicodeBoundary(doc.raw, endOffset)) throw guidanceError(new Error('Invalid document UTF-16 offset range'), 'guid-845d6969ab706ac8');
  }
  if (fragment && (startOffset < fragment.startOffset || endOffset > fragment.endOffset)) throw guidanceError(new Error('Requested range is outside the selected fragment'), 'guid-c795b680dbeb02fd');
  if (request.lineCount !== undefined) {
    const first = documentLineAt(starts, startOffset), last = documentLineAt(starts, Math.max(startOffset, endOffset - 1));
    if ((request.edge ?? (relation === 'previous' ? 'tail' : 'head')) === 'tail') startOffset = Math.max(startOffset, starts[Math.max(first, last - request.lineCount + 1) - 1]!);
    else {
      const lastLine = Math.min(last, first + request.lineCount - 1);
      // Explicit offsets may intentionally select only CR/LF. Preserve that
      // intersection instead of trimming backwards into the previous text.
      endOffset = Math.min(endOffset, hasOffsets ? (starts[lastLine] ?? doc.raw.length) : lineEnd(doc.raw, starts, lastLine));
    }
  }
  if (startOffset > endOffset) throw guidanceError(new Error('Invalid final document range'), 'guid-4232ba617b00c527');
  if (!fragment) fragment = doc.fragments.filter(f => !f.children.length && f.kind !== 'root'
    && f.startOffset < Math.max(endOffset, startOffset + 1) && f.endOffset > startOffset)
    .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset)[0];
  if (request.lineCount === undefined && mode === 'semantic' && !hasOffsets && fragment && ['paragraph', 'tableRow', 'tableHeader', 'heading'].includes(fragment.kind)) {
    startOffset = Math.min(startOffset, fragment.startOffset); endOffset = Math.max(endOffset, fragment.endOffset);
  }
  const ranges: DocumentRange[] = [{ startOffset, endOffset, role: 'requested', ...(fragment && { fragmentId: fragment.id }) }];
  const add = (start: number, end: number, role: DocumentRange['role'], id?: string) => {
    if (start < 0 || end > doc.raw.length || start >= end || (start >= startOffset && end <= endOffset)) return;
    if (!ranges.some(r => r.startOffset === start && r.endOffset === end)) ranges.push({ startOffset: start, endOffset: end, role, ...(id && { fragmentId: id }) });
  };
  if (mode === 'semantic' && fragment) {
    const visited = new Set<string>(); let ancestor: DocumentFragment | undefined = fragment;
    while (ancestor) {
      if (visited.has(ancestor.id) || visited.size > 128) throw guidanceError(new Error('Invalid or excessive document parent graph'), 'guid-f5bc80be10ab15d1');
      visited.add(ancestor.id);
      if (ancestor.kind === 'section') {
        const heading = ancestor.children.map(id => byId.get(id)).find(f => f?.kind === 'heading');
        if (heading) add(heading.startOffset, heading.endOffset, 'heading', heading.id);
      } else if (ancestor.kind === 'table') {
        const header = ancestor.children.map(id => byId.get(id)).find(f => f?.kind === 'tableHeader');
        if (header) add(header.startOffset, Math.min(ancestor.endOffset, lineEnd(doc.raw, starts, Math.min(totalLines, header.endLine + 1))), 'table_header', header.id);
      } else if (['listItem', 'callout', 'blockquote'].includes(ancestor.kind)) {
        const lead = ancestor.children.map(id => byId.get(id)).find(f => f?.kind === 'paragraph');
        if (lead && (lead.endOffset <= startOffset || lead.startOffset >= endOffset)) add(ancestor.startOffset, lead.endOffset, 'list_context', lead.id);
      }
      ancestor = ancestor.parent ? byId.get(ancestor.parent) : undefined;
    }
    const previous = fragment.previous ? byId.get(fragment.previous) : undefined;
    if (previous?.kind === 'paragraph' && /(?:\b(?:if|unless|except|only|prerequisite|condition)\b|전제|조건|경우|다만|단,)/i.test(doc.raw.slice(previous.startOffset, Math.min(previous.endOffset, previous.startOffset + 256)))) {
      add(previous.startOffset, previous.endOffset, 'prerequisite', previous.id);
    }
  }
  return { ranges: ranges.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset), ...(fragment && { fragment }), totalLines };
}
