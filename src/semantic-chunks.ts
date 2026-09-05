const MAX_CHUNK_CHARS = 1200;
const MAX_CHUNKS_PER_NOTE = 64;

export interface SemanticChunk {
  id: string;
  text: string;
  /** One-based physical Markdown line, including frontmatter. */
  line: number;
  /** Zero-based UTF-16 position in the authoritative Markdown string. */
  offset: number;
  bodyOffset: number;
}

/** Preserve legacy embedding text/IDs while mapping anchors to raw Markdown. */
export function chunkSemanticNote(path: string, raw: string): SemanticChunk[] {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw)?.[0] || '';
  const bodyOffset = frontmatter.length;
  const body = raw.slice(bodyOffset);
  const title = path.split('/').pop()?.replace(/\.md$/i, '') || path;
  const prefix = `${title}\n`;
  const untrimmed = prefix + body;
  const source = untrimmed.trim();
  const sourceTrim = untrimmed.length - untrimmed.trimStart().length;
  const firstBodyContent = body.search(/\S/);
  const titleAnchor = firstBodyContent < 0 ? body.length : firstBodyContent;
  const separators = /\n\s*\n/g;
  const chunks: SemanticChunk[] = [];
  let paragraphOffset = 0;
  let lineCursor = 0;
  let line = 1;

  while (paragraphOffset <= source.length && chunks.length < MAX_CHUNKS_PER_NOTE) {
    const separator = separators.exec(source);
    const paragraphEnd = separator?.index ?? source.length;
    const paragraph = source.slice(paragraphOffset, paragraphEnd);
    const trimmed = paragraph.trim();
    const paragraphTrim = paragraph.length - paragraph.trimStart().length;
    for (let start = 0; start < trimmed.length && chunks.length < MAX_CHUNKS_PER_NOTE; start += MAX_CHUNK_CHARS) {
      const bodyPosition = sourceTrim + paragraphOffset + paragraphTrim + start - prefix.length;
      const offset = Math.min(raw.length, bodyOffset + (bodyPosition < 0 ? titleAnchor : bodyPosition));
      // Anchors are monotone, so line mapping scans each source prefix once.
      while (lineCursor < offset) { if (raw.charCodeAt(lineCursor) === 10) line++; lineCursor++; }
      chunks.push({ id: `${path}#${chunks.length}`, text: trimmed.slice(start, start + MAX_CHUNK_CHARS), line, offset, bodyOffset });
    }
    if (!separator) break;
    paragraphOffset = separator.index + separator[0].length;
  }
  return chunks;
}
