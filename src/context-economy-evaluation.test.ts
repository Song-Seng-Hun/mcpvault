import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { selectStructuredContextPassages } from './document-context.js';
import { parseDocumentStructure } from './document-structure.js';
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/context-economy-v1.json', import.meta.url), 'utf8'));
test('fixed context corpus contains one hundred distinct queries across ten categories', () => {
  expect(corpus.fixtures).toHaveLength(100);
  expect(new Set(corpus.fixtures.map((f: any) => f.query)).size).toBe(100);
  expect(new Set(corpus.fixtures.map((f: any) => f.category)).size).toBe(10);
});
test.each(corpus.fixtures)('$id preserves qualifiers and exact source locators ($category)', (f: any) => {
  const result = selectStructuredContextPassages({ content: f.body, format: f.format, query: f.query, maxChars: 1000 });
  const text = result.passages.map(p => p.text).join('\n');
  for (const required of f.required) expect(text).toContain(required);
  for (const passage of result.passages) for (const range of passage.sourceRanges ?? []) {
    expect(f.body.slice(range.contentStartOffset, range.contentEndOffset)).toBe(passage.text.slice(range.textStartOffset, range.textEndOffset));
  }
  const doc = parseDocumentStructure({ path: f.id, raw: f.body, format: f.format });
  expect(parseDocumentStructure({ path: f.id, raw: f.body, format: f.format })).toEqual(doc);
});
