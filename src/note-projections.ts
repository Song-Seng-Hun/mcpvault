import type { NoteHeading, ReadNoteLinesParams } from './types.js';

function stripAtxClosingSequence(text: string): string {
  const withPrecedingSpace = /^(.*[ \t])#+$/.exec(text);
  if (withPrecedingSpace) return withPrecedingSpace[1]!.replace(/[ \t]+$/, '');
  if (/^#+$/.test(text)) return '';
  return text;
}

/** Pure projection of one already-authorized raw Markdown snapshot. */
export function projectNoteOutline(raw: string): NoteHeading[] {
  const lines = raw.split('\n');
  const headings: NoteHeading[] = [];
  const headingRegex = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
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
    const match = headingRegex.exec(trimmed);
    if (match) headings.push({ level: match[1]!.length, text: stripAtxClosingSequence((match[2] ?? '').trim()), line: i + 1 });
  }
  return headings;
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
