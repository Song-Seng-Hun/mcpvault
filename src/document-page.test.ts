import { expect, test } from 'vitest';
import { documentPage, boundedHeadingLabel } from './document-page.js';
test('materializes only the admitted page plus one probe and binds continuation to generation', () => {
  const items = Array.from({ length: 10000 }, (_, i) => i); let calls = 0;
  const result = documentPage(items, n => { calls++; return { id: n }; }, {}, 'sig', { limit: 2, maxChars: 1000 }, 'test');
  expect(calls).toBe(2); expect(result.total).toBe(10000);
  expect(documentPage(items, n => ({ id: n }), {}, 'sig', { cursor: result.cursor, limit: 2 }, 'test').items[0]).toEqual({ id: 2 });
  expect(() => documentPage(items, n => ({ id: n }), {}, 'changed', { cursor: result.cursor }, 'test')).toThrow();
});
test('heading labels do not join enormous ancestor strings', () => {
  const headings = ['X'.repeat(100000), 'unread'];
  headings.join = () => { throw new Error('unbounded join'); };
  expect(boundedHeadingLabel(headings, 240)).toBe('X'.repeat(240));
});
