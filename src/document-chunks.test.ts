import { expect, test } from 'vitest';
import { parseDocumentStructure } from './document-structure.js';
import { chunkStructuredDocument, assertDocumentEmbeddingTokens } from './document-chunks.js';
const parse = (raw: string) => parseDocumentStructure({ path: 'Folder/Note.md', raw });
test.each(['한글😀', 'abcdef', 'col | table', 'long_word_without_breaks'])('covers every body character beyond 64 chunks with safe embedding byte bounds: %s', value => {
  const raw = '# 제목\n\n' + (value + ' ').repeat(5000), doc = parse(raw), chunks = chunkStructuredDocument(doc);
  expect(chunks.length).toBeGreaterThan(64);
  expect(chunks.map(c => raw.slice(c.offset, c.endOffset)).join('')).toBe(raw);
  for (const c of chunks) {
    expect(Buffer.byteLength(`passage: ${c.text}`)).toBeLessThanOrEqual(448);
    expect(c.text.endsWith(raw.slice(c.offset, c.endOffset))).toBe(true);
    expect(c.text).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(c.fragmentIds.length).toBeGreaterThan(0);
  }
});
test('retains fences, nested list markers and table delimiters while excluding Properties', () => {
  const raw = '---\ntitle: Hidden meta\n---\r\n# Table\n\n| Name | Count |\n| --- | --- |\n| A | 3 |\n\n- One\n  - Two\n\n```sh\necho test\n```\n';
  const chunks = chunkStructuredDocument(parse(raw));
  expect(chunks.map(c => raw.slice(c.offset, c.endOffset)).join('')).toBe(raw.slice(raw.indexOf('# Table')));
  expect(chunks.some(c => c.text.includes('Hidden meta'))).toBe(false);
  expect(chunks[0]!.line).toBe(4);
});
test('joins tiny sibling paragraphs and keeps content hashes reusable across unrelated revisions', () => {
  const first = parse('# Topic\n\none\n\ntwo\n\nthree');
  const chunks = chunkStructuredDocument(first);
  expect(chunks.length).toBeLessThan(first.fragments.filter(f => f.kind === 'paragraph').length);
  const changed = parse('# Other\n\nnew\n\n' + first.raw);
  expect(chunkStructuredDocument(changed).some(c => c.text === chunks.at(-1)!.text)).toBe(true);
});
test('extractive context is bounded even for maliciously large headings', () => {
  const doc = parse('# ' + 'H'.repeat(16000) + '\n\nbody');
  const chunks = chunkStructuredDocument(doc);
  expect(chunks.every(c => Buffer.byteLength('passage: ' + c.text) <= 448)).toBe(true);
  expect(chunks.some(c => c.contextTruncated)).toBe(true);
});
test('checks the actual tokenizer including E5 prefix and special tokens before inference', () => {
  let observed = '';
  expect(() => assertDocumentEmbeddingTokens('passage: hi', { encode: text => { observed = text; return Array(512).fill(1); } })).not.toThrow();
  expect(observed).toBe('passage: hi');
  expect(() => assertDocumentEmbeddingTokens('passage: hi', { encode: () => Array(513).fill(1) })).toThrow(/token/i);
  expect(() => assertDocumentEmbeddingTokens('passage: hi')).toThrow(/tokenizer|unavailable/i);
});
