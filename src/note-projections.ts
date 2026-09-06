import type { NoteHeading, ReadNoteLinesParams } from './types.js';

function stripAtxClosingSequence(text: string): string {
  const withPrecedingSpace = /^(.*[ \t])#+$/.exec(text);
  if (withPrecedingSpace) return withPrecedingSpace[1]!.replace(/[ \t]+$/, '');
  if (/^#+$/.test(text)) return '';
  return text;
}

/** Physical body lines outside Properties and matching fenced examples. */
function* visibleNoteLines(raw: string): Generator<{ text: string; line: number }, boolean> {
  const lines = raw.split('\n');
  let inFrontmatter = false;
  let frontmatterEnded = false;
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;
  const fenceRegex = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.replace(/\r$/, '');
    if (!frontmatterEnded && i === 0 && trimmed === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (trimmed === '---') { inFrontmatter = false; frontmatterEnded = true; }
      continue;
    }
    frontmatterEnded = true;
    const fenceMatch = fenceRegex.exec(trimmed);
    if (fenceMatch) {
      const markers = fenceMatch[1]!;
      const trailing = fenceMatch[2]!;
      const char = markers.charAt(0);
      if (!inFence) { inFence = true; fenceChar = char; fenceLength = markers.length; }
      else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') {
        inFence = false; fenceChar = ''; fenceLength = 0;
      }
      // Mismatched, too-short or annotated closers remain fenced content.
      continue;
    }
    if (inFence) continue;
    yield { text: trimmed, line: i + 1 };
  }
  return inFence;
}

/** Same matching-fence state used by physical outlines and paragraph reads. */
export function hasUnclosedNoteFence(raw: string): boolean {
  const lines = visibleNoteLines(raw);
  let next = lines.next();
  while (!next.done) next = lines.next();
  return next.value;
}

function* noteHeadings(raw: string): Generator<NoteHeading> {
  const headingRegex = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
  for (const { text, line } of visibleNoteLines(raw)) {
    const match = headingRegex.exec(text);
    if (match) yield { level: match[1]!.length, text: stripAtxClosingSequence((match[2] ?? '').trim()), line };
  }
}

/** Pure projection of one already-authorized raw Markdown snapshot. */
export function projectNoteOutline(raw: string): NoteHeading[] {
  return [...noteHeadings(raw)];
}

/** Count every visible heading, retaining only the requested leading locators. */
export function projectNoteHeadingSummary(raw: string, limit = 8): { headings: NoteHeading[]; headingCount: number; headingChars: number } {
  if (!Number.isInteger(limit) || limit < 0) throw new Error('heading limit must be a non-negative integer');
  const headings: NoteHeading[] = [];
  let headingCount = 0, headingChars = 0;
  for (const heading of noteHeadings(raw)) {
    headingCount++;
    headingChars += heading.text.length;
    if (headings.length < limit) headings.push(heading);
  }
  return { headings, headingCount, headingChars };
}

/** Prose paragraphs with physical locators; never join across headings or fences. */
export function* projectNoteParagraphs(raw: string): Generator<{ text: string; startLine: number; endLine: number }> {
  let pending: string[] = [];
  let startLine = 0, endLine = 0;
  for (const { text, line } of visibleNoteLines(raw)) {
    const boundary = !text.trim() || /^ {0,3}#{1,6}(?:[ \t]|$)/.test(text);
    if (pending.length && (boundary || line !== endLine + 1)) {
      yield { text: pending.join('\n').trim(), startLine, endLine };
      pending = [];
    }
    if (boundary) continue;
    if (!pending.length) startLine = line;
    pending.push(text);
    endLine = line;
  }
  if (pending.length) yield { text: pending.join('\n').trim(), startLine, endLine };
}

/** At most six active ATX ancestors; sibling/ancestor headings close branches. */
function* headingPaths(headings: Iterable<NoteHeading>): Generator<{ heading: NoteHeading; names: string[] }> {
  const ancestors: NoteHeading[] = [];
  for (const heading of headings) {
    while (ancestors.length && ancestors[ancestors.length - 1]!.level >= heading.level) ancestors.pop();
    ancestors.push(heading);
    yield { heading, names: ancestors.map(item => item.text.trim().toLowerCase()) };
  }
}

