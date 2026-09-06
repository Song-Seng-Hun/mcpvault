import { hashUtf8Source } from './streaming-revision.js';

/** Collect only the existing frontmatter parser's leading input. A header may
 * be arbitrarily long/unclosed: the source reader, not this projection, caps it.
 * Chunk arrays avoid quadratic concatenation while finding split delimiters. */
export class HeaderCollector {
  private opener = '';
  private decided = false;
  private done = false;
  private readonly parts: string[] = [];
  private tail = '';

  write(text: string): void {
    if (this.done || !text) return;
    if (!this.decided) {
      const count = Math.min(5 - this.opener.length, text.length);
      this.opener += text.slice(0, count);
      text = text.slice(count);
      if (this.opener.length < 5) return;
      this.decided = true;
      const normalized = this.opener[0] === '\uFEFF' ? this.opener.slice(1) : this.opener;
      if (!normalized.startsWith('---') || normalized[3] === '-') {
        this.opener = ''; this.done = true; return;
      }
      this.capture(this.opener);
      this.opener = '';
    }
    this.capture(text);
  }

  private capture(text: string): void {
    if (this.done || !text) return;
    const scan = this.tail + text;
    const closing = scan.indexOf('\n---');
    if (closing >= 0) {
      this.parts.push(text.slice(0, closing + 4 - this.tail.length));
      this.tail = ''; this.done = true;
    } else {
      this.parts.push(text);
      this.tail = scan.slice(-3);
    }
  }

  finish(): string { return this.decided ? this.parts.join('') : this.opener; }
}

export interface Utf8MetadataSource { readonly header: string; readonly revision: string }

/** Header and digest come from the same opened file/decoded stream, not two
 * reads. Does not promise snapshot isolation from external in-place writers. */
export async function readUtf8MetadataSource(path: string, maxBytes?: number): Promise<Utf8MetadataSource> {
  const collector = new HeaderCollector();
  const revision = await hashUtf8Source(path, maxBytes, text => collector.write(text));
  return Object.freeze({ header: collector.finish(), revision });
}
