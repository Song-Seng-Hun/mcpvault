import { expect, test } from 'vitest';
import { parseDocumentStructure } from './document-structure.js';
import { selectDocumentRanges } from './document-ranges.js';

const doc = (raw: string) => parseDocumentStructure({ path: 'Note.md', raw });
const texts = (document: ReturnType<typeof doc>, ranges: ReturnType<typeof selectDocumentRanges>) => ranges.ranges.map(r => document.raw.slice(r.startOffset, r.endOffset));

test('exact one-line reading preserves CRLF source coordinates', () => {
  const d = doc('# Title\r\n\r\nOne.\r\nTwo.\r\n');
  const result = selectDocumentRanges(d, { startLine: 4, endLine: 4, mode: 'exact' });
  expect(texts(d, result)).toEqual(['Two.']);
  expect(result.totalLines).toBe(5);
});

test('semantic reading expands a line to its paragraph and includes the section heading', () => {
  const d = doc('# Conditions\n\nIt is allowed\nonly if permission is granted.');
  const result = selectDocumentRanges(d, { startLine: 3, endLine: 3 });
  expect(texts(d, result)).toContain('# Conditions');
  expect(texts(d, result)).toContain('It is allowed\nonly if permission is granted.');
});

test('table row reading includes the real header and separator', () => {
  const d = doc('# Limits\n\n| User | Limit |\n| --- | --- |\n| guest | 3 |\n| member | 5 |');
  const row = d.fragments.find(f => f.kind === 'tableRow')!;
  const result = selectDocumentRanges(d, { fragmentId: row.id });
  expect(texts(d, result)).toContain('| User | Limit |\n| --- | --- |');
  expect(texts(d, result)).toContain('| guest | 3 |');
});

test('previous tail and next head follow reading edges with requested line counts', () => {
  const d = doc('# Topic\n\nBefore A\nBefore B\nBefore C\n\nCurrent\n\nAfter A\nAfter B');
  const current = d.fragments.find(f => d.raw.slice(f.startOffset, f.endOffset) === 'Current')!;
  expect(texts(d, selectDocumentRanges(d, { fragmentId: current.id, relation: 'previous', edge: 'tail', lineCount: 2, mode: 'exact' }))).toEqual(['Before B\nBefore C']);
  expect(texts(d, selectDocumentRanges(d, { fragmentId: current.id, relation: 'next', edge: 'head', lineCount: 1, mode: 'exact' }))).toEqual(['After A']);
});

test('list context retains the enclosing item lead without copying every sibling', () => {
  const d = doc('# Install\n\n- Only when authorized:\n  - execute the installer\n- Other step');
  const target = d.fragments.find(f => d.raw.slice(f.startOffset, f.endOffset) === 'execute the installer')!;
  const result = selectDocumentRanges(d, { fragmentId: target.id });
  expect(texts(d, result).join('\n')).toContain('Only when authorized');
  expect(texts(d, result).join('\n')).not.toContain('Other step');
});

test('huge single lines can be continued using exact half-open offsets', () => {
  const d = doc('가나다😀'.repeat(1000));
  expect(texts(d, selectDocumentRanges(d, { startOffset: 5, endOffset: 10, mode: 'exact' }))).toEqual(['가나다😀']);
});

test.each([{ startLine: 0 }, { startLine: 2, endLine: 1 }, { startOffset: -1 }, { startOffset: 1, endOffset: 100 }, { lineCount: 1001 }, { fragmentId: 'old' }])('rejects stale or invalid ranges %j', request => {
  expect(() => selectDocumentRanges(doc('one\ntwo'), request)).toThrow();
});

test('missing neighbor is explicit, never silently wraps around', () => {
  const d = doc('Only paragraph');
  const paragraph = d.fragments.find(f => f.kind === 'paragraph')!;
  expect(() => selectDocumentRanges(d, { fragmentId: paragraph.id, relation: 'next' })).toThrow(/neighbor|next|unavailable/i);
});

test('context follows the final trimmed interval, not a shorter distant paragraph', () => {
  const d = doc('# A\n\nA longer paragraph\n\n# B\n\nb');
  const result = selectDocumentRanges(d, { startLine: 3, endLine: 7, lineCount: 1 });
  expect(texts(d, result)).toEqual(['# A', 'A longer paragraph']);
});

test('newline-only offset selections never reverse their range when line-limited', () => {
  const d = doc('abc\r\nxyz');
  const result = selectDocumentRanges(d, { startOffset: 4, endOffset: 5, lineCount: 1, mode: 'exact' });
  expect(result.ranges[0]).toMatchObject({ startOffset: 4, endOffset: 5 });
});