/** Retain only requested normalized names/paths, not a complete outline. */
export function projectNoteHeadingPresence(raw: string, requested: ReadonlySet<string>): Set<string> {
  const wanted = new Set([...requested].map(name => name.trim().toLowerCase()));
  const qualified = new Map<string, string[]>();
  for (const name of wanted) {
    const parts = name.split('#').map(part => part.trim());
    if (parts.length < 2 || parts.some(part => !part)) continue;
    const canonical = parts.join('#');
    qualified.set(canonical, [...(qualified.get(canonical) || []), name]);
  }
  const found = new Set<string>();
  if (!wanted.size) return found;
  if (!qualified.size) {
    for (const heading of noteHeadings(raw)) {
      const name = heading.text.trim().toLowerCase();
      if (wanted.has(name)) found.add(name);
      if (found.size === wanted.size) break;
    }
    return found;
  }
  for (const { heading, names } of headingPaths(noteHeadings(raw))) {
    const name = heading.text.trim().toLowerCase();
    if (wanted.has(name)) found.add(name);
    for (let start = 0; start < names.length - 1; start++) {
      for (const match of qualified.get(names.slice(start).join('#')) || []) found.add(match);
    }
    if (found.size === wanted.size) break;
  }
  return found;
}

/** Exact terminal block anchors, not ID prefixes, mentions or code examples. */
export function projectNoteBlockPresence(raw: string, requested: ReadonlySet<string>): Set<string> {
  const wanted = new Set([...requested].map(id => id.trim().toLowerCase()));
  const found = new Set<string>();
  if (!wanted.size) return found;
  for (const { text } of visibleNoteLines(raw)) {
    const anchor = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(text);
    const id = anchor?.[1]?.toLowerCase();
    if (id && wanted.has(id)) found.add(id);
    if (found.size === wanted.size) break;
  }
  return found;
}

/** Exact terminal block anchors, not ID prefixes, mentions or code examples. */
export function projectNoteBlockLines(raw: string, blockId: string): number[] {
  const result: number[] = [];
  for (const { text, line } of visibleNoteLines(raw)) {
    const anchor = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/.exec(text);
    if (anchor?.[1]?.toLowerCase() === blockId.toLowerCase()) result.push(line);
  }
  return result;
}

/** Prefer an exact heading; a partial match is useful only when unambiguous. */
export function selectNoteHeading(headings: NoteHeading[], requested: string): NoteHeading {
  const query = requested.trim().replace(/^#+\s*/, '').trim().toLowerCase();
  if (!query) throw new Error('A non-empty heading is required');
  const exact = headings.filter(heading => heading.text.trim().toLowerCase() === query);
  const parts = query.split('#').map(part => part.trim());
  const isQualified = parts.length > 1 && parts.every(Boolean);
  const qualified = isQualified ? parts.join('#') : '';
  let matches = exact.length ? exact : [];
  if (!exact.length && isQualified) {
    for (const { heading, names } of headingPaths(headings)) {
      if (names.length >= parts.length && names.slice(-parts.length).join('#') === qualified) matches.push(heading);
    }
  } else if (!exact.length) {
    matches = headings.filter(heading => heading.text.trim().toLowerCase().includes(query));
  }
  if (!matches.length) throw new Error('Section not found');
  if (matches.length > 1) throw new Error('Section is ambiguous. Use mcp.get_note_outline, then mcp.read_note_lines with the selected range and expectedRevision.');
  return matches[0]!;
}

/** Raw physical-line window; response serialization applies its character budget. */
export function projectNoteLineWindow(raw: string, params: Pick<ReadNoteLinesParams, 'startLine' | 'endLine'>): {
  content: string; startLine: number; endLine: number; totalLines: number;
} {
  const lines = raw.split('\n');
  const clampedStart = Math.min(Math.max(params.startLine, 1), lines.length);
  const clampedEnd = Math.min(Math.max(params.endLine, clampedStart), lines.length);
  return {
    content: lines.slice(clampedStart - 1, clampedEnd).join('\n'),
    startLine: clampedStart,
    endLine: clampedEnd,
    totalLines: lines.length,
  };
}
