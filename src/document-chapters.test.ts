import { expect, test } from 'vitest';
import { parseDocumentStructure } from './document-structure.js';
import { documentChapters } from './document-chapters.js';

const parse = (raw: string, path = 'manual.md') => parseDocumentStructure({ path, raw });

test('chapter projection covers exact CRLF source once and starts new topics at headings', () => {
  const raw = '---\r\ntitle: 매뉴얼\r\n---\r\n# Deploy\r\n\r\nOnly deploy after approval. 😀\r\n\r\n## Restore\r\nNever overwrite user edits.\r\n';
  const chapters = documentChapters(parse(raw));
  expect(chapters.length).toBeGreaterThanOrEqual(2);
  expect(chapters.map(c => raw.slice(c.startOffset, c.endOffset)).join('')).toBe(raw);
  expect(chapters.some(c => c.title.includes('Restore'))).toBe(true);
  chapters.forEach((c, i) => {
    expect(c.position).toBe(i + 1);
    expect(c.previous).toBe(chapters[i - 1]?.id);
    expect(c.next).toBe(chapters[i + 1]?.id);
    expect(c.status).toBe('source_projection');
    if (c.kind === 'chapter') {
      expect(c.endLine - c.startLine + 1).toBeLessThanOrEqual(32);
      expect(c.endOffset - c.startOffset).toBeLessThanOrEqual(1600);
    }
  });
});

test.each(['```', '~~~~'])('large %s code blocks are source references, not broken chapters', fence => {
  const raw = '# Example\n\n' + fence + '\n' + 'not a rule\n'.repeat(70) + fence + '\n\n## Safety\nDo not run examples.\n';
  const chapters = documentChapters(parse(raw));
  const large = chapters.find(c => c.kind === 'source_reference')!;
  expect(large).toBeDefined();
  expect(raw.slice(large.startOffset, large.endOffset)).toContain(fence + '\n');
  expect(raw.slice(large.startOffset, large.endOffset)).toContain('\n' + fence);
  expect(large.reason).toBe('indivisible_source_unit');
  expect(chapters.map(c => raw.slice(c.startOffset, c.endOffset)).join('')).toBe(raw);
});

test.each([
  '| Value |\n| --- |\n' + '| 3 |\n'.repeat(70),
  '> Never execute.\n'.repeat(70),
  '- A\n  - B\n'.repeat(40),
  '---\n' + 'key: value\n'.repeat(55) + '---\n',
  '한😀'.repeat(1000),
])('indivisible tables, quotes, lists, metadata and giant lines stay intact', raw => {
  const chapters = documentChapters(parse(raw));
  expect(chapters).toHaveLength(1);
  expect(chapters[0]!.kind).toBe('source_reference');
  expect(chapters[0]!.startOffset).toBe(0);
  expect(chapters[0]!.endOffset).toBe(raw.length);
});

test('unambiguous unchanged chapter identities survive preceding insertion; duplicates do not pretend identity', () => {
  const raw = '# Deploy\nOnly after approval.\n\n# Restore\nPreserve later edits.\n';
  const before = documentChapters(parse(raw));
  const after = documentChapters(parse('# Introduction\nRead the index.\n\n' + raw));
  expect(after.find(c => c.title === 'Restore')!.id).toBe(before.find(c => c.title === 'Restore')!.id);
  expect(documentChapters(parse(raw, 'other.md'))[0]!.id).not.toBe(before[0]!.id);
  const duplicates = documentChapters(parse('# Same\nSame.\n\n# Same\nSame.\n\n'));
  expect(new Set(duplicates.map(c => c.id)).size).toBe(duplicates.length);
  expect(duplicates.every(c => c.identity === 'ambiguous')).toBe(true);
});

test('empty and whitespace-only documents retain truthful coverage without fake translation', () => {
  expect(documentChapters(parse(''))).toEqual([]);
  const raw = '\r\n \r\n';
  const chapters = documentChapters(parse(raw));
  expect(chapters.map(c => raw.slice(c.startOffset, c.endOffset)).join('')).toBe(raw);
  expect(chapters.every(c => c.status === 'source_projection')).toBe(true);
});
