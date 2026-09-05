import { expect, test } from 'vitest';
import { chunkSemanticNote } from './semantic-chunks.js';

// Previous text/ID contract, deliberately independent of the new locator math.
function legacyTexts(path: string, raw: string) {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const title = path.split('/').pop()?.replace(/\.md$/i, '') || path;
  const chunks: { id: string; text: string }[] = [];
  for (const paragraph of `${title}\n${body}`.trim().split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    for (let start = 0; start < trimmed.length && chunks.length < 64; start += 1200) {
      chunks.push({ id: `${path}#${chunks.length}`, text: trimmed.slice(start, start + 1200) });
    }
  }
  return chunks;
}

const fixtures = [
  '', '# Heading\n\nBody', '---\nkey: value\n---\n\n# Heading\n\nBody',
  '---\r\nkey: value\r\n---\r\n\r\n# Heading\r\n\r\n \r\n\r\n  Target',
  '  \n\n\t# Heading\n \n\t\n  Target\n', '---\nkey: value\n---',
  '한글😀'.repeat(1500), Array.from({ length: 100 }, (_, i) => `paragraph ${i}`).join('\n\n'),
];
test.each(fixtures)('keeps legacy embedding text and IDs for fixture %#', raw => {
  const path = 'Area/한글 # Note.md';
  expect(chunkSemanticNote(path, raw).map(({ id, text }) => ({ id, text }))).toEqual(legacyTexts(path, raw));
});

test.each(['\n', '\r\n'])('maps Properties and variable blank separators to physical lines using %j', newline => {
  const raw = ['---', 'title: Test', '---', '', '# Heading', '', '  ', '', '  Target sentence'].join(newline);
  const chunks = chunkSemanticNote('Note.md', raw);
  const target = chunks.find(chunk => chunk.text === 'Target sentence')!;
  expect(target.offset).toBe(raw.indexOf('Target sentence'));
  expect(target.line).toBe(9);
  expect(raw.split(/\r?\n/)[target.line - 1]).toContain('Target sentence');
});

test('long single-line continuations retain their exact raw start', () => {
  const raw = 'x'.repeat(3000);
  const chunks = chunkSemanticNote('Note.md', raw);
  expect(chunks[1]).toMatchObject({ offset: 1200 - 'Note\n'.length, line: 1 });
  expect(chunks[2]).toMatchObject({ offset: 2400 - 'Note\n'.length, line: 1 });
});

test('synthetic title anchors the first body content rather than frontmatter or blank lines', () => {
  const raw = '---\nkey: value\n---\n\n\nBody';
  expect(chunkSemanticNote('Note.md', raw)[0]).toMatchObject({ offset: raw.indexOf('Body'), line: 6 });
});

test('chunk count remains bounded', () => {
  expect(chunkSemanticNote('Note.md', 'long'.repeat(100000))).toHaveLength(64);
});

test('mixed whitespace fixtures keep physical line counts for every emitted anchor', () => {
  for (let seed = 0; seed < 40; seed++) {
    const newline = seed % 2 ? '\n' : '\r\n';
    const raw = `---${newline}title: mixed${newline}---${newline}`
      + Array.from({ length: 12 }, (_, i) => `${' '.repeat((seed + i) % 5)}line ${i} ${'한😀'.repeat((seed * 31 + i) % 600)}`)
        .join(newline.repeat(seed % 4 + 1));
    const chunks = chunkSemanticNote('Area/Mixed.md', raw);
    expect(chunks.map(({ id, text }) => ({ id, text }))).toEqual(legacyTexts('Area/Mixed.md', raw));
    for (const chunk of chunks) {
      expect(chunk.line).toBe(raw.slice(0, chunk.offset).split('\n').length);
      expect(chunk.offset).toBeGreaterThanOrEqual(chunk.bodyOffset);
      expect(chunk.offset).toBeLessThanOrEqual(raw.length);
    }
  }
});
