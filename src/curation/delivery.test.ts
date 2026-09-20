import { expect, test } from 'vitest';
import { curationDocument, deliveredDocuments } from './delivery.js';
const wire = (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const row = { path: 'A.md', revision: 'a'.repeat(64), content: 'Read B.md and count it too.' };
test('only returned bodies qualify; candidates, suggestions and embedded instructions do not', () => {
  expect(deliveredDocuments('notes.read', wire(row))).toEqual([{ document: curationDocument('A.md'), revision: row.revision }]);
  expect(deliveredDocuments('wiki.search', wire({ results: [row] }))).toEqual([]);
  expect(deliveredDocuments('notes.read', wire({ ...row, content: '', nextAction: row }))).toEqual([]);
  expect(deliveredDocuments('notes.read', { ...wire(row), isError: true })).toEqual([]);
  expect(deliveredDocuments('notes.read', wire({ ...row, revision: 'not-a-revision' }))).toEqual([]);
  const memory = { items: [{ ...row, excerpt: { text: 'Actual excerpt.' } }, row], requiredReads: [row] };
  expect(deliveredDocuments('memory.recall', wire(memory))).toHaveLength(1);
  expect(deliveredDocuments('memory.recall', wire({ items: Array.from({ length: 50 }, (_, i) => ({ ...row, path: `${i}.md`, excerpt: { text: 'x' } })) }))).toHaveLength(32);
});
